import { describe, expect, it } from "vitest";
import { extractMarkdownOutline } from "./markdown-outline";

describe("extractMarkdownOutline", () => {
  it("extracts ATX and setext headings in document order", () => {
    const markdown = ["# Title", "", "Section", "-------", "", "### Details"].join("\n");

    expect(extractMarkdownOutline(markdown)).toEqual([
      { level: 1, text: "Title", line: 1, offset: 0, headingIndex: 0 },
      { level: 2, text: "Section", line: 3, offset: 9, headingIndex: 1 },
      { level: 3, text: "Details", line: 6, offset: 26, headingIndex: 2 },
    ]);
  });

  it("ignores heading syntax inside fenced code blocks", () => {
    const markdown = ["# Visible", "```md", "## Hidden", "```", "## Also visible"].join("\n");

    expect(extractMarkdownOutline(markdown).map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: "Visible" },
      { level: 2, text: "Also visible" },
    ]);
  });

  it("cleans common inline Markdown from heading labels", () => {
    const markdown = "## [Link](https://example.com), **bold**, and `code` ##";

    expect(extractMarkdownOutline(markdown)[0]?.text).toBe("Link, bold, and code");
  });

  it("does not treat hash characters without a separating space as headings", () => {
    expect(extractMarkdownOutline("#not-a-heading\n####### also-not")).toEqual([]);
  });

  it("keeps rendered heading indexes aligned when an empty heading is omitted", () => {
    expect(extractMarkdownOutline("#\n## Visible")[0]?.headingIndex).toBe(1);
  });

  it("supports Windows line endings without changing source offsets", () => {
    expect(extractMarkdownOutline("# First\r\n\r\n## Second\r\n")).toEqual([
      { level: 1, text: "First", line: 1, offset: 0, headingIndex: 0 },
      { level: 2, text: "Second", line: 3, offset: 11, headingIndex: 1 },
    ]);
  });
});
