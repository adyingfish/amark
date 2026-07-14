// milkdown-math-node.ts - ProseMirror nodes for LaTeX math, backed by KaTeX.
//
// Two atom nodes, same shape as fileRefSchema/commentBlockSchema: the raw
// LaTeX source lives in the node (text content for inline, `value` attr for
// block) and toDOM renders it through KaTeX. milkdown-math-view.ts adds the
// WYSIWYG editing surface without changing this serialization contract.
import { $nodeSchema } from "@milkdown/kit/utils";
import { expectDomTypeError } from "@milkdown/kit/exception";
import { Fragment } from "@milkdown/kit/prose/model";
import "katex/dist/katex.min.css";
import katex from "katex";
import {
  mathSourceData,
  readPreservedMathSource,
  type PreservedMathSource,
} from "./remark-math-source";
import { isStandaloneDisplayMath } from "./remark-standalone-display-math";

const KATEX_OPTIONS = { throwOnError: false } as const;

export const MATH_INLINE_DATA_TYPE = "math-inline";
export const MATH_BLOCK_DATA_TYPE = "math-block";

export const mathInlineSchema = $nodeSchema("mathInline", () => ({
  group: "inline",
  content: "text*",
  inline: true,
  atom: true,
  attrs: {
    raw: { default: "", validate: "string" },
    sourceValue: { default: "", validate: "string" },
    display: { default: false, validate: "boolean" },
  },
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
    if (node.attrs.display) dom.dataset.display = "true";
    katex.render(code, dom, { ...KATEX_OPTIONS, displayMode: Boolean(node.attrs.display) });
    return dom;
  },
  parseMarkdown: {
    match: ({ type }) => type === "inlineMath",
    runner: (state, node, type) => {
      const source = readPreservedMathSource(node);
      state
        .openNode(type, {
          raw: source?.raw ?? "",
          sourceValue: source?.value ?? (node.value as string),
          display: isStandaloneDisplayMath(node),
        })
        .addText(node.value as string)
        .closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "mathInline",
    runner: (state, node) => {
      const source: PreservedMathSource = {
        raw: node.attrs.raw as string,
        value: node.attrs.sourceValue as string,
        meta: null,
      };
      state.addNode("inlineMath", undefined, node.textContent, {
        data: mathSourceData(source),
      });
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
    meta: { default: null },
    raw: { default: "", validate: "string" },
    sourceValue: { default: "", validate: "string" },
  },
  parseDOM: [
    {
      tag: `div[data-type="${MATH_BLOCK_DATA_TYPE}"]`,
      preserveWhitespace: "full",
      getAttrs: (dom: HTMLElement) => ({
        value: dom.dataset.value ?? "",
        meta: dom.dataset.meta || null,
      }),
    },
  ],
  toDOM: (node) => {
    const code = node.attrs.value as string;
    const dom = document.createElement("div");
    dom.dataset.type = MATH_BLOCK_DATA_TYPE;
    dom.dataset.value = code;
    if (node.attrs.meta) dom.dataset.meta = node.attrs.meta as string;
    katex.render(code, dom, { ...KATEX_OPTIONS, displayMode: true });
    return dom;
  },
  parseMarkdown: {
    match: ({ type }) => type === "math",
    runner: (state, node, type) => {
      const source = readPreservedMathSource(node);
      state.addNode(type, {
        value: node.value as string,
        meta: typeof node.meta === "string" ? node.meta : null,
        raw: source?.raw ?? "",
        sourceValue: source?.value ?? (node.value as string),
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "mathBlock",
    runner: (state, node) => {
      const source: PreservedMathSource = {
        raw: node.attrs.raw as string,
        value: node.attrs.sourceValue as string,
        meta: (node.attrs.meta as string | null) ?? null,
      };
      state.addNode("math", undefined, node.attrs.value as string, {
        meta: source.meta,
        data: mathSourceData(source),
      });
    },
  },
}));
