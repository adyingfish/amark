import { describe, expect, it } from "vitest";
import { FORCED_BREAK, INFINITE_PENALTY, breakLines } from "./kp-core";
import { HANG_COST, buildItems, type TypesetItem, type TypesetMeasure } from "./inline-items";

// 假测量：每个码点 10px，em 也是 10px，便于手算宽度。
const measure: TypesetMeasure = {
  text: (text) => 10 * [...text].length,
  em: () => 10,
};

const boxes = (items: TypesetItem[]): string[] =>
  items.filter((it) => it.type === "box").map((it) => it.text);

const indexOfBox = (items: TypesetItem[], text: string): number =>
  items.findIndex((it) => it.type === "box" && it.text === text);

describe("buildItems", () => {
  it("纯中文：逐字成 box，字间是 0 宽微伸 glue", () => {
    const items = buildItems([{ text: "你好世界", seg: 0 }], measure);
    expect(boxes(items)).toEqual(["你", "好", "世", "界"]);
    const gap = items[1]!;
    expect(gap).toMatchObject({ type: "glue", width: 0, stretch: 0.5, shrink: 0 });
  });

  it("避头 + 挤压 + 全角悬挂：「你好。世界」", () => {
    const items = buildItems([{ text: "你好。世界", seg: 0 }], measure);
    const stop = indexOfBox(items, "。");
    // 句号前：INF penalty 禁断（。不可居行首），再接字间 glue。
    expect(items[stop - 2]).toMatchObject({ type: "penalty", cost: INFINITE_PENALTY });
    expect(items[stop - 1]!.type).toBe("glue");
    // 句号后：负宽悬挂候选 + 可挤压半宽的 glue。
    expect(items[stop + 1]).toMatchObject({ type: "penalty", width: -10, cost: HANG_COST });
    expect(items[stop + 2]).toMatchObject({ type: "glue", shrink: 5 });
  });

  it("紧跟 CJK 的半角句读：贴前字禁断、可按实测宽度悬挂", () => {
    const items = buildItems([{ text: "像这样,或这样.", seg: 0 }], measure);
    const comma = indexOfBox(items, ",");
    // 逗号紧贴前字：中间无任何 glue/penalty（无断点即避头）。
    expect(items[comma - 1]).toMatchObject({ type: "box", text: "样" });
    // 逗号后：悬挂候选 + 中西间隙 glue（em/8）。
    expect(items[comma + 1]).toMatchObject({ type: "penalty", width: -10, cost: HANG_COST });
    expect(items[comma + 2]).toMatchObject({ type: "glue", width: 1.25 });
    // 句尾半角句号同样贴前字。
    const period = indexOfBox(items, ".");
    expect(items[period - 1]).toMatchObject({ type: "box", text: "样" });
  });

  it("中西文之间插入 em/8 间隙", () => {
    const items = buildItems([{ text: "中文English中文", seg: 0 }], measure);
    const word = indexOfBox(items, "English");
    expect(items[word - 1]).toMatchObject({ type: "glue", width: 1.25 });
    expect(items[word + 1]).toMatchObject({ type: "glue", width: 1.25 });
  });

  it("西文词内断词：音节 box 之间是 flagged 连字符 penalty", () => {
    const items = buildItems([{ text: "a typesetting b", seg: 0 }], measure, {
      hyphenate: (word) => (word === "typesetting" ? ["type", "set", "ting"] : [word]),
    });
    expect(boxes(items)).toEqual(["a", "type", "set", "ting", "b"]);
    const flagged = items.filter((it) => it.type === "penalty" && it.flagged);
    expect(flagged).toHaveLength(2);
    // 连字符 penalty 携带 "-" 的实测宽度，断于其上时渲染补 "-"。
    expect(flagged[0]).toMatchObject({ width: 10, text: "-" });
    // 空格 glue：宽 w、伸 w/2、缩 w/3。
    const space = items.find((it) => it.type === "glue" && it.text === " ");
    expect(space).toMatchObject({ width: 10, stretch: 5 });
  });

  it("短单词不做词内断词", () => {
    const items = buildItems([{ text: "hello world", seg: 0 }], measure, {
      hyphenate: () => {
        throw new Error("不应触发");
      },
      minHyphenateLength: 6,
    });
    expect(boxes(items)).toEqual(["hello", "world"]);
  });

  it("段内硬换行编译为无限拉伸 glue + forced penalty", () => {
    const items = buildItems(
      [{ text: "你好", seg: 0 }, { br: true }, { text: "世界", seg: 0 }],
      measure,
    );
    const forced = items.findIndex((it) => it.type === "penalty" && it.cost === FORCED_BREAK);
    expect(forced).toBeGreaterThan(0);
    expect(forced).toBeLessThan(items.length - 1); // 不是段落收尾那个
    expect(items[forced - 1]).toMatchObject({ type: "glue", stretch: 1e7 });
  });

  it("与 breakLines 集成：混排段落可行断行", () => {
    const items = buildItems(
      [
        {
          text: "这是一个用于验证断行的中文段落，其中夹着English words，以及句号。结尾再补一些字。",
          seg: 0,
        },
      ],
      measure,
    );
    const lines = breakLines(items, 100);
    expect(lines).not.toBeNull();
    expect(lines!.length).toBeGreaterThan(2);
    for (const line of lines!) {
      expect(line.ratio).toBeGreaterThanOrEqual(-1);
    }
  });
});
