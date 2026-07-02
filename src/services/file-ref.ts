// file-ref.ts - Recognize `@relative/path` file references in plain text.
//
// Editor-agnostic on purpose, mirroring external-link.ts: this pattern is
// shared by the WYSIWYG editor's remark plugin (features/editor/remark-file-ref.ts,
// which turns matches into a clickable node) and the plain-text source view
// (which has no nodes to click, just raw characters at a caret offset).
//
// Recognition rule: "@" followed by one of —
//   1. a path containing at least one "/", e.g. `@docs/backend.md` or
//      `@~/.claude/personal-rules.md` (a leading "~" is resolved to the home
//      directory — see workspace-utils.ts's isHomeRelativePath).
//   2. a bare filename with an extension, e.g. `@AGENTS.md`, `@package.json`,
//      `@config.yaml` — any extension, not an allowlist, per project
//      convention (README/AGENTS.md/package.json/*.yaml/*.toml/*.txt all
//      need to work).
//   3. a bare, conventionally ALL-CAPS project file with no extension, e.g.
//      `@README`, `@LICENSE`, `@CHANGELOG` — the closest regex-only proxy for
//      "a real file, not a person mention" when there's no "/" or "." to go on.
// A negative lookbehind stops the "@" from being picked out of the middle of
// something else, e.g. the userinfo `@` in a bare URL like
// `https://user@host/path`.
export const FILE_REF_PATTERN =
  /(?<![\w/@.:~-])@((?:[\w.~-]+\/)+[\w.~-]*|[\w-]+(?:\.[\w-]+)+|[A-Z][A-Z0-9_-]{1,30})/g;

// Trailing punctuation a human would type to end a sentence, not part of the
// path itself (e.g. "see @docs/notes.md." should not swallow the period).
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/**
 * Split a raw regex capture into the file path and any trailing punctuation
 * that isn't really part of it. Returns null if nothing but punctuation
 * remains (a degenerate match).
 */
export function splitFileRefMatch(rawPath: string): { path: string; trailing: string } | null {
  const trailing = TRAILING_PUNCTUATION.exec(rawPath)?.[0] ?? "";
  const path = trailing ? rawPath.slice(0, -trailing.length) : rawPath;
  if (!path) return null;
  return { path, trailing };
}

/**
 * Find the file-reference path at character offset `pos` in raw Markdown, or
 * null. Used by the source view, where `@path` references are plain text
 * rather than rendered nodes: the caret offset of a Ctrl+click is matched
 * against `@path` occurrences in the text. Mirrors findLinkAtPosition in
 * external-link.ts.
 */
export function findFileRefAtPosition(text: string, pos: number): string | null {
  FILE_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_REF_PATTERN.exec(text)) !== null) {
    const split = splitFileRefMatch(match[1]);
    if (!split) continue;

    const start = match.index;
    const end = start + 1 + split.path.length; // "@" + path, excluding trailing punctuation
    if (pos >= start && pos <= end) return split.path;
  }
  return null;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);

/**
 * True for a bare (no "/") ALL-CAPS reference with no extension, e.g.
 * `README`, `LICENSE`, `CHANGELOG` — the shape produced by FILE_REF_PATTERN's
 * third alternative. There's no extension to confirm it's Markdown, so
 * callers that let it through (see looksLikeMarkdownRef) should verify the
 * file actually exists before navigating, rather than assuming it does.
 */
export function isBareAllCapsRef(path: string): boolean {
  return !path.includes("/") && !path.includes("\\") && /^[A-Z][A-Z0-9_-]*$/.test(path);
}

/**
 * Whether an `@path` reference's target looks like a Markdown file, judged
 * purely by its extension (no filesystem check — mirrors workspace-utils.ts's
 * isMarkdownFile) — with one exception: a bare ALL-CAPS reference like
 * `@README` has no extension to go on at all, so we default-assume it's a
 * Markdown project file (the overwhelmingly common case) rather than
 * refusing to navigate; isBareAllCapsRef() flags this case so callers can
 * still verify the file exists before trusting the assumption.
 *
 * Any other extensionless or non-Markdown-extensioned reference (e.g.
 * `@package.json`, `@docs/README`) is NOT treated as Markdown: opening a
 * non-Markdown file in this Markdown editor risks misrendering it (a line
 * starting with "#" becomes a heading) or mangling it on save.
 *
 * Shared by milkdown-file-ref-node.ts (to style non-Markdown refs
 * differently) and App.tsx (to refuse navigating into them, showing a hint
 * instead) — both keyed off this single source of truth.
 */
export function looksLikeMarkdownRef(path: string): boolean {
  if (isBareAllCapsRef(path)) return true;

  const fileName = path.split(/[/\\]/).pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return false;
  return MARKDOWN_EXTENSIONS.has(fileName.slice(dotIndex + 1).toLowerCase());
}
