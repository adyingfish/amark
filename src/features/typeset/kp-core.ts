// kp-core.ts - Pure Knuth-Plass line breaking over box/glue/penalty items.
//
// 与经典 KP 的唯一差异：glue 的合法断点条件放宽为「前一项是 box，或
// cost < INFINITE_PENALTY 的 penalty」。这让「悬挂 penalty + 紧随 glue」
// 构成一对互斥候选（悬挂断点 / 不悬挂断点）在同一次 DP 中竞争，
// 是标点悬挂建模的关键（见 debug/kp-typesetting-plan.html）。
//
// 本模块是纯函数，不依赖 DOM；宽度单位由调用方决定（像素）。

export const INFINITE_PENALTY = 1000;
export const FORCED_BREAK = -1000;
/** 段末/硬换行前用于吸收剩余行宽、从而保持末行左对齐的弹性胶。 */
export const PAR_FILL_STRETCH = 1e7;

export interface KpBox {
  type: "box";
  width: number;
  /** 盒内不可断内容可参与的微量伸缩（例如西文字间距）。 */
  stretch?: number;
  shrink?: number;
}

export interface KpGlue {
  type: "glue";
  width: number;
  stretch: number;
  shrink: number;
}

export interface KpPenalty {
  type: "penalty";
  /** 断在此处时计入行宽；负值表示行尾内容悬挂出版心。 */
  width: number;
  cost: number;
  /** 连字符断点标记：连续两行都断在 flagged penalty 时追加 demerits。 */
  flagged: boolean;
}

export type KpItem = KpBox | KpGlue | KpPenalty;

export interface KpOptions {
  /** 首轮允许的最大拉伸比，默认 4。 */
  tolerance?: number;
  /** 失败重试时允许放宽到的硬上限，默认 8；超过后回退原生断行。 */
  maxTolerance?: number;
  linePenalty?: number;
  doubleHyphenDemerits?: number;
  /** 相邻行跨越两个及以上松紧等级时追加的 demerits，默认 3000。 */
  adjacentFitnessDemerits?: number;
  /** 多行段落末行至少占版心的比例，默认 0.25；不足则换断点或回退。 */
  minLastLineRatio?: number;
}

export interface KpLine {
  /** 行尾断点的 item 下标（glue 或 penalty；末行为收尾 forced penalty）。 */
  breakIndex: number;
  /** 调整比 r：正值按 stretch 拉伸，负值按 shrink 压缩。 */
  ratio: number;
}

/** 追加段落收尾三件套：禁断 penalty + 无限拉伸 glue + 强制断点。 */
export function finishItems(items: KpItem[]): KpItem[] {
  items.push(
    { type: "penalty", width: 0, cost: INFINITE_PENALTY, flagged: false },
    { type: "glue", width: 0, stretch: PAR_FILL_STRETCH, shrink: 0 },
    { type: "penalty", width: 0, cost: FORCED_BREAK, flagged: false },
  );
  return items;
}

interface KpNode {
  breakIndex: number;
  demerits: number;
  ratio: number;
  fitness: FitnessClass;
  flagged: boolean;
  forced: boolean;
  prev: KpNode | null;
}

/** TeX 的四档行松紧等级；相邻行跨档过大时会产生明显的密度跳变。 */
type FitnessClass = 0 | 1 | 2 | 3;

function fitnessClass(ratio: number): FitnessClass {
  if (ratio < -0.5) return 0; // tight
  if (ratio <= 0.5) return 1; // decent
  if (ratio <= 1) return 2; // loose
  return 3; // very loose
}

/**
 * 对 items 求最优断行。失败时按 tolerance ×2 重试，但不会超过
 * maxTolerance；仍不可行则返回 null（调用方回退浏览器原生换行）。
 * items 须已 finishItems()。
 */
export function breakLines(
  items: KpItem[],
  lineWidth: number,
  opts: KpOptions = {},
): KpLine[] | null {
  const baseTolerance = Math.max(0.1, opts.tolerance ?? 4);
  const maxTolerance = Math.max(baseTolerance, opts.maxTolerance ?? 8);
  let tolerance = baseTolerance;
  while (true) {
    const lines = tryBreak(items, lineWidth, tolerance, opts);
    if (lines) return lines;
    if (tolerance >= maxTolerance) return null;
    tolerance = Math.min(tolerance * 2, maxTolerance);
  }
}

function tryBreak(
  items: KpItem[],
  lineWidth: number,
  tolerance: number,
  opts: KpOptions,
): KpLine[] | null {
  const linePenalty = opts.linePenalty ?? 10;
  const doubleHyphenDemerits = opts.doubleHyphenDemerits ?? 3000;
  const adjacentFitnessDemerits = opts.adjacentFitnessDemerits ?? 3000;
  const minLastLineRatio = Math.max(0, Math.min(1, opts.minLastLineRatio ?? 0.25));
  const n = items.length;

  // 前缀和（不含 penalty 的宽度——penalty 宽度只在断于其上时计入）。
  const sumW = new Float64Array(n + 1);
  const sumS = new Float64Array(n + 1);
  const sumZ = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    const isGlue = it.type === "glue";
    const isBox = it.type === "box";
    sumW[i + 1] = sumW[i]! + (it.type === "penalty" ? 0 : it.width);
    sumS[i + 1] = sumS[i]! + (isGlue ? it.stretch : isBox ? (it.stretch ?? 0) : 0);
    sumZ[i + 1] = sumZ[i]! + (isGlue ? it.shrink : isBox ? (it.shrink ?? 0) : 0);
  }

  const isLegalBreak = (i: number): boolean => {
    const it = items[i]!;
    if (it.type === "penalty") return it.cost < INFINITE_PENALTY;
    if (it.type === "glue" && i > 0) {
      const prev = items[i - 1]!;
      return prev.type === "box" || (prev.type === "penalty" && prev.cost < INFINITE_PENALTY);
    }
    return false;
  };

  // 行起点：断点之后跳过行首的 glue / penalty（换行即吞掉的空白）。
  const lineStartAfter = (breakIndex: number): number => {
    let i = breakIndex < 0 ? 0 : breakIndex + 1;
    while (i < n && items[i]!.type !== "box") {
      if (items[i]!.type === "penalty" && (items[i] as KpPenalty).cost <= FORCED_BREAK) break;
      i++;
    }
    return i;
  };

  const start: KpNode = {
    breakIndex: -1,
    demerits: 0,
    ratio: 0,
    fitness: 1,
    flagged: false,
    forced: true,
    prev: null,
  };
  const nodes: KpNode[] = [start];
  let last: KpNode | null = null;

  for (let b = 0; b < n; b++) {
    if (!isLegalBreak(b)) continue;
    const item = items[b]!;
    const penaltyCost = item.type === "penalty" ? item.cost : 0;
    const penaltyWidth = item.type === "penalty" ? item.width : 0;
    const isForced = penaltyCost <= FORCED_BREAK;
    const isFlagged = item.type === "penalty" && item.flagged;

    // 不能只保留每个断点的单一最低分节点：未来一行的 fitness demerits
    // 取决于上一行的松紧等级，因此每一档都必须保留自己的最优前驱。
    const bestByFitness: Array<KpNode | null> = [null, null, null, null];
    for (const a of nodes) {
      const from = lineStartAfter(a.breakIndex);
      if (from >= b && !isForced) continue;
      const natural = sumW[b]! - sumW[from]! + penaltyWidth;
      const stretch = sumS[b]! - sumS[from]!;
      const shrink = sumZ[b]! - sumZ[from]!;

      // finishItems 的无限弹性会让任何长度的末行 badness≈0。若这是普通
      // 多行段落，则先挡住过短末行；显式硬换行后的短行视为作者意图。
      const isParagraphEnd = isForced && b === n - 1;
      if (
        isParagraphEnd &&
        a.breakIndex >= 0 &&
        !a.forced &&
        natural < lineWidth * minLastLineRatio
      ) {
        continue;
      }

      let ratio: number;
      if (natural < lineWidth) {
        ratio = stretch > 0 ? (lineWidth - natural) / stretch : Infinity;
      } else if (natural > lineWidth) {
        ratio = shrink > 0 ? (lineWidth - natural) / shrink : -Infinity;
      } else {
        ratio = 0;
      }

      if (ratio < -1) continue;
      if (ratio > tolerance && !isForced) continue;

      const badness = 100 * Math.abs(ratio) ** 3;
      let demerits = (linePenalty + Math.min(badness, 10_000)) ** 2;
      if (penaltyCost > 0) demerits += penaltyCost * penaltyCost;
      else if (!isForced && penaltyCost < 0) demerits -= penaltyCost * penaltyCost;
      if (!a.forced && isFlagged && a.flagged) demerits += doubleHyphenDemerits;

      const fitness = fitnessClass(ratio);
      if (!a.forced && Math.abs(fitness - a.fitness) > 1) {
        demerits += adjacentFitnessDemerits;
      }

      const total = a.demerits + demerits;
      const current = bestByFitness[fitness];
      if (!current || total < current.demerits) {
        bestByFitness[fitness] = {
          breakIndex: b,
          demerits: total,
          ratio,
          fitness,
          flagged: isFlagged,
          forced: isForced,
          prev: a,
        };
      }
    }

    const best = bestByFitness.filter((node): node is KpNode => node !== null);
    if (best.length === 0) {
      if (isForced) return null; // 收尾断点都不可达 → 本轮 tolerance 失败
      continue;
    }
    if (isForced) {
      // forced break 必须被采用：淘汰其之前的所有活动节点，后续行只能从这里续。
      nodes.length = 0;
      last = best.reduce((winner, node) => (node.demerits < winner.demerits ? node : winner));
    }
    nodes.push(...best);
  }

  if (!last) return null;
  const lines: KpLine[] = [];
  for (let node: KpNode | null = last; node && node.breakIndex >= 0; node = node.prev) {
    lines.unshift({ breakIndex: node.breakIndex, ratio: node.ratio });
  }
  return lines;
}
