// typeset-dom.ts - 只读预览的 KP 排版控制器（镜像架构）。
//
// 绝不改写 ProseMirror 的活动 DOM——PM 的 DOMObserver 不区分可编辑状态，
// 任何改动都会被回读成文档事务、污染内容。做法是：把 .ProseMirror 整体
// 克隆成一次性镜像兄弟节点，CSS 隐藏真身、只显示镜像，在镜像里逐段重排。
// 真身任何变化（split 模式打字、换文档、换主题、容器变宽）都触发防抖后
// 整体重建镜像，因此无需任何“还原原文”的簿记。
//
// 排版作用于「仅预览」镜像里的所有合格正文段落，与当前主题是否预先设置
// text-align: justify 无关；含允许列表之外元素的段落原样保留浏览器换行。

import { hyphenateSync } from "hyphen/en";
import { FORCED_BREAK, PAR_FILL_STRETCH, breakLines } from "./kp-core";
import {
  buildItems,
  type InlineToken,
  type TypesetItem,
  type TypesetPenalty,
} from "./inline-items";

const REBUILD_DEBOUNCE_MS = 150;
// 段落内联允许列表：出现其他元素（图片、代码、file-ref 等）则整段跳过。
const ALLOWED_INLINE = new Set(["STRONG", "EM", "DEL", "S", "A", "SPAN", "BR"]);
const SOFT_HYPHEN = "­";

export class TypesetController {
  private readonly host: HTMLElement;
  private mirror: HTMLElement | null = null;
  private observedPm: HTMLElement | null = null;
  private active = false;
  private rebuildTimer: number | null = null;
  /** 上次重建时的「主题|宽度|内容」签名，用于跳过无变化的重建。 */
  private lastSignature = "";

  private readonly pmObserver = new MutationObserver(() => this.scheduleRebuild());
  private readonly bodyObserver = new MutationObserver(() => this.scheduleRebuild());
  private readonly resizeObserver = new ResizeObserver(() => this.scheduleRebuild());
  private readonly handleFontsLoaded = (): void => {
    // 字体就位后旧测量作废，签名也要作废以强制重排。
    this.widthCache.clear();
    this.lastSignature = "";
    this.scheduleRebuild();
  };

  /** 隐藏的 DOM 测量容器。不用 Canvas measureText：WebKitGTK 走 fontconfig
      hinting 时 DOM 排版的字形推进宽度会被取整，与 Canvas 理想值每字差零点几
      像素，整行累计肉眼可见（右边缘不齐、版心偏窄）。同一渲染管线的 DOM
      测量才与最终渲染逐字一致。 */
  private measureHost: HTMLElement | null = null;
  /** font 简写串 → (文本 → 宽度) 两级缓存。 */
  private readonly widthCache = new Map<string, Map<string, number>>();
  private readonly hyphenCache = new Map<string, string[]>();

  constructor(host: HTMLElement) {
    this.host = host;
  }

  enable(): void {
    if (this.active) return;
    this.active = true;
    this.host.classList.add("amark-typeset-active");
    // 主题切换改 body class（字体/对齐方式随之变化）。
    this.bodyObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.resizeObserver.observe(this.host);
    document.fonts?.addEventListener("loadingdone", this.handleFontsLoaded);
    // 立即建一次镜像：真身已被 CSS 隐藏，等防抖会白屏一闪。
    this.rebuild();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.host.classList.remove("amark-typeset-active");
    this.pmObserver.disconnect();
    this.bodyObserver.disconnect();
    this.resizeObserver.disconnect();
    document.fonts?.removeEventListener("loadingdone", this.handleFontsLoaded);
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.mirror?.remove();
    this.mirror = null;
    this.measureHost?.remove();
    this.measureHost = null;
    this.observedPm = null;
    this.lastSignature = "";
  }

  private realProseMirror(): HTMLElement | null {
    return this.host.querySelector<HTMLElement>(".ProseMirror:not(.amark-typeset-mirror)");
  }

  private scheduleRebuild(): void {
    if (!this.active) return;
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, REBUILD_DEBOUNCE_MS);
  }

  private rebuild(): void {
    if (!this.active) return;
    const pm = this.realProseMirror();
    if (!pm) {
      // 编辑器尚未挂载：轮询等待（激活期间真身本就隐藏，无视觉影响）。
      this.scheduleRebuild();
      return;
    }
    if (pm !== this.observedPm) {
      this.pmObserver.disconnect();
      // 只看内容变化；attributes 会被 PM 聚焦类等抖动反复触发无谓重建。
      this.pmObserver.observe(pm, { childList: true, characterData: true, subtree: true });
      this.observedPm = pm;
    }

    // 内容、可用宽度、主题都没变就跳过：把观察器杂音在这里消化掉，
    // 不让它演变成镜像替换（以及随之而来的滚动扰动）。
    const signature = `${document.body.className}|${this.host.clientWidth}|${pm.innerHTML}`;
    if (signature === this.lastSignature && this.mirror?.isConnected) return;
    this.lastSignature = signature;

    // 镜像整体换新可能让滚动容器（分屏是 #editor，仅预览是 .editor-wrapper）
    // 的滚动位置被浏览器钳制或锚定复位；先记录、排版完成后恢复。
    const scrollers: [HTMLElement, number, number][] = [];
    for (let el: HTMLElement | null = this.host; el; el = el.parentElement) {
      if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
        scrollers.push([el, el.scrollTop, el.scrollLeft]);
      }
    }

    this.mirror?.remove();
    const mirror = pm.cloneNode(true) as HTMLElement;
    mirror.classList.add("amark-typeset-mirror");
    mirror.removeAttribute("contenteditable");
    this.mirror = mirror;
    // 先入 DOM 再排版：测量与 clientWidth 都依赖计算样式。
    pm.after(mirror);

    for (const p of Array.from(mirror.querySelectorAll<HTMLElement>("p"))) {
      this.typesetParagraph(p);
    }

    for (const [el, top, left] of scrollers) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
  }

  private typesetParagraph(p: HTMLElement): void {
    const cs = getComputedStyle(p);
    if (cs.textIndent !== "0px") return;

    const collected = collectTokens(p);
    if (!collected) return;
    const { tokens, segElements } = collected;

    // 版心取小数宽度：clientWidth 是取整值，会让每行系统性差 1px 以内。
    const lineWidth =
      p.getBoundingClientRect().width -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight) -
      parseFloat(cs.borderLeftWidth) -
      parseFloat(cs.borderRightWidth);
    if (!(lineWidth > 0)) return;

    const fonts = segElements.map((el) => measureFont(getComputedStyle(el)));
    this.prewarmMeasurements(tokens, fonts);
    const measure = {
      text: (text: string, seg: number): number => this.measureText(text, fonts[seg]!),
      em: (seg: number): number => parseFloat(getComputedStyle(segElements[seg]!).fontSize),
    };

    const items = buildItems(tokens, measure, { hyphenate: this.hyphenate });
    if (!items.some((it) => it.type === "box")) return;
    const lines = breakLines(items, lineWidth);
    if (!lines) return; // 不可行（如超长不可断内容）→ 保留浏览器换行

    // 校正若超出安全范围，说明测量模型与最终 DOM 差异已不是亚像素误差；
    // 此时宁可恢复镜像中的原始段落，让浏览器原生断行，也不强撑出怪异字距。
    const fallbackChildren = Array.from(p.childNodes, (node) => node.cloneNode(true));
    const rendered = renderLines(p, items, lines, segElements, lineWidth);
    if (!correctResiduals(rendered)) {
      p.classList.remove("amark-tl-paragraph");
      p.replaceChildren(...fallbackChildren);
    }
  }

  private ensureMeasureHost(): HTMLElement {
    if (this.measureHost?.isConnected) return this.measureHost;
    const el = document.createElement("div");
    // 放在 host 内以继承同样的 text-rendering 等文字渲染上下文；
    // 负向偏移不会产生滚动溢出。
    el.style.cssText =
      "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre;pointer-events:none;";
    this.host.appendChild(el);
    this.measureHost = el;
    return el;
  }

  /** 把本段将要测量的候选文本一次性入列，单次布局读完，避免逐次强制回流。 */
  private prewarmMeasurements(tokens: InlineToken[], fonts: string[]): void {
    const wanted = new Map<string, Set<string>>(); // font → texts
    const queue = (text: string, font: string): void => {
      if (!text || this.widthCache.get(font)?.has(text)) return;
      let texts = wanted.get(font);
      if (!texts) {
        texts = new Set();
        wanted.set(font, texts);
      }
      texts.add(text);
    };

    for (const token of tokens) {
      if ("br" in token) continue;
      const font = fonts[token.seg]!;
      queue(" ", font);
      // 与 inline-items 的切分保持一致的近似：单码点（CJK 字/标点）、
      // 空格分隔的西文词、可断词的音节与连字符。漏网文本走单次测量兜底。
      for (const ch of token.text) queue(ch, font);
      for (const word of token.text.split(/\s+/)) {
        queue(word, font);
        if (/^[A-Za-z]{6,}$/.test(word)) {
          queue("-", font);
          for (const syllable of this.hyphenate(word)) queue(syllable, font);
        }
      }
    }
    if (wanted.size === 0) return;

    const host = this.ensureMeasureHost();
    const spans: [string, string, HTMLSpanElement][] = [];
    for (const [font, texts] of wanted) {
      for (const text of texts) {
        const span = document.createElement("span");
        span.style.font = font;
        span.textContent = text;
        host.appendChild(span);
        spans.push([font, text, span]);
      }
    }
    for (const [font, text, span] of spans) {
      let byText = this.widthCache.get(font);
      if (!byText) {
        byText = new Map();
        this.widthCache.set(font, byText);
      }
      byText.set(text, span.getBoundingClientRect().width);
    }
    host.replaceChildren();
  }

  private measureText(text: string, font: string): number {
    let byText = this.widthCache.get(font);
    if (!byText) {
      byText = new Map();
      this.widthCache.set(font, byText);
    }
    const cached = byText.get(text);
    if (cached !== undefined) return cached;
    const span = document.createElement("span");
    span.style.font = font;
    span.textContent = text;
    this.ensureMeasureHost().appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    byText.set(text, width);
    return width;
  }

  private readonly hyphenate = (word: string): string[] => {
    const cached = this.hyphenCache.get(word);
    if (cached) return cached;
    const syllables = hyphenateSync(word, { hyphenChar: SOFT_HYPHEN }).split(SOFT_HYPHEN);
    this.hyphenCache.set(word, syllables);
    return syllables;
  };
}

function measureFont(cs: CSSStyleDeclaration): string {
  // font 简写只取稳定的四项（style/weight/size/family）；shorthand 会把
  // line-height 重置为 normal，但测量只关心水平推进宽度，不受影响。
  return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
}

interface CollectedTokens {
  tokens: InlineToken[];
  /** seg 下标 → 样式来源元素（文本节点的直接父元素）。 */
  segElements: HTMLElement[];
}

/** 扁平化段落内联内容；遇到允许列表外的元素或 letter-spacing 时返回 null。 */
function collectTokens(p: HTMLElement): CollectedTokens | null {
  const tokens: InlineToken[] = [];
  const segElements: HTMLElement[] = [];
  const segIndex = new Map<HTMLElement, number>();

  const segOf = (el: HTMLElement): number => {
    let seg = segIndex.get(el);
    if (seg === undefined) {
      seg = segElements.length;
      segElements.push(el);
      segIndex.set(el, seg);
    }
    return seg;
  };

  const walk = (node: Node): boolean => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? "";
        if (text) tokens.push({ text, seg: segOf(child.parentElement ?? p) });
        continue;
      }
      if (child.nodeType === Node.COMMENT_NODE) continue;
      if (!(child instanceof HTMLElement)) return false;
      if (child.tagName === "BR") {
        tokens.push({ br: true });
        continue;
      }
      if (!ALLOWED_INLINE.has(child.tagName)) return false;
      if (child.tagName === "SPAN" && child.dataset.type !== undefined) return false;
      if (getComputedStyle(child).letterSpacing !== "normal") return false;
      if (!walk(child)) return false;
    }
    return true;
  };

  if (getComputedStyle(p).letterSpacing !== "normal") return null;
  return walk(p) ? { tokens, segElements } : null;
}

interface RenderedLine {
  el: HTMLElement;
  /** 该行内容应有的总宽度（悬挂行比版心宽出悬挂量）。 */
  target: number;
  /** 行内可参与残差校正的间隙；保留各自伸缩权重，避免无差别均摊。 */
  gaps: RenderedGap[];
  /** 末行与硬换行前的行按自然宽度排，不做残差校正。 */
  corrigible: boolean;
}

interface RenderedGap {
  el: HTMLElement;
  kind: "space" | "margin";
  width: number;
  natural: number;
  stretch: number;
  shrink: number;
}

function renderLines(
  p: HTMLElement,
  items: TypesetItem[],
  lines: { breakIndex: number; ratio: number }[],
  segElements: HTMLElement[],
  lineWidth: number,
): RenderedLine[] {
  // seg → 包裹链（文本节点父元素向上到 p，不含 p），用于按原样式重建行内容。
  const chains = segElements.map((el) => {
    const chain: HTMLElement[] = [];
    for (let cur = el; cur !== p && cur.parentElement; cur = cur.parentElement) {
      chain.unshift(cur);
    }
    return chain;
  });

  p.classList.add("amark-tl-paragraph");
  p.replaceChildren();
  const rendered: RenderedLine[] = [];
  let prevBreak = -1;

  for (const line of lines) {
    const lineEl = document.createElement("span");
    lineEl.className = "amark-tl-line";
    const gaps: RenderedGap[] = [];

    // 连续同 seg 的内容合并进同一个包裹链实例，避免逐字包 span。
    let currentSeg = -1;
    let currentInner: HTMLElement = lineEl;
    const innerFor = (seg: number): HTMLElement => {
      if (seg === currentSeg) return currentInner;
      currentSeg = seg;
      currentInner = lineEl;
      for (const el of chains[seg] ?? []) {
        const wrapper = el.cloneNode(false) as HTMLElement;
        currentInner.appendChild(wrapper);
        currentInner = wrapper;
      }
      return currentInner;
    };

    // 跳过行首的 glue/penalty（断行吞掉的空白），与 kp-core 的行起点一致。
    let start = prevBreak + 1;
    while (start < line.breakIndex && items[start]!.type !== "box") start++;

    for (let i = start; i < line.breakIndex; i++) {
      const item = items[i]!;
      if (item.type === "box") {
        innerFor(item.seg).append(item.text);
      } else if (item.type === "glue") {
        // 段末/硬换行前的 par-fill glue 只参与算法预算，不是可见间隙；
        // 渲染它会在末行 DOM 中制造一个数百像素的空 margin。
        if (item.width === 0 && item.stretch >= PAR_FILL_STRETCH) continue;
        const width =
          item.width + (line.ratio >= 0 ? line.ratio * item.stretch : line.ratio * item.shrink);
        if (item.text === " ") {
          // 空格间隙：word-spacing 叠加在空格自然宽度上。
          const space = document.createElement("span");
          const natural = item.width;
          space.style.wordSpacing = `${width - natural}px`;
          space.textContent = " ";
          innerFor(item.seg).appendChild(space);
          gaps.push({
            el: space,
            kind: "space",
            width,
            natural,
            stretch: item.stretch,
            shrink: item.shrink,
          });
        } else {
          // CJK/中西间隙：空 span 的 margin-left 承载正负间距（挤压为负）。
          // 宽度为 0 也要占位，供残差校正均摊。
          const gap = document.createElement("span");
          gap.style.marginLeft = `${width}px`;
          innerFor(item.seg).appendChild(gap);
          gaps.push({
            el: gap,
            kind: "margin",
            width,
            natural: 0,
            stretch: item.stretch,
            shrink: item.shrink,
          });
        }
      }
      // 行中 penalty 不产出内容（未断于其上时宽度为 0）。
    }

    // 断在连字符 penalty 上时行尾补 "-"；悬挂 penalty 无补渲（标点自然出界）。
    const breakItem = items[line.breakIndex] as TypesetPenalty | undefined;
    if (breakItem?.type === "penalty" && breakItem.text) {
      innerFor(breakItem.seg).append(breakItem.text);
    }

    // 目标宽度：普通行/连字符行为版心宽（连字符文本已把 penalty 宽度渲染回
    // 行内）；悬挂行（负宽 penalty、无补渲文本）比版心宽出悬挂量。
    let target = lineWidth;
    if (breakItem?.type === "penalty" && !breakItem.text) target -= breakItem.width;
    const corrigible = !(breakItem?.type === "penalty" && breakItem.cost <= FORCED_BREAK);

    p.appendChild(lineEl);
    rendered.push({ el: lineEl, target, gaps, corrigible });
    prevBreak = line.breakIndex;
  }
  return rendered;
}

/**
 * 逐行残差校正：KP 的预算基于逐段测量之和，而最终渲染还叠加合字、字距、
 * 亚像素舍入等引擎内部效应，行宽会差出可见的一两个像素。渲染后用同一
 * 布局引擎实测每行内容宽度，把与目标的微小差值按 glue 的伸缩能力加权
 * 分配。若差值已经大到不像舍入误差，则返回 false，让整段回退浏览器断行。
 * 先批量读、校验，再批量写，避免半段已改、半段回退。
 */
function correctResiduals(rendered: RenderedLine[]): boolean {
  const range = document.createRange();
  const residuals = rendered.map((line) => {
    if (!line.corrigible || line.gaps.length === 0) return 0;
    range.selectNodeContents(line.el);
    return line.target - range.getBoundingClientRect().width;
  });

  // 校正仅用于吸收 shaped-run 与逐项测量之间的亚像素误差。允许总计最多
  // 4px，且间隙越多才允许稍大的总误差；超出即说明模型失配，不应硬拉。
  for (let i = 0; i < rendered.length; i++) {
    const line = rendered[i]!;
    const residual = residuals[i]!;
    if (!line.corrigible || Math.abs(residual) < 0.25) continue;
    if (line.gaps.length === 0) return false;
    const safeLimit = Math.min(4, Math.max(1, line.gaps.length * 0.35));
    if (Math.abs(residual) > safeLimit) return false;
  }

  rendered.forEach((line, i) => {
    const residual = residuals[i]!;
    if (Math.abs(residual) < 0.25) return;
    const weights = line.gaps.map((gap) =>
      Math.max(0.01, residual >= 0 ? gap.stretch : gap.shrink),
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    line.gaps.forEach((gap, gapIndex) => {
      const delta = residual * (weights[gapIndex]! / totalWeight);
      const corrected = gap.width + delta;
      if (gap.kind === "space") {
        gap.el.style.wordSpacing = `${corrected - gap.natural}px`;
      } else {
        gap.el.style.marginLeft = `${corrected}px`;
      }
    });
  });
  return true;
}
