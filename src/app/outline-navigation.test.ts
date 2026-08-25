// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { MarkdownOutlineItem } from "../features/outline/markdown-outline";
import { navigateToOutlineHeading } from "./outline-navigation";

const heading: MarkdownOutlineItem = {
  level: 2,
  text: "Target",
  line: 8,
  offset: 42,
  headingIndex: 1,
};

function makeTargets(): {
  source: HTMLTextAreaElement;
  richHost: HTMLElement;
  sourceScroll: ReturnType<typeof vi.fn>;
  headingScroll: ReturnType<typeof vi.fn>;
} {
  const source = document.createElement("textarea");
  source.style.fontSize = "16px";
  source.style.lineHeight = "24px";
  source.value = "x".repeat(100);
  const sourceScroll = vi.fn();
  source.scrollTo = sourceScroll;

  const richHost = document.createElement("div");
  richHost.innerHTML = '<div class="ProseMirror"><h1>First</h1><h2>Target</h2></div>';
  const renderedHeading = richHost.querySelectorAll<HTMLElement>("h1, h2")[1];
  const headingScroll = vi.fn();
  renderedHeading.scrollIntoView = headingScroll;

  return { source, richHost, sourceScroll, headingScroll };
}

describe("navigateToOutlineHeading", () => {
  it("scrolls both source and rendered panes in split mode", () => {
    const { source, richHost, sourceScroll, headingScroll } = makeTargets();

    navigateToOutlineHeading({ heading, mode: "split", source, richHost });

    expect(source.selectionStart).toBe(heading.offset);
    expect(sourceScroll).toHaveBeenCalledOnce();
    expect(headingScroll).toHaveBeenCalledOnce();
  });

  it("only scrolls the source pane in source mode", () => {
    const { source, richHost, sourceScroll, headingScroll } = makeTargets();

    navigateToOutlineHeading({ heading, mode: "source", source, richHost });

    expect(sourceScroll).toHaveBeenCalledOnce();
    expect(headingScroll).not.toHaveBeenCalled();
  });

  it("only scrolls the rendered pane in rich modes", () => {
    const { source, richHost, sourceScroll, headingScroll } = makeTargets();

    navigateToOutlineHeading({ heading, mode: "wysiwyg", source, richHost });

    expect(sourceScroll).not.toHaveBeenCalled();
    expect(headingScroll).toHaveBeenCalledOnce();
  });
});
