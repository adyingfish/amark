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
import { remarkFileRef } from "./remark-file-ref";
import { remarkCommentBlock } from "./remark-comment-block";
import { fileRefSchema } from "./milkdown-file-ref-node";
import { commentBlockSchema } from "./milkdown-comment-block-node";

async function createEditor(
  markdown: string,
): Promise<{ container: HTMLDivElement; editor: Editor }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(remarkPluginsCtx, [
        { plugin: remarkBreaks, options: {} },
        { plugin: remarkCommentBlock, options: {} },
        { plugin: remarkFileRef, options: {} },
      ]);
      ctx.set(remarkStringifyOptionsCtx, buildStringifyOptions(ctx.get(remarkStringifyOptionsCtx)));
    })
    .use(commonmark)
    .use(gfm)
    .use(fileRefSchema)
    .use(commentBlockSchema)
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

  it("round-trips an @path/to/file reference unchanged", async () => {
    const src = "see @src/features/editor/milkdown-adapter.ts for the setup";
    expect(await roundtrip(src)).toBe(`${src}\n`);
  });

  it("renders an @path/to/file reference as a clickable chip in the DOM", async () => {
    const html = await renderHtml("see @docs/notes.md for details");

    expect(html).toContain('data-type="file-ref"');
    expect(html).toContain('data-path="docs/notes.md"');
  });

  it("marks a Markdown reference and a bare ALL-CAPS one as data-md=true", async () => {
    const html = await renderHtml("see @docs/notes.md and @README");

    expect(html).toContain('data-path="docs/notes.md" data-md="true"');
    expect(html).toContain('data-path="README" data-md="true"');
  });

  it("marks a non-Markdown reference as data-md=false", async () => {
    const html = await renderHtml("see @package.json");

    expect(html).toContain('data-path="package.json" data-md="false"');
  });

  it("round-trips bare project-file references (@README, @AGENTS.md, @package.json)", async () => {
    const src = "see @README, @AGENTS.md and @package.json";
    expect(await roundtrip(src)).toBe(`${src}\n`);
  });

  it("round-trips a ~-rooted reference unchanged", async () => {
    const src = "see @~/.claude/personal-rules.md";
    expect(await roundtrip(src)).toBe(`${src}\n`);
  });

  it("round-trips a block-level HTML comment unchanged", async () => {
    const src = "before\n\n<!-- maintainer notes -->\n\nafter";
    expect(await roundtrip(src)).toBe(`${src}\n`);
  });

  it("renders a block-level HTML comment as a comment-block, not inline text", async () => {
    const html = await renderHtml("before\n\n<!-- maintainer notes -->\n\nafter");

    expect(html).toContain('data-type="comment-block"');
    expect(html).toContain("maintainer notes");
  });

  it("splits two comments packed on one line into separate comment-blocks", async () => {
    // CommonMark's HTML-block tokenizer ends a block at the first line
    // containing "-->", so back-to-back comments with no blank line between
    // them land in ONE mdast html node — must not be rendered as if it were
    // a single comment spanning "a --><!-- b".
    const html = await renderHtml("before\n\n<!-- a --><!-- b -->\n\nafter");

    const matches = [...html.matchAll(/data-type="comment-block"/g)];
    expect(matches).toHaveLength(2);
    expect(html).toContain('data-value=" a "');
    expect(html).toContain('data-value=" b "');
  });

  it("leaves a comment merged with real HTML text as plain html, not comment-block", async () => {
    // "<!-- a -->text<!-- b -->" is a single html node that ISN'T comments
    // and whitespace only — must not be guessed at, so it falls back to
    // Milkdown's default (visible) html-node rendering.
    const html = await renderHtml("before\n\n<!-- a -->text<!-- b -->\n\nafter");

    expect(html).not.toContain('data-type="comment-block"');
    expect(html).toContain('data-type="html"');
  });

  it("round-trips a comment merged with real HTML text unchanged", async () => {
    const src = "before\n\n<!-- a -->text<!-- b -->\n\nafter";
    expect(await roundtrip(src)).toBe(`${src}\n`);
  });

  it("leaves an inline (non-block) HTML comment as plain html text", async () => {
    const html = await renderHtml("before <!-- inline --> after");

    expect(html).not.toContain('data-type="comment-block"');
    expect(html).toContain('data-type="html"');
  });
});
