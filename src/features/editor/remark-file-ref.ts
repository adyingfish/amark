// remark-file-ref.ts - Turn `@relative/path` text into `fileRef` mdast nodes.
//
// The pattern itself is editor-agnostic (see services/file-ref.ts); this file
// is the Milkdown-specific half that wires it into the remark pipeline so
// milkdown-file-ref-node.ts can render matches as a clickable chip. Runs
// before Milkdown's own remarkHtmlTransformer (registered by the commonmark
// preset), enforced by plugin order in milkdown-adapter.ts.
import { findAndReplace } from "mdast-util-find-and-replace";
import type { PhrasingContent, Root } from "mdast";
import { FILE_REF_PATTERN, splitFileRefMatch } from "../../services/file-ref";

function fileRefNode(path: string): PhrasingContent {
  return { type: "fileRef", value: path } as unknown as PhrasingContent;
}

export function remarkFileRef() {
  return (tree: Root): void => {
    findAndReplace(tree, [
      [
        FILE_REF_PATTERN,
        (_match: string, rawPath: string): PhrasingContent[] | false => {
          const split = splitFileRefMatch(rawPath);
          if (!split) return false;

          return split.trailing
            ? [fileRefNode(split.path), { type: "text", value: split.trailing }]
            : [fileRefNode(split.path)];
        },
      ],
    ]);
  };
}
