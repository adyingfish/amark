// milkdown-comment-block-node.ts - ProseMirror node for standalone HTML
// comment blocks (see remark-comment-block.ts for the mdast-level detection).
//
// Atom block node, read-only in effect (no editable content): the raw
// comment text is shown as-is in a muted callout rather than being invisible
// or rendered as plain text. Rendered as a div with a `data-value` attribute;
// App.tsx never needs to click into it, it's display-only.
import { $nodeSchema } from "@milkdown/kit/utils";

export const COMMENT_BLOCK_DATA_TYPE = "comment-block";

export const commentBlockSchema = $nodeSchema("commentBlock", () => ({
  atom: true,
  group: "block",
  attrs: {
    value: { default: "", validate: "string" },
  },
  toDOM: (node) => [
    "div",
    { "data-type": COMMENT_BLOCK_DATA_TYPE, "data-value": node.attrs.value as string },
    (node.attrs.value as string).trim(),
  ],
  parseDOM: [
    {
      tag: `div[data-type="${COMMENT_BLOCK_DATA_TYPE}"]`,
      getAttrs: (dom: HTMLElement) => ({
        value: dom.dataset.value ?? "",
      }),
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === "commentBlock",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "commentBlock",
    runner: (state, node) => {
      state.addNode("commentBlock", undefined, node.attrs.value as string);
    },
  },
}));
