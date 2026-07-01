// external-link.ts - Open hyperlinks in the system browser.
//
// Editor-agnostic on purpose: the preview path only needs a rendered <a>
// element, and the source path works on raw Markdown text. Neither imports the
// editor, so Ctrl+click-to-open keeps working if the editor engine changes.
import { invoke } from "@tauri-apps/api/core";

/** True when the click should open a link instead of editing — Ctrl (or Cmd on
 * macOS) held down. */
export function isOpenLinkModifier(event: MouseEvent | KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

/**
 * Hand a URL to the OS to open externally. Mirrors the backend guard
 * (`open_external` only opens http/https), so anything else is ignored here to
 * avoid a pointless round-trip.
 */
export function openExternalLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  void invoke("open_external", { url }).catch((error) => {
    console.error("Failed to open external link:", error);
  });
}

// Matches, in order: a Markdown inline link `[text](url "title")` (capturing
// the parenthesized target), an autolink `<https://…>`, and a bare URL.
const LINK_PATTERN = /\[[^\]]*\]\(([^)]*)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()[\]"'`]+)/gi;

/**
 * Find the http/https URL at character offset `pos` in raw Markdown, or null.
 * Used by the source view, where links are plain text rather than <a> elements:
 * the caret offset of a Ctrl+click is matched against link constructs in the
 * text. Returns null when the click is not on a link.
 */
export function findLinkAtPosition(text: string, pos: number): string | null {
  LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_PATTERN.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (pos < start || pos > end) continue;

    // The first whitespace-delimited token of a Markdown target is the URL;
    // a `<url>` form (angle-bracketed destination) has its brackets stripped.
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const url = (raw.split(/\s+/)[0] ?? "").replace(/^<|>$/g, "");
    return /^https?:\/\//i.test(url) ? url : null;
  }
  return null;
}
