// typeset-dom.ts - 只读预览的 KP 排版控制器（镜像架构）。
//
// 绝不改写 ProseMirror 的活动 DOM——PM 的 DOMObserver 不区分可编辑状态，
// 任何改动都会被回读成文档事务、污染内容。做法是：把 .ProseMirror 整体
// 克隆成一次性镜像兄弟节点，CSS 隐藏真身、只显示镜像，在镜像里逐段重排。
// 真身任何变化（split 模式打字、换文档、换主题、容器变宽）都触发防抖后
// 整体重建镜像，因此无需任何“还原原文”的簿记。
//
// 排版仅作用于计算样式为 text-align: justify 的段落（academic 主题正文）；
// 含允许列表之外元素的段落原样保留浏览器换行。

import { hyphenateSync } from "hyphen/en";
import { breakLines } from "./kp-core";
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

  private readonly measureCanvas = document.createElement("canvas").getContext("2d");
  /** font 短横线串 → (文本 → 宽度) 两级缓存。 */
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
    if (!this.measureCanvas) return;
    const cs = getComputedStyle(p);
    if (cs.textAlign !== "justify") return;
    if (cs.textIndent !== "0px") return;

    const collected = collectTokens(p);
    if (!collected) return;
    const { tokens, segElements } = collected;

    const lineWidth = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (!(lineWidth > 0)) return;

    const fonts = segElements.map((el) => canvasFont(getComputedStyle(el)));
    const measure = {
      text: (text: string, seg: number): number => this.measureText(text, fonts[seg]!),
      em: (seg: number): number => parseFloat(getComputedStyle(segElements[seg]!).fontSize),
    };

    const items = buildItems(tokens, measure, { hyphenate: this.hyphenate });
    if (!items.some((it) => it.type === "box")) return;
    const lines = breakLines(items, lineWidth);
    if (!lines) return; // 不可行（如超长不可断内容）→ 保留浏览器换行

    renderLines(p, items, lines, segElements);
  }

  private measureText(text: string, font: string): number {
    let byText = this.widthCache.get(font);
    if (!byText) {
      byText = new Map();
      this.widthCache.set(font, byText);
    }
    const cached = byText.get(text);
    if (cached !== undefined) return cached;
    const ctx = this.measureCanvas!;
    ctx.font = font;
    const width = ctx.measureText(text).width;
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

function canvasFont(cs: CSSStyleDeclaration): string {
  // 只取 canvas font 简写稳定支持的四项；fontVariant 的复杂计算值会让
  // 赋值静默失败、回退默认字体，导致测量整体错误。
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

function renderLines(
  p: HTMLElement,
  items: TypesetItem[],
  lines: { breakIndex: number; ratio: number }[],
  segElements: HTMLElement[],
): void {
  // seg → 包裹链（文本节点父元素向上到 p，不含 p），用于按原样式重建行内容。
  const chains = segElements.map((el) => {
    const chain: HTMLElement[] = [];
    for (let cur = el; cur !== p && cur.parentElement; cur = cur.parentElement) {
      chain.unshift(cur);
    }
    return chain;
  });

  p.replaceChildren();
  let prevBreak = -1;

  for (const line of lines) {
    const lineEl = document.createElement("span");
    lineEl.className = "amark-tl-line";

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
        const width =
          item.width + (line.ratio >= 0 ? line.ratio * item.stretch : line.ratio * item.shrink);
        if (item.text === " ") {
          // 空格间隙：word-spacing 叠加在空格自然宽度上。
          const space = document.createElement("span");
          const natural = item.width;
          space.style.wordSpacing = `${width - natural}px`;
          space.textContent = " ";
          innerFor(item.seg).appendChild(space);
        } else if (width !== 0) {
          // CJK/中西间隙：空 span 的 margin-left 承载正负间距（挤压为负）。
          const gap = document.createElement("span");
          gap.style.marginLeft = `${width}px`;
          innerFor(item.seg).appendChild(gap);
        }
      }
      // 行中 penalty 不产出内容（未断于其上时宽度为 0）。
    }

    // 断在连字符 penalty 上时行尾补 "-"；悬挂 penalty 无补渲（标点自然出界）。
    const breakItem = items[line.breakIndex] as TypesetPenalty | undefined;
    if (breakItem?.type === "penalty" && breakItem.text) {
      innerFor(breakItem.seg).append(breakItem.text);
    }

    p.appendChild(lineEl);
    prevBreak = line.breakIndex;
  }
}
