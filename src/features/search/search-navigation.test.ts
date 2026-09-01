// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollActiveSearchMatchIntoView, scrollTextareaOffsetIntoView } from "./search-navigation";

const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");

afterEach(() => {
  if (originalOffsetTop) {
    Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
  }
  document.body.replaceChildren();
});

describe("scrollTextareaOffsetIntoView", () => {
  it("scrolls from the measured wrapped-text position and keeps it above center", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "a long wrapped line\nneedle";
    textarea.style.whiteSpace = "pre-wrap";
    textarea.style.overflowWrap = "break-word";
    document.body.appendChild(textarea);

    Object.defineProperties(textarea, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 900 },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        return this.dataset.searchTextareaMarker === "true" ? 430 : 0;
      },
    });

    scrollTextareaOffsetIntoView(textarea, textarea.value.indexOf("needle"));

    expect(textarea.scrollTop).toBe(400);
    expect(document.querySelector('[data-search-textarea-mirror="true"]')).toBeNull();
  });

  it("clamps the measured position to the textarea scroll range", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "needle";
    document.body.appendChild(textarea);

    Object.defineProperties(textarea, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 250 },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        return this.dataset.searchTextareaMarker === "true" ? 500 : 0;
      },
    });

    scrollTextareaOffsetIntoView(textarea, 0);

    expect(textarea.scrollTop).toBe(150);
  });

  it("falls back when WebKit reports a zero marker position", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "first\nsecond\nneedle";
    document.body.appendChild(textarea);

    Object.defineProperties(textarea, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 900 },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() {
        return 0;
      },
    });

    scrollTextareaOffsetIntoView(textarea, textarea.value.indexOf("needle"));

    expect(textarea.scrollTop).toBeGreaterThan(0);
  });
});

describe("scrollActiveSearchMatchIntoView", () => {
  it("centers the active rich-text highlight", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="search-match-active">needle</span>';
    const activeMatch = root.firstElementChild as HTMLElement;
    const scrollIntoView = vi.fn();
    activeMatch.scrollIntoView = scrollIntoView;

    expect(scrollActiveSearchMatchIntoView(root)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
  });

  it("reports when no active highlight is rendered", () => {
    expect(scrollActiveSearchMatchIntoView(document.createElement("div"))).toBe(false);
  });
});
