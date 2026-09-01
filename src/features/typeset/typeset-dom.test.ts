// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTokens, TypesetController } from "./typeset-dom";

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
  it("显示公式所在段落回退浏览器布局，不作为 KP 行内原子", () => {
    const p = document.createElement("p");
    p.style.letterSpacing = "normal";
    p.innerHTML = '<span data-type="math-inline" data-display="true"></span>';

    expect(collectTokens(p)).toBeNull();
  });

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

describe("TypesetController search navigation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("scrolls the visible mirror when the active search decoration changes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    const host = document.createElement("div");
    host.innerHTML =
      '<div class="ProseMirror"><div><span class="search-match">needle</span></div></div>';
    document.body.appendChild(host);
    const controller = new TypesetController(host);

    try {
      controller.enable();
      const realMatch = host.querySelector<HTMLElement>(
        ".ProseMirror:not(.amark-typeset-mirror) .search-match",
      )!;
      realMatch.classList.add("search-match-active");
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(150);

      expect(host.querySelector(".amark-typeset-mirror .search-match-active")).not.toBeNull();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    } finally {
      controller.disable();
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
