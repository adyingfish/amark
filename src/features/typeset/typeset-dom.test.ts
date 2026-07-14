// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { collectTokens } from "./typeset-dom";

const rect = (width: number): DOMRect =>
  ({
    width,
    height: 16,
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: 16,
    left: 0,
    toJSON: () => ({}),
  }) as DOMRect;

describe("collectTokens", () => {
  it("把行内代码、公式和 file-ref 收集为可参与断行的原子盒", () => {
    const p = document.createElement("p");
    p.style.letterSpacing = "normal";
    p.innerHTML =
      'Run <code>vp build</code>，计算 <span data-type="math-inline"></span>，打开 <span data-type="file-ref">@README.md</span>。';
    document.body.appendChild(p);

    const code = p.querySelector("code")!;
    const math = p.querySelector<HTMLElement>('[data-type="math-inline"]')!;
    const fileRef = p.querySelector<HTMLElement>('[data-type="file-ref"]')!;
    // 模拟代码在浏览器原生布局里跨成两片；联合包围盒会严重高估宽度，
    // 收集器必须改测禁止换行的克隆。
    code.getClientRects = () => ({ length: 2 }) as DOMRectList;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.tagName === "CODE") return rect(62);
      return originalRect.call(this);
    };
    math.getBoundingClientRect = () => rect(48);
    fileRef.getBoundingClientRect = () => rect(86);

    let collected: ReturnType<typeof collectTokens>;
    try {
      collected = collectTokens(p);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
    expect(collected?.atomicElements).toEqual([code, math, fileRef]);
    expect(collected?.tokens.filter((token) => "atom" in token)).toEqual([
      { atom: 0, width: 62, seg: 0 },
      { atom: 1, width: 48, seg: 0 },
      { atom: 2, width: 86, seg: 0 },
    ]);

    p.remove();
  });
});
