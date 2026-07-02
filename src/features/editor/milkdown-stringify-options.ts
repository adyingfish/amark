// milkdown-stringify-options.ts
//
// When Milkdown serializes its ProseMirror document back to Markdown it runs
// remark-stringify (mdast-util-to-markdown). The defaults — plus a couple of
// Milkdown-specific quirks — silently rewrite a file the moment it is opened
// and round-tripped. We tune the serializer so the round-trip stays faithful:
//
//   1. Bullet lists are re-emitted with "*" instead of the source "-".
//      → `bullet: "-"`.
//   2. Thematic breaks ("---") are re-emitted as "***".
//      → `rule: "-"`.
//   3. A plain URL (a link whose visible text equals its href) is wrapped in
//      angle brackets: `https://x` becomes `<https://x>`.
//      → custom `link` handler.
//   4. Line breaks are emitted as a trailing "\". Because the editor runs
//      remark-breaks, every soft wrap becomes a hard break, so this sprinkles
//      "\" across ordinary multi-line paragraphs. We emit a plain newline
//      instead (still a line break under remark-breaks, but byte-identical to a
//      soft-wrapped source). → custom `break` handler.
//
//      DELIBERATE TRADE-OFF (confirmed with the product owner): with
//      remark-breaks enabled a soft wrap ("a\nb") and a real two-trailing-space
//      hard break ("a  \nb") collapse into the *same* hardbreak node, so the
//      serializer cannot tell them apart. We chose to keep remark-breaks (a
//      single newline renders as a visible <br>, which is the desired editing
//      feel) at the cost of not round-tripping the two trailing spaces — they
//      become a plain newline, which renders identically in this editor. Do
//      NOT "fix" this by emitting "  \n": that would append two trailing spaces
//      to every soft-wrapped line instead. Preserving the distinction would
//      require dropping remark-breaks (then a single newline renders as a
//      space, standard CommonMark) — a product decision, not a bug.
//   5. Tight lists turn loose (a blank line appears between items) because
//      Milkdown's list schema stores the mdast `spread` flag as the *string*
//      "false", and mdast-util-to-markdown treats any truthy value as loose.
//      → custom `list` handler that coerces `spread` back to a boolean.
//
// IMPORTANT: do NOT override the `listItem` handler to fix #5. The GFM preset
// installs its own `listItem` handler to render task-list checkboxes ("[ ]"),
// and a plain delegate to defaultHandlers.listItem both drops those checkboxes
// and breaks ordered numbering (cloning the item makes the list's
// `children.indexOf(item)` lookup return -1, so every marker renders as "0.").
// Normalising `spread` on the list node and its item children is enough.
//
// Everything here is remark/mdast (editor-engine) specific and must stay inside
// the editor module — domain/workspace code must not depend on it.

import { defaultHandlers, type Handle, type Options } from "mdast-util-to-markdown";

// --- #3: bare plain URLs instead of <...> --------------------------------

// Trailing characters that GFM's literal-autolink rule may trim when it
// re-parses a bare URL. If a URL ends in one of these we keep the safe `<...>`
// form instead of emitting it bare, so the link always round-trips unchanged.
const TRAILING_UNSAFE = /[?!.,:;*_~'")\]}>]$/;

// A "plain autolink" is a link whose visible text is exactly its href and that
// has no title — i.e. what Milkdown produces for a URL the user just typed.
// Restricted to http(s) URLs without whitespace/brackets so the bare form is
// guaranteed to re-parse to the same link under the GFM preset.
function isPlainAutolink(node: {
  url?: string;
  title?: string | null;
  children?: Array<{ type: string; value?: string }>;
}): boolean {
  if (node.title) return false;
  if (!node.children || node.children.length !== 1) return false;
  const child = node.children[0];
  if (child.type !== "text" || child.value !== node.url) return false;
  if (!node.url || !/^https?:\/\/[^\s<>|]+$/.test(node.url)) return false;
  if (TRAILING_UNSAFE.test(node.url)) return false;
  return true;
}

const link: Handle = (node, parent, state, info) => {
  if (isPlainAutolink(node as Parameters<typeof isPlainAutolink>[0])) {
    return (node as { url: string }).url;
  }
  return defaultHandlers.link(node, parent, state, info);
};

// --- #4: plain newline for line breaks instead of "\" --------------------

// Reuse the stock handler so its escaping for contexts where a newline is
// unsafe (setext headings, table cells → it returns a space) is preserved; we
// only swap the ordinary "\\\n" result for a bare newline.
const lineBreak: Handle = (node, parent, state, info) => {
  const fallback = defaultHandlers.break(node, parent, state, info);
  return fallback === "\\\n" ? "\n" : fallback;
};

// --- #5: keep tight lists tight ------------------------------------------

const normalizeSpread = (node: { spread?: unknown }): boolean =>
  node.spread === true || node.spread === "true";

const list: Handle = (node, parent, state, info) => {
  const listNode = node as {
    spread?: unknown;
    children?: Array<{ type: string; spread?: unknown }>;
  };
  const normalized = {
    ...(node as object),
    spread: normalizeSpread(listNode),
    children: listNode.children?.map((child) =>
      child.type === "listItem" ? { ...child, spread: normalizeSpread(child) } : child,
    ),
  } as typeof node;
  return defaultHandlers.list(normalized, parent, state, info);
};

// --- #6: custom node types (`@path/to/file` refs, block HTML comments) ---
//
// Neither `fileRef` nor `commentBlock` is a native mdast type, so
// mdast-util-to-markdown has no default handler for them and would otherwise
// throw "Cannot handle unknown node". Both store their exact source text
// verbatim in `node.value` (see milkdown-file-ref-node.ts /
// milkdown-comment-block-node.ts), so the handlers just replay it — no
// escaping, to guarantee a byte-identical round trip.
const fileRef: Handle = (node) => `@${(node as { value?: string }).value ?? ""}`;
const commentBlock: Handle = (node) => `<!--${(node as { value?: string }).value ?? ""}-->`;

// Merge our overrides onto whatever Milkdown already injected (it ships custom
// text/strong/emphasis handlers that preserve the user's emphasis markers, and
// the GFM preset adds table/task-list handlers — we must not drop those),
// rather than replacing the options wholesale.
export function buildStringifyOptions(base: Options): Options {
  return {
    ...base,
    bullet: "-",
    rule: "-",
    handlers: {
      ...base.handlers,
      link,
      list,
      break: lineBreak,
      // `fileRef`/`commentBlock` are Milkdown-only node types (see
      // milkdown-file-ref-node.ts / milkdown-comment-block-node.ts), not part
      // of mdast-util-to-markdown's known `Handlers` union — cast is required.
      ...({ fileRef, commentBlock } as Options["handlers"]),
    },
  };
}
