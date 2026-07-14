// inline-items.ts - 把段落内联内容转换为 KP items，落实中文排版规则：
// 避头尾、标点挤压、标点悬挂（全角句读 + 紧跟 CJK 的半角句读）、
// 中西文间隙，以及西文词内断词（音节由调用方注入的 hyphenate 提供，
// 内部不自带词典）。纯函数，测量能力由调用方传入。
//
// 规则依据见 debug/kp-typesetting-plan.html §1（规则表）与 #hanging（悬挂建模）。

import {
  FORCED_BREAK,
  INFINITE_PENALTY,
  PAR_FILL_STRETCH,
  finishItems,
  type KpBox,
  type KpGlue,
  type KpItem,
  type KpPenalty,
} from "./kp-core";

/**
 * 段内文本片段、不可拆的行内对象（例如 KaTeX 公式）或硬换行。
 * seg 标识样式来源；atom 是调用方维护的对象下标，width 是对象实测宽度。
 */
export type InlineToken =
  | { text: string; seg: number }
  | { atom: number; width: number; seg: number }
  | { br: true };

export interface TypesetMeasure {
  /** 测量 text 在 seg 样式下的像素宽度。 */
  text(text: string, seg: number): number;
  /** seg 样式的字号（em 基准，像素）。 */
  em(seg: number): number;
}

export interface BuildItemsOptions {
  /** 把单词拆成音节（Knuth-Liang 词典库的包装）；缺省则不做词内断词。 */
  hyphenate?: (word: string) => string[];
  /** 低于此长度的单词不做词内断词，默认 6。 */
  minHyphenateLength?: number;
}

export interface TypesetBox extends KpBox {
  text: string;
  seg: number;
  /** 非文本原子对象的调用方下标；文本 box 不设置。 */
  atom?: number;
  /** CSS letter-spacing 的分配单位；只给包含西文字符的文本盒设置。 */
  trackingUnits?: number;
}
export interface TypesetGlue extends KpGlue {
  /** 渲染用文本：西文空格为 " "，CJK 间隙为 ""。 */
  text: string;
  seg: number;
}
export interface TypesetPenalty extends KpPenalty {
  /** 断在此处时行尾需补渲的文本（连字符 "-"），否则为 ""。 */
  text: string;
  seg: number;
}
export type TypesetItem = TypesetBox | TypesetGlue | TypesetPenalty;

/** 标点悬挂候选断点的代价（demerits 增量 = cost²，需小到不阻止悬挂）。 */
export const HANG_COST = 5;
/** 连字符断点代价。 */
export const HYPHEN_COST = 45;

// 避头：不可出现在行首的字符（断点不能落在它之前）。
const NO_START = new Set("。，、．！？；：）】》」』〉〕…‥·—～”’" + ",.;:!?)]}%");
// 避尾：不可出现在行尾的字符（断点不能落在它之后）。
const NO_END = new Set("（【《「『〈〔“‘" + "([{");
// 全角句读：行尾可整宽悬挂。
const FULL_HANG = new Set("。，、．");
// 半角句读：紧跟 CJK 字符时可按实测宽度悬挂。
const ASCII_HANG = new Set(",.;:");
// 标点挤压：字形偏左、右侧留白的全角标点，其后间隙可压缩半宽。
const SQUEEZE_AFTER = new Set("。，、．；：！？）》」』】〉〕");
// 字形偏右、左侧留白的全角标点，其前间隙可压缩半宽。
const SQUEEZE_BEFORE = new Set("（《「『【〈〔");
// 紧跟 CJK 时从西文串里拆出来单独成 box 的半角标点（禁断于其前）。
const ASCII_AFTER_CJK = new Set(",.;:!?)]}");

// CJK 统一表意/兼容区 + 全角形式区 + 双弯引号（中文语境按全角处理；
// 单弯引号 ’ 不收，否则英文 don’t 会被拆散）。
const CJK_RE = /[⺀-鿿豈-﫿！-｠“”]/;
const WORD_RE = /^[A-Za-z]+$/;
/**
 * 一行的剩余宽度应在中文字符间、英文词间和中西边界上大致均匀分摊。
 * 统一使用 1/8 em 的伸长能力，避免混排时英文空格承担约三倍于中文字间的
 * 伸长量，形成截图中那种醒目的空洞。
 */
const INLINE_GAP_STRETCH_EM = 0.125;
/** 西文单词内部不允许断行，但可用轻微 tracking 分担公式附近的剩余行宽。 */
const LATIN_TRACKING_STRETCH_EM = 0.02;
const LATIN_TRACKING_SHRINK_EM = 0.01;

type Atom =
  | { kind: "cjk"; text: string; seg: number }
  | { kind: "word"; text: string; seg: number }
  | { kind: "apunct"; text: string; seg: number }
  | { kind: "atomic"; atom: number; width: number; seg: number }
  | { kind: "space"; seg: number }
  | { kind: "br" };

function tokenize(tokens: InlineToken[]): Atom[] {
  const atoms: Atom[] = [];
  const lastVisible = (): Atom | null => {
    for (let i = atoms.length - 1; i >= 0; i--) {
      const a = atoms[i]!;
      if (a.kind === "space") continue;
      return a;
    }
    return null;
  };

  for (const token of tokens) {
    if ("br" in token) {
      atoms.push({ kind: "br" });
      continue;
    }
    if ("atom" in token) {
      atoms.push({ kind: "atomic", ...token });
      continue;
    }
    const { text, seg } = token;
    let word = "";
    const flushWord = () => {
      if (!word) return;
      // 紧跟 CJK（无空格）的行首半角句读拆成独立 box，走避头 + 悬挂逻辑。
      const prev = lastVisible();
      let rest = word;
      if (prev?.kind === "cjk" && atoms[atoms.length - 1]?.kind !== "space") {
        while (rest && ASCII_AFTER_CJK.has(rest[0]!)) {
          atoms.push({ kind: "apunct", text: rest[0]!, seg });
          rest = rest.slice(1);
        }
      }
      if (rest) atoms.push({ kind: "word", text: rest, seg });
      word = "";
    };

    for (const ch of text) {
      if (/\s/.test(ch)) {
        flushWord();
        if (atoms[atoms.length - 1]?.kind !== "space") atoms.push({ kind: "space", seg });
      } else if (CJK_RE.test(ch)) {
        flushWord();
        atoms.push({ kind: "cjk", text: ch, seg });
      } else {
        word += ch;
      }
    }
    flushWord();
  }
  return atoms;
}

/**
 * 把段落 tokens 编译为已收尾的 KP items。宽度单位与 measure 一致（像素）。
 */
export function buildItems(
  tokens: InlineToken[],
  measure: TypesetMeasure,
  opts: BuildItemsOptions = {},
): TypesetItem[] {
  const minLen = opts.minHyphenateLength ?? 6;
  const atoms = tokenize(tokens);
  const items: TypesetItem[] = [];

  const glue = (width: number, stretch: number, shrink: number, text: string, seg: number) =>
    items.push({ type: "glue", width, stretch, shrink, text, seg });
  const noBreak = (seg: number) =>
    items.push({
      type: "penalty",
      width: 0,
      cost: INFINITE_PENALTY,
      flagged: false,
      text: "",
      seg,
    });
  const hang = (ch: string, seg: number) =>
    items.push({
      type: "penalty",
      width: -measure.text(ch, seg),
      cost: HANG_COST,
      flagged: false,
      text: "",
      seg,
    });

  const pushWord = (atom: Atom & { kind: "word" }) => {
    const { text, seg } = atom;
    const syllables =
      opts.hyphenate && text.length >= minLen && WORD_RE.test(text) ? opts.hyphenate(text) : [text];
    for (let i = 0; i < syllables.length; i++) {
      if (i > 0) {
        items.push({
          type: "penalty",
          width: measure.text("-", seg),
          cost: HYPHEN_COST,
          flagged: true,
          text: "-",
          seg,
        });
      }
      const text = syllables[i]!;
      const trackingUnits = /[A-Za-z]/.test(text) ? [...text].length : 0;
      items.push({
        type: "box",
        width: measure.text(text, seg),
        stretch: trackingUnits * measure.em(seg) * LATIN_TRACKING_STRETCH_EM,
        shrink: trackingUnits * measure.em(seg) * LATIN_TRACKING_SHRINK_EM,
        text,
        seg,
        trackingUnits: trackingUnits || undefined,
      });
    }
  };

  let prev: Atom | null = null; // 上一个可见 atom
  let pendingSpace: number | null = null; // 待落地的空格 seg

  for (const atom of atoms) {
    if (atom.kind === "br") {
      // 段内硬换行：行前补无限拉伸 glue（该行按末行处理），再强制断。
      items.push({
        type: "glue",
        width: 0,
        stretch: PAR_FILL_STRETCH,
        shrink: 0,
        text: "",
        seg: 0,
      });
      items.push({
        type: "penalty",
        width: 0,
        cost: FORCED_BREAK,
        flagged: false,
        text: "",
        seg: 0,
      });
      prev = null;
      pendingSpace = null;
      continue;
    }
    if (atom.kind === "space") {
      pendingSpace = atom.seg;
      continue;
    }

    const firstCh = "text" in atom ? atom.text[0]! : "";
    if (prev) {
      const prevCh = "text" in prev ? prev.text[prev.text.length - 1]! : "";
      const prevCjk = prev.kind === "cjk";
      if (pendingSpace !== null) {
        // 空格间隙：自然宽度不变，伸长能力与其他行内间隙统一；缩窄仍按
        // 空格自身宽度计算。避头字符前禁断；全角/半角句读后可悬挂。
        const seg = pendingSpace;
        const forbid = NO_START.has(firstCh);
        const hangable =
          !forbid &&
          ((prevCjk && FULL_HANG.has(prevCh)) ||
            (prev.kind === "apunct" && ASCII_HANG.has(prevCh)));
        if (hangable) hang(prevCh, prev.seg);
        if (forbid) noBreak(seg);
        const w = measure.text(" ", seg);
        glue(w, measure.em(seg) * INLINE_GAP_STRETCH_EM, w / 3, " ", seg);
      } else if (atom.kind === "apunct") {
        // 半角句读紧贴前字：无 glue 即无断点（避头）。
      } else if (prevCjk && atom.kind === "cjk") {
        // CJK 间隙：宽 0、伸长能力与词间空格统一；标点挤压提供 shrink；
        // 避头尾用 INF 禁断。
        const forbid = NO_START.has(firstCh) || NO_END.has(prevCh);
        if (!forbid && FULL_HANG.has(prevCh)) hang(prevCh, prev.seg);
        if (forbid) noBreak(prev.seg);
        let shrink = 0;
        if (SQUEEZE_AFTER.has(prevCh)) shrink += measure.text(prevCh, prev.seg) / 2;
        if (SQUEEZE_BEFORE.has(firstCh)) shrink += measure.text(firstCh, atom.seg) / 2;
        glue(0, measure.em(prev.seg) * INLINE_GAP_STRETCH_EM, shrink, "", prev.seg);
      } else if (
        (prevCjk && (atom.kind === "word" || atom.kind === "atomic")) ||
        ((prev.kind === "word" || prev.kind === "apunct" || prev.kind === "atomic") &&
          atom.kind === "cjk")
      ) {
        // 中西文间隙 ~em/8，可断（与前面的悬挂 penalty 构成双候选）。
        const forbid = NO_START.has(firstCh) || (prevCjk && NO_END.has(prevCh));
        const hangable =
          !forbid &&
          ((prevCjk && FULL_HANG.has(prevCh)) ||
            (prev.kind === "apunct" && ASCII_HANG.has(prevCh)));
        if (hangable) hang(prevCh, prev.seg);
        if (forbid) noBreak(prev.seg);
        const em = measure.em(prev.seg);
        glue(em * 0.125, em * INLINE_GAP_STRETCH_EM, em * 0.04, "", prev.seg);
      }
      // word/atomic→word/atomic（无显式空格）直接相连：无断点。
    }

    if (atom.kind === "word") pushWord(atom);
    else if (atom.kind === "atomic")
      items.push({
        type: "box",
        width: atom.width,
        text: "",
        seg: atom.seg,
        atom: atom.atom,
      });
    else
      items.push({
        type: "box",
        width: measure.text(atom.text, atom.seg),
        text: atom.text,
        seg: atom.seg,
      });
    prev = atom;
    pendingSpace = null;
  }

  finishItems(items as KpItem[]);
  // finishItems 推入的收尾项缺 text/seg 元数据，补齐以统一渲染路径。
  for (let i = Math.max(0, items.length - 3); i < items.length; i++) {
    const it = items[i] as KpItem & Partial<Pick<TypesetItem, "text" | "seg">>;
    if (it.text === undefined) it.text = "";
    if (it.seg === undefined) it.seg = 0;
  }
  return items;
}
