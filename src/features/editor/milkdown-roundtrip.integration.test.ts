// @vitest-environment jsdom
//
// Real end-to-end round-trip test: builds the actual Milkdown editor with the
// same config as MilkdownAdapter (commonmark + gfm + remark-breaks +
// buildStringifyOptions) and serializes via getMarkdown(). Unlike the
// synthetic-tree unit test this exercises Milkdown's real ProseMirror -> mdast
// -> remark-stringify path, so it catches fidelity bugs the unit test cannot.
//
// getMarkdown() always terminates the document with a single trailing newline,
// so we compare against the source with that newline appended.

import { describe, expect, it } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { getMarkdown } from "@milkdown/kit/utils";
import remarkBreaks from "remark-breaks";
import { buildStringifyOptions } from "./milkdown-stringify-options";

async function createEditor(
  markdown: string,
): Promise<{ container: HTMLDivElement; editor: Editor }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(remarkPluginsCtx, [{ plugin: remarkBreaks, options: {} }]);
      ctx.set(remarkStringifyOptionsCtx, buildStringifyOptions(ctx.get(remarkStringifyOptionsCtx)));
    })
    .use(commonmark)
    .use(gfm)
    .create();
  return { container, editor };
}

async function roundtrip(markdown: string): Promise<string> {
  const { container, editor } = await createEditor(markdown);
  const out = editor.action(getMarkdown());
  editor.destroy();
  container.remove();
  return out;
}

async function renderHtml(markdown: string): Promise<string> {
  const { container, editor } = await createEditor(markdown);
  const html = container.innerHTML;
  editor.destroy();
  container.remove();
  return html;
}

describe("milkdown real round-trip", () => {
  it("keeps a tight bullet list tight (not loose, not '*')", async () => {
    expect(await roundtrip("- a\n- b\n- c")).toBe("- a\n- b\n- c\n");
  });

  it("keeps a multi-item feature list tight", async () => {
    const src = ["- 4 built-in themes", "- Custom CSS theme import", "- Theme persistence"].join(
      "\n",
    );
    expect(await roundtrip(src)).toBe(`${src}\n`);
  });

  it("leaves a genuinely loose list loose", async () => {
    expect(await roundtrip("- a\n\n- b")).toBe("- a\n\n- b\n");
  });

  it("preserves ordered list numbering", async () => {
    expect(await roundtrip("1. one\n2. two\n3. three")).toBe("1. one\n2. two\n3. three\n");
  });

  it("preserves GFM task list checkboxes", async () => {
    expect(await roundtrip("- [ ] todo\n- [x] done")).toBe("- [ ] todo\n- [x] done\n");
  });

  it("renders GFM task list checkboxes in the editor DOM", async () => {
    const html = await renderHtml("- [ ] todo\n- [x] done");

    expect(html).toContain('data-item-type="task"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');
    expect(html).not.toContain("[ ]");
    expect(html).not.toContain("[x]");
  });

  it("keeps a soft-wrapped paragraph free of stray backslashes", async () => {
    expect(await roundtrip("line one\nline two")).toBe("line one\nline two\n");
  });

  it("emits a bare plain URL, not <...>", async () => {
    expect(await roundtrip("https://example.com")).toBe("https://example.com\n");
  });
});
