// remark-comment-block.ts - Retag standalone HTML-comment blocks.
//
// remark-parse gives a `<!-- ... -->` that sits on its own line(s), separated
// by blank lines from surrounding content, an `html` mdast node whose parent
// is a block container (root/blockquote/listItem) — the same shape as any
// other block-level raw HTML. Milkdown's built-in `html` node is inline-only
// (see @milkdown/preset-commonmark's node/html.ts), so its own
// remarkHtmlTransformer would otherwise wrap it in a paragraph and render it
// as plain visible text. We retag block-level comments as our own
// `commentBlock` type first so that transformer skips them, letting
// milkdown-comment-block-node.ts render them as a distinct block instead.
//
// Inline comments (embedded within a paragraph's text) are left untouched
// and keep Milkdown's default html-node rendering.
import type { Html, Parent, Root, RootContent } from "mdast";

// One complete `<!-- ... -->` comment. Non-greedy so a value containing
// several comments back to back doesn't collapse into a single "match
// everything between the first <!-- and the last -->" capture.
const COMMENT_TOKEN_PATTERN = /<!--[\s\S]*?-->/g;
// Same container list Milkdown's own remarkHtmlTransformer uses to decide
// whether an `html` mdast node sits directly in block position.
const BLOCK_CONTAINER_TYPES = new Set(["root", "blockquote", "listItem"]);

/**
 * Split a block-level `html` node's raw value into the individual comments
 * it's made of, or null if it isn't comments-and-whitespace only.
 *
 * A lone `<!-- ... -->` normally becomes its own `html` node, but
 * CommonMark's HTML-block tokenizer ends a block as soon as it sees a line
 * containing `-->` — so several comments packed onto one line, with no blank
 * line between them (e.g. `<!-- a --><!-- b -->`), land in the SAME `html`
 * node. Blindly treating that whole value as one comment would silently
 * swallow the `--><!--` in the middle and render it as if it were comment
 * text. We only split when the value is comments (and surrounding
 * whitespace) with nothing else mixed in; anything else — real HTML text
 * between/around the comments, an unterminated comment — is left alone so
 * Milkdown's default html-node rendering applies instead of us guessing.
 */
function splitCommentBlockValue(raw: string): string[] | null {
  const matches = [...raw.matchAll(COMMENT_TOKEN_PATTERN)];
  if (matches.length === 0) return null;

  let cursor = 0;
  for (const match of matches) {
    if (raw.slice(cursor, match.index).trim() !== "") return null;
    cursor = (match.index ?? 0) + match[0].length;
  }
  if (raw.slice(cursor).trim() !== "") return null;

  // Strip the "<!--" / "-->" delimiters, keeping each comment's interior
  // text (including padding spaces) exactly so it round-trips byte-for-byte.
  return matches.map((match) => match[0].slice(4, -3));
}

function isHtml(node: RootContent): node is Html {
  return node.type === "html";
}

function walk(node: Root | Parent): void {
  const nextChildren: RootContent[] = [];

  for (const child of node.children) {
    const comments =
      isHtml(child) && BLOCK_CONTAINER_TYPES.has(node.type)
        ? splitCommentBlockValue(child.value)
        : null;

    if (comments) {
      for (const value of comments) {
        nextChildren.push({ type: "commentBlock", value } as unknown as RootContent);
      }
      continue;
    }

    if ("children" in child) walk(child as Parent);
    nextChildren.push(child);
  }

  node.children = nextChildren;
}

export function remarkCommentBlock() {
  return (tree: Root): void => {
    walk(tree);
  };
}
