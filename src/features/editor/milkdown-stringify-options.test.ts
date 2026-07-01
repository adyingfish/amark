import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkStringify from "remark-stringify";
import type { Options } from "mdast-util-to-markdown";
import type { Root } from "mdast";
import { buildStringifyOptions } from "./milkdown-stringify-options";

// Serialize an mdast tree the way Milkdown does: stock remark-stringify options
// with our overrides merged on top, plus the GFM/breaks toMarkdown extensions
// the editor registers (so task lists etc. behave as they do in the app).
function serialize(tree: Root, base: Options = {}): string {
  return unified()
    .use(remarkParse)
    .use(remarkStringify, buildStringifyOptions(base))
    .use(remarkGfm)
    .use(remarkBreaks)
    .stringify(tree);
}

// Parse like the editor's parse pass (transformers run, so remark-breaks turns
// soft wraps into hard breaks), then re-serialize. Mirrors Milkdown's quirk of
// storing the list `spread` flag as a *string* by stamping it onto the tree.
function roundtrip(markdown: string): string {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkBreaks);
  const tree = parser.runSync(parser.parse(markdown)) as Root;
  stampStringSpread(tree);
  return serialize(tree);
}

function stampStringSpread(node: { type: string; spread?: unknown; children?: unknown[] }): void {
  if (node.type === "list") {
    const value = String(Boolean(node.spread));
    node.spread = value;
    for (const child of (node.children ?? []) as Array<{ type: string; spread?: unknown }>) {
      if (child.type === "listItem") child.spread = value;
    }
  }
  for (const child of (node.children ?? []) as Array<{ type: string; children?: unknown[] }>) {
    stampStringSpread(child);
  }
}

describe("buildStringifyOptions", () => {
  it("preserves handlers and options the caller already injected", () => {
    const marker = { strong: () => "STRONG" } as unknown as Options["handlers"];
    const merged = buildStringifyOptions({ handlers: marker, incrementListMarker: false });
    expect(merged.handlers?.strong).toBe(marker!.strong);
    expect(merged.incrementListMarker).toBe(false);
    expect(merged.bullet).toBe("-");
    expect(merged.rule).toBe("-");
  });

  it("uses '-' for bullet lists instead of '*'", () => {
    expect(roundtrip("- a\n- b\n")).toBe("- a\n- b\n");
  });

  it("uses '---' for thematic breaks instead of '***'", () => {
    expect(roundtrip("a\n\n---\n\nb\n")).toBe("a\n\n---\n\nb\n");
  });

  it('keeps a tight list tight despite the string-"false" spread quirk', () => {
    expect(roundtrip("- a\n- b\n- c\n")).toBe("- a\n- b\n- c\n");
  });

  it("keeps a nested tight list tight", () => {
    expect(roundtrip("- parent\n  - child1\n  - child2\n- sibling\n")).toBe(
      "- parent\n  - child1\n  - child2\n- sibling\n",
    );
  });

  it("leaves genuinely loose lists loose", () => {
    expect(roundtrip("- a\n\n- b\n")).toBe("- a\n\n- b\n");
  });

  it("preserves ordered list numbering (does not render 0. / -1.)", () => {
    expect(roundtrip("1. one\n2. two\n3. three\n")).toBe("1. one\n2. two\n3. three\n");
  });

  it("preserves GFM task list checkboxes", () => {
    expect(roundtrip("- [ ] todo\n- [x] done\n")).toBe("- [ ] todo\n- [x] done\n");
  });

  it("emits line breaks as a plain newline, not a trailing '\\'", () => {
    expect(roundtrip("line one\nline two\n")).toBe("line one\nline two\n");
    expect(roundtrip("line one  \nline two\n")).toBe("line one\nline two\n");
  });

  it("emits a plain http(s) URL bare instead of wrapping it in <>", () => {
    expect(roundtrip("https://example.com\n").trim()).toBe("https://example.com");
    expect(roundtrip("see https://example.com/ here\n").trim()).toBe(
      "see https://example.com/ here",
    );
  });

  it("keeps labelled links untouched", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "https://example.com",
              children: [{ type: "text", value: "click" }],
            },
          ],
        },
      ],
    } as Root;
    expect(serialize(tree).trim()).toBe("[click](https://example.com)");
  });

  it("falls back to <> when a bare URL ends in punctuation GFM would trim", () => {
    const url = "https://en.wikipedia.org/wiki/Foo_(bar)";
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "link", url, children: [{ type: "text", value: url }] }],
        },
      ],
    } as Root;
    expect(serialize(tree).trim()).toBe(`<${url}>`);
  });
});
