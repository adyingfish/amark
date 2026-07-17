// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { renderMermaidBlocksInHtml } from "./export-document";

const bindFunctionsMock = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => {
      if (source.includes("broken")) {
        throw new Error("Parse error on line 1");
      }
      return { svg: '<svg data-mermaid-mock="true"></svg>', bindFunctions: bindFunctionsMock };
    }),
  },
}));

describe("renderMermaidBlocksInHtml", () => {
  it("replaces mermaid fences with rendered SVG diagrams", async () => {
    const html =
      '<p>before</p><pre data-language="mermaid"><code>graph TD;\nA--&gt;B;</code></pre><p>after</p>';

    const out = await renderMermaidBlocksInHtml(html);

    expect(vi.mocked(mermaid.render)).toHaveBeenCalledWith(expect.any(String), "graph TD;\nA-->B;");
    // Exported documents are static: no mermaid runtime exists in the output
    // file, so interactive behaviors are deliberately not bound.
    expect(bindFunctionsMock).not.toHaveBeenCalled();
    expect(out).toContain('class="mermaid-diagram"');
    expect(out).toContain('data-mermaid-mock="true"');
    expect(out).not.toContain("<pre");
    expect(out).toContain("<p>before</p>");
    expect(out).toContain("<p>after</p>");
  });

  it("returns html without mermaid blocks unchanged", async () => {
    const html = '<pre data-language="python"><code>print(1)</code></pre>';

    expect(await renderMermaidBlocksInHtml(html)).toBe(html);
  });

  it("keeps the source fence when rendering fails", async () => {
    const html = '<pre data-language="mermaid"><code>broken</code></pre>';

    const out = await renderMermaidBlocksInHtml(html);

    expect(out).toContain("<pre");
    expect(out).toContain("broken");
  });
});
