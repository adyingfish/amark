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
  editorViewCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { getMarkdown } from "@milkdown/kit/utils";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import { buildStringifyOptions } from "./milkdown-stringify-options";
import { remarkFileRef } from "./remark-file-ref";
import { remarkCommentBlock } from "./remark-comment-block";
import { fileRefSchema } from "./milkdown-file-ref-node";
import { commentBlockSchema } from "./milkdown-comment-block-node";
import { mathBlockSchema, mathInlineSchema } from "./milkdown-math-node";
import { mathBlockView, mathInlineView } from "./milkdown-math-view";
import { remarkPreserveMathSource } from "./remark-math-source";
import { remarkStandaloneDisplayMath } from "./remark-standalone-display-math";
import { remarkLatexMath } from "./remark-latex-math";

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
        { plugin: remarkMath, options: { singleDollarTextMath: false } },
        { plugin: remarkLatexMath, options: {} },
        { plugin: remarkPreserveMathSource, options: { singleDollarTextMath: false } },
        { plugin: remarkStandaloneDisplayMath, options: {} },
        { plugin: remarkCommentBlock, options: {} },
        { plugin: remarkFileRef, options: {} },
      ]);
      ctx.set(remarkStringifyOptionsCtx, buildStringifyOptions(ctx.get(remarkStringifyOptionsCtx)));
    })
    .use(commonmark)
    .use(gfm)
    .use(fileRefSchema)
    .use(commentBlockSchema)
    .use(mathInlineSchema)
    .use(mathBlockSchema)
    .use(mathInlineView)
    .use(mathBlockView)
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

async function editFormula(
  markdown: string,
  selector: string,
  value: string,
  saveKey: KeyboardEventInit,
): Promise<string> {
  const { container, editor } = await createEditor(markdown);
  const preview = container.querySelector<HTMLElement>(`${selector} .math-preview`);
  expect(preview).not.toBeNull();
  preview?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `${selector} [data-math-input="true"]`,
  );
  expect(input?.closest<HTMLElement>(".math-editor-panel")?.hidden).toBe(false);
  if (input) {
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...saveKey }));
  }

  const output = editor.action(getMarkdown());
  editor.destroy();
  container.remove();
  return output;
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

  it("round-trips double-dollar inline math unchanged", async () => {
    expect(await roundtrip("Lift($$L$$)")).toBe("Lift($$L$$)\n");
    expect(await renderHtml("Lift($$L$$)")).toContain('data-type="math-inline"');
  });

  it("supports longer inline math fences", async () => {
    const source = "Lift($$$$L$$$$)";

    expect(await roundtrip(source)).toBe(`${source}\n`);
    expect(await renderHtml(source)).toContain('data-type="math-inline"');
  });

  it("renders and preserves MathJax-style inline math", async () => {
    const source = "energy: \\(E=mc^2\\)";
    const html = await renderHtml(source);

    expect(html).toContain('data-type="math-inline"');
    expect(html).toContain("katex");
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("keeps Markdown-looking content inside MathJax inline math", async () => {
    const source = "result: \\(a *b* + [c](d)\\)";
    const html = await renderHtml(source);

    expect(html).toContain('data-type="math-inline"');
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<a ");
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("keeps escaped MathJax-style delimiters as literal text", async () => {
    const source = "literal: \\\\(not math\\\\)";
    const html = await renderHtml(source);

    expect(html).not.toContain('data-type="math-inline"');
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("renders and preserves a same-line MathJax display formula", async () => {
    const source = "\\[E=mc^2\\]";
    const html = await renderHtml(source);

    expect(html).toContain('data-type="math-block"');
    expect(html).toContain('class="katex-display"');
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("renders and preserves a multiline MathJax display formula", async () => {
    const source = "\\[\n\\frac{a_b}{c^2}\n\\]";
    const html = await renderHtml(source);

    expect(html).toContain('data-type="math-block"');
    expect(html).toContain('class="katex-display"');
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("splits a MathJax display formula out of surrounding paragraph text", async () => {
    const source = "before \\[E=mc^2\\] after";
    const html = await renderHtml(source);

    expect(html).toContain("<p>before</p>");
    expect(html).toContain('data-type="math-block"');
    expect(html).toContain("<p>after</p>");
    expect(await roundtrip(source)).toBe("before\n\n\\[E=mc^2\\]\n\nafter\n");
  });

  it("promotes a standalone same-line double-dollar formula to a math block", async () => {
    const source = "$$Attention(Q, K, V) = softmax(QK^T)V$$";
    const html = await renderHtml(source);

    expect(await roundtrip(source)).toBe(`${source}\n`);
    expect(html).toContain('data-type="math-block"');
    expect(html).not.toContain("<p");
    expect(html).toContain('class="katex-display"');
  });

  it("displays a source-line double-dollar formula after paragraph text", async () => {
    const source = "最终求加权和，即\n$$Attention(Q, K, V) = softmax(QK^T)V$$";
    const html = await renderHtml(source);

    expect(await roundtrip(source)).toBe(`${source}\n`);
    expect(html).toContain('data-display="true"');
    expect(html).toContain('class="katex-display"');
  });

  it("renders inline math as KaTeX output in the DOM", async () => {
    const html = await renderHtml("energy: $$E=mc^2$$");

    expect(html).toContain('data-type="math-inline"');
    expect(html).toContain("katex");
    expect(html).not.toContain("$$E=mc^2$$");
  });

  it("keeps a lone currency amount as text without rewriting it", async () => {
    const source = "The license costs $100.";
    const html = await renderHtml(source);

    expect(html).not.toContain('data-type="math-inline"');
    expect(html).toContain("$100");
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("normalizes now-unnecessary currency escapes without treating them as math", async () => {
    const source = "Budget: \\$100 for design and \\$200 for review.";
    const html = await renderHtml(source);

    expect(html).not.toContain('data-type="math-inline"');
    expect(html).toContain("$100");
    expect(html).toContain("$200");
    expect(await roundtrip(source)).toBe("Budget: $100 for design and $200 for review.\n");
  });

  it("keeps unescaped paired dollar amounts as text without rewriting them", async () => {
    const source = "Budget: $100 for design and $200 for review.";
    const html = await renderHtml(source);

    expect(html).not.toContain('data-type="math-inline"');
    expect(html).toContain("$100 for design and $200");
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("keeps single-dollar formula-like text literal", async () => {
    const source = "The exact result is $E=mc^2$.";
    const html = await renderHtml(source);

    expect(html).not.toContain('data-type="math-inline"');
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("keeps shell-style dollar variables literal", async () => {
    const source = "Copy $HOME into $BACKUP before continuing.";
    const html = await renderHtml(source);

    expect(html).not.toContain('data-type="math-inline"');
    expect(await roundtrip(source)).toBe(`${source}\n`);
  });

  it("edits inline math directly in the WYSIWYG view", async () => {
    expect(
      await editFormula("energy: $$E=mc^2$$", '[data-type="math-inline"]', "F=ma", {
        key: "Enter",
      }),
    ).toBe("energy: $$F=ma$$\n");
  });

  it("preserves MathJax delimiters when editing inline math", async () => {
    expect(
      await editFormula("energy: \\(E=mc^2\\)", '[data-type="math-inline"]', "F=ma", {
        key: "Enter",
      }),
    ).toBe("energy: \\(F=ma\\)\n");
  });

  it("round-trips a math block unchanged", async () => {
    const src = "$$\na^2 + b^2 = c^2\n$$";
    expect(await roundtrip(src)).toBe(`${src}\n`);
  });

  it("preserves a longer math block fence", async () => {
    const src = "$$$$\na^2 + b^2 = c^2\n$$$$";
    expect(await roundtrip(src)).toBe(src + "\n");
  });

  it("preserves math block metadata", async () => {
    const src = "$$asciimath\na^2 + b^2 = c^2\n$$";
    expect(await roundtrip(src)).toBe(src + "\n");
  });

  it("preserves math fences inside a block quote without duplicating quote markers", async () => {
    const src = "> $$$$\n> a^2 + b^2 = c^2\n> $$$$";
    expect(await roundtrip(src)).toBe(src + "\n");
  });

  it("renders a math block as KaTeX output in the DOM", async () => {
    const html = await renderHtml("$$\na^2 + b^2 = c^2\n$$");

    expect(html).toContain('data-type="math-block"');
    expect(html).toContain("katex");
  });

  it("edits block math directly while preserving metadata", async () => {
    const source = "$$asciimath\na^2 + b^2 = c^2\n$$";
    expect(
      await editFormula(source, '[data-type="math-block"]', "x = y + z", {
        key: "Enter",
        ctrlKey: true,
      }),
    ).toBe("$$asciimath\nx = y + z\n$$\n");
  });

  it("preserves MathJax delimiters when editing display math", async () => {
    expect(
      await editFormula("\\[\na^2 + b^2 = c^2\n\\]", '[data-type="math-block"]', "x = y", {
        key: "Enter",
        ctrlKey: true,
      }),
    ).toBe("\\[\nx = y\n\\]\n");
  });

  it("does not open the formula editor in a read-only rich view", async () => {
    const { container, editor } = await createEditor("energy: $$E=mc^2$$");
    editor.action((ctx) => ctx.get(editorViewCtx).setProps({ editable: () => false }));

    const preview = container.querySelector<HTMLElement>('[data-type="math-inline"] .math-preview');
    preview?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(
      container.querySelector<HTMLElement>('[data-type="math-inline"] .math-editor-panel')?.hidden,
    ).toBe(true);
    editor.destroy();
    container.remove();
  });
});
