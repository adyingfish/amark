import { describe, expect, it } from "vitest";
import { FORCED_BREAK, INFINITE_PENALTY, breakLines, finishItems, type KpItem } from "./kp-core";

const box = (width: number): KpItem => ({ type: "box", width });
const glue = (width: number, stretch: number, shrink: number): KpItem => ({
  type: "glue",
  width,
  stretch,
  shrink,
});
const penalty = (width: number, cost: number, flagged = false): KpItem => ({
  type: "penalty",
  width,
  cost,
  flagged,
});

describe("breakLines", () => {
  it("把均匀词流断成多行且每行调整比可行", () => {
    // 6 个 40 宽的词、10±5/3.3 的空格，行宽 100。
    const items: KpItem[] = [];
    for (let i = 0; i < 6; i++) {
      if (i > 0) items.push(glue(10, 5, 3.3));
      items.push(box(40));
    }
    finishItems(items);

    const lines = breakLines(items, 100);
    expect(lines).not.toBeNull();
    expect(lines!.length).toBeGreaterThanOrEqual(2);
    for (const line of lines!) {
      expect(line.ratio).toBeGreaterThanOrEqual(-1);
    }
    // 末行断在收尾 forced penalty 上。
    expect(lines![lines!.length - 1]!.breakIndex).toBe(items.length - 1);
  });

  it("单个超宽 box 无可行断点时返回 null", () => {
    const items = finishItems([box(500)]);
    expect(breakLines(items, 100)).toBeNull();
  });

  it("悬挂 penalty 的负宽度只在断于其上时计入", () => {
    // 行宽 100：不悬挂则首行 110 宽且无 shrink（不可行），
    // 悬挂后 90 宽、ratio=1，是唯一可行首行断点。
    const items = finishItems([
      box(30),
      glue(0, 5, 0),
      box(30),
      glue(0, 5, 0),
      box(30),
      box(20), // 行尾标点
      penalty(-20, 5), // 悬挂候选
      glue(0, 5, 0),
      box(80),
    ]);
    const lines = breakLines(items, 100);
    expect(lines).not.toBeNull();
    expect(lines![0]!.breakIndex).toBe(6);
    expect(lines![0]!.ratio).toBeCloseTo(1);
  });

  it("低代价 penalty 之后的 glue 也是合法断点（悬挂/不悬挂双候选）", () => {
    // 经典规则下 glue 前是 penalty 即不可断，本实现放宽后
    // 首行可断在 penalty 后的 glue 上（不悬挂、恰好满行）。
    const items = finishItems([box(80), box(20), penalty(-20, 5), glue(0, 5, 0), box(80)]);
    const lines = breakLines(items, 100);
    expect(lines).not.toBeNull();
    expect(lines![0]!.breakIndex).toBe(3);
    expect(lines![0]!.ratio).toBe(0);
  });

  it("断在带宽度的连字符 penalty 上时宽度计入行内", () => {
    const items = finishItems([box(50), penalty(10, 45, true), box(50)]);
    const lines = breakLines(items, 60);
    expect(lines).not.toBeNull();
    expect(lines![0]!.breakIndex).toBe(1);
    expect(lines![0]!.ratio).toBe(0);
  });

  it("段内 forced break 必须被采用", () => {
    const items = finishItems([
      box(30),
      glue(0, 1e7, 0),
      { type: "penalty", width: 0, cost: FORCED_BREAK, flagged: false },
      box(30),
    ]);
    const lines = breakLines(items, 100);
    expect(lines).not.toBeNull();
    expect(lines!.map((l) => l.breakIndex)).toEqual([2, items.length - 1]);
  });

  it("cost 为 INFINITE 的 penalty 永远不是断点", () => {
    // 两词之间用 INF penalty + glue 禁断：即使这是唯一“自然”断点也不可用，
    // 只能整体塞进末行（借助收尾 glue 的无限拉伸不可行 → 应回 null）。
    const items = finishItems([
      box(80),
      { type: "penalty", width: 0, cost: INFINITE_PENALTY, flagged: false },
      glue(0, 5, 0),
      box(80),
    ]);
    const lines = breakLines(items, 100);
    expect(lines).toBeNull();
  });
});
