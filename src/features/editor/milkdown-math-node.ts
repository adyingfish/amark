// milkdown-math-node.ts - ProseMirror nodes for LaTeX math, backed by KaTeX.
//
// Two atom nodes, same shape as fileRefSchema/commentBlockSchema: the raw
// LaTeX source lives in the node (text content for inline, `value` attr for
// block) and toDOM renders it through KaTeX. Being atoms, they aren't
// click-to-edit in WYSIWYG — switch to source view to change the formula,
// same tradeoff already made for comment blocks and file refs.
import { $nodeSchema } from "@milkdown/kit/utils";
import { expectDomTypeError } from "@milkdown/kit/exception";
import { Fragment } from "@milkdown/kit/prose/model";
import "katex/dist/katex.min.css";
import katex from "katex";

const KATEX_OPTIONS = { throwOnError: false } as const;

export const MATH_INLINE_DATA_TYPE = "math-inline";
export const MATH_BLOCK_DATA_TYPE = "math-block";

export const mathInlineSchema = $nodeSchema("mathInline", () => ({
  group: "inline",
  content: "text*",
  inline: true,
  atom: true,
  parseDOM: [
    {
      tag: `span[data-type="${MATH_INLINE_DATA_TYPE}"]`,
      getContent: (dom, schema) => {
        if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
        return Fragment.from(schema.text(dom.dataset.value ?? ""));
      },
    },
  ],
  toDOM: (node) => {
    const code = node.textContent;
    const dom = document.createElement("span");
    dom.dataset.type = MATH_INLINE_DATA_TYPE;
    dom.dataset.value = code;
    katex.render(code, dom, KATEX_OPTIONS);
    return dom;
  },
  parseMarkdown: {
    match: ({ type }) => type === "inlineMath",
    runner: (state, node, type) => {
      state
        .openNode(type)
        .addText(node.value as string)
        .closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "mathInline",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, node.textContent);
    },
  },
}));

export const mathBlockSchema = $nodeSchema("mathBlock", () => ({
  content: "text*",
  group: "block",
  marks: "",
  defining: true,
  atom: true,
  isolating: true,
  attrs: {
    value: { default: "", validate: "string" },
  },
  parseDOM: [
    {
      tag: `div[data-type="${MATH_BLOCK_DATA_TYPE}"]`,
      preserveWhitespace: "full",
      getAttrs: (dom: HTMLElement) => ({ value: dom.dataset.value ?? "" }),
    },
  ],
  toDOM: (node) => {
    const code = node.attrs.value as string;
    const dom = document.createElement("div");
    dom.dataset.type = MATH_BLOCK_DATA_TYPE;
    dom.dataset.value = code;
    katex.render(code, dom, { ...KATEX_OPTIONS, displayMode: true });
    return dom;
  },
  parseMarkdown: {
    match: ({ type }) => type === "math",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "mathBlock",
    runner: (state, node) => {
      state.addNode("math", undefined, node.attrs.value as string);
    },
  },
}));
