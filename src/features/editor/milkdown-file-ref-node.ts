// milkdown-file-ref-node.ts - ProseMirror node for `@relative/path` refs.
//
// Modeled as an atom chip (like Milkdown's own built-in `html` node — see
// @milkdown/preset-commonmark's node/html.ts, the pattern this mirrors) so it
// round-trips a raw value without fighting mdast-util-to-markdown's text
// escaping. Rendered as a plain span with a `data-path` attribute so
// App.tsx's click handler (editor-agnostic) can navigate without depending
// on Milkdown — see CLAUDE.md's editor-isolation rule.
import { $nodeSchema } from "@milkdown/kit/utils";
import { looksLikeMarkdownRef } from "../../services/file-ref";

export const FILE_REF_DATA_TYPE = "file-ref";

export const fileRefSchema = $nodeSchema("fileRef", () => ({
  atom: true,
  group: "inline",
  inline: true,
  attrs: {
    path: { default: "", validate: "string" },
  },
  toDOM: (node) => {
    const path = node.attrs.path as string;
    return [
      "span",
      {
        "data-type": FILE_REF_DATA_TYPE,
        "data-path": path,
        // Non-Markdown refs (e.g. `@package.json`) are styled differently
        // (base.css) — App.tsx also refuses to navigate into them, showing a
        // hint instead. See services/file-ref.ts's looksLikeMarkdownRef.
        "data-md": String(looksLikeMarkdownRef(path)),
      },
      `@${path}`,
    ];
  },
  parseDOM: [
    {
      tag: `span[data-type="${FILE_REF_DATA_TYPE}"]`,
      getAttrs: (dom: HTMLElement) => ({
        path: dom.dataset.path ?? "",
      }),
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === "fileRef",
    runner: (state, node, type) => {
      state.addNode(type, { path: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "fileRef",
    runner: (state, node) => {
      state.addNode("fileRef", undefined, node.attrs.path as string);
    },
  },
}));
