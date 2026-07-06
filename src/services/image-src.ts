// image-src.ts - Resolve markdown image sources to URLs the webview can load.
//
// Editor-agnostic on purpose, mirroring file-ref.ts: the WYSIWYG editor's
// image extension (features/editor/milkdown-image-src.ts) calls
// resolveImageSrc from its toDOM, and App.tsx keeps the base directory in
// sync with the active document. A markdown image like `![](./assets/a.png)`
// is a filesystem path relative to the document, which the webview cannot
// fetch directly — it must go through Tauri's asset protocol via
// convertFileSrc. Remote/data URLs pass through untouched.
import { convertFileSrc } from "@tauri-apps/api/core";

// URL scheme prefix (http:, data:, asset:, untitled:, ...). A single letter
// followed by ":\" or ":/" is a Windows drive, not a scheme — checked first.
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/;

// Directory of the active document, or null when there is none (untitled
// buffer, no document open). Module-level because toDOM has no access to app
// state; App.tsx updates it before every content load.
let baseDir: string | null = null;

/**
 * Record the directory that relative image paths resolve against, derived
 * from the active document's path. Synthetic paths (`untitled://...`) have no
 * directory and clear the base.
 */
export function setImageBaseDirFromFile(filePath: string | null): void {
  if (!filePath || (SCHEME_PATTERN.test(filePath) && !WINDOWS_DRIVE_PATTERN.test(filePath))) {
    baseDir = null;
    return;
  }
  const lastSeparator = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  baseDir = lastSeparator > 0 ? filePath.slice(0, lastSeparator) : null;
}

/**
 * Resolve a markdown image `src` to an absolute local filesystem path, or
 * null when it is not a local path (remote/data URL) or cannot be resolved
 * (relative path with no base). Pure — exported for tests; runtime callers
 * use {@link resolveImageSrc}.
 */
export function resolveLocalImagePath(src: string, base: string | null): string | null {
  if (!src) return null;
  if (SCHEME_PATTERN.test(src) && !WINDOWS_DRIVE_PATTERN.test(src)) return null;

  // Markdown image URLs are often percent-encoded (`my%20image.png`), but the
  // filesystem wants the literal name. A stray literal "%" makes decoding
  // throw — keep the raw value then.
  let path = src;
  try {
    path = decodeURIComponent(src);
  } catch {
    // not percent-encoded; use as-is
  }

  if (WINDOWS_DRIVE_PATTERN.test(path) || path.startsWith("/")) {
    return path;
  }

  if (!base) return null;
  return joinAndNormalize(base, path);
}

/**
 * Map an image src to something the webview can load: local paths become
 * asset-protocol URLs (streamed by the webview, backed by the scope the
 * Rust side granted for the open workspace/document), everything else is
 * returned unchanged.
 */
export function resolveImageSrc(src: string): string {
  const localPath = resolveLocalImagePath(src, baseDir);
  return localPath === null ? src : convertFileSrc(localPath);
}

// Join base + relative and collapse "." / ".." segments. Forward slashes as
// output separator — Windows accepts them, and convertFileSrc only needs a
// well-formed absolute path.
function joinAndNormalize(base: string, relative: string): string {
  const segments = base.split(/[\\/]+/);
  // A POSIX base ("/home/u/docs") splits to a leading "" — keep it so the
  // result stays rooted; a Windows base keeps its "C:" head segment.
  const root = segments[0];
  const stack = segments.slice(1).filter((segment) => segment.length > 0);

  for (const segment of relative.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Never pop past the root; a path escaping the filesystem root is
      // malformed and clamping matches what browsers do with URLs.
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return `${root}/${stack.join("/")}`;
}
