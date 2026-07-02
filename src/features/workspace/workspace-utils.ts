// workspace-utils.ts - Workspace utility functions
import type { WorkspaceFileNode } from "./workspace-types";

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Check if a file is a Markdown file
 */
export function isMarkdownFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === "md" || ext === "markdown" || ext === "mdown" || ext === "mkd";
}

/**
 * Get relative path from root
 */
export function getRelativePath(rootPath: string, filePath: string): string {
  if (filePath.startsWith(rootPath)) {
    return filePath.slice(rootPath.length).replace(/^[/\\]/, "");
  }
  return filePath;
}

/**
 * Whether `filePath` is `rootPath` itself or lives somewhere underneath it.
 * Guards against a false-positive prefix match (e.g. "/root2" vs "/root") by
 * requiring the next character after the prefix to be a path separator.
 */
export function isPathWithinRoot(rootPath: string, filePath: string): boolean {
  const root = rootPath.replace(/[/\\]+$/, "");
  if (filePath === root) return true;
  if (!filePath.startsWith(root)) return false;
  const next = filePath[root.length];
  return next === "/" || next === "\\";
}

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/;

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || WINDOWS_DRIVE_PATTERN.test(path);
}

const HOME_RELATIVE_PATTERN = /^~(?:[/\\]|$)/;

/**
 * True for a `~`-rooted path, e.g. `~/.claude/personal-rules.md` (or bare
 * `~`). These can't be resolved synchronously (the home directory has to be
 * fetched from the OS), so callers must check this before calling
 * resolveLocalFileReference and resolve via resolveHomeRelativePath instead.
 */
export function isHomeRelativePath(path: string): boolean {
  return HOME_RELATIVE_PATTERN.test(path);
}

/** Expand a `~`-rooted path against an already-resolved home directory. */
export function resolveHomeRelativePath(homeDir: string, path: string): string {
  const home = homeDir.replace(/[/\\]+$/, "");
  const rest = path.replace(HOME_RELATIVE_PATTERN, "");
  if (!rest) return home;

  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  return `${home}${sep}${rest}`;
}

/**
 * Resolve `relative` (a `..`/`.`-style relative path, using either separator)
 * against the directory containing `basePath`.
 */
function resolveRelativeToDirectory(basePath: string, relative: string): string {
  const sep = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  const segments = basePath.split(/[/\\]/);
  segments.pop(); // drop basePath's own file name, keeping its directory chain

  for (const part of relative.split(/[/\\]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length > 1) segments.pop();
      continue;
    }
    segments.push(part);
  }

  return segments.join(sep);
}

/**
 * Resolve a local link/reference target — as authored in the document at
 * `basePath` — into an absolute path, or null when it isn't a local file
 * reference at all (an http(s) URL, `mailto:`, an in-page anchor, etc).
 */
function resolveLocalPathTarget(basePath: string, href: string): string | null {
  const target = href.split(/[?#]/)[0];
  if (!target) return null;
  if (URL_SCHEME_PATTERN.test(target) && !WINDOWS_DRIVE_PATTERN.test(target)) return null;
  // `~`-rooted paths need an async OS lookup for the home directory — the
  // caller must special-case isHomeRelativePath() before reaching here.
  if (isHomeRelativePath(target)) return null;

  return isAbsoluteLocalPath(target) ? target : resolveRelativeToDirectory(basePath, target);
}

/**
 * Resolve a Markdown link's `href` — as authored in the document at
 * `basePath` — into an absolute path, or null when it isn't a local Markdown
 * file link (an http(s) URL, `mailto:`, an in-page anchor, a non-Markdown
 * file, etc).
 */
export function resolveLocalMarkdownLink(basePath: string, href: string): string | null {
  const target = href.split(/[?#]/)[0] ?? "";
  const fileName = target.split(/[/\\]/).pop() ?? "";
  if (!isMarkdownFile(fileName)) return null;

  return resolveLocalPathTarget(basePath, href);
}

/**
 * Resolve an `@relative/path` file reference (see services/file-ref.ts) —
 * as authored in the document at `basePath` — into an absolute path. Unlike
 * resolveLocalMarkdownLink, any file type is navigable, not just Markdown.
 * Returns null for a `~`-rooted reference — check isHomeRelativePath() first
 * and resolve those via resolveHomeRelativePath() instead.
 */
export function resolveLocalFileReference(basePath: string, rawPath: string): string | null {
  return resolveLocalPathTarget(basePath, rawPath);
}

/**
 * Flatten file tree to array of files
 */
export function flattenFileTree(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  const result: WorkspaceFileNode[] = [];

  for (const node of nodes) {
    if (node.kind === "file") {
      result.push(node);
    } else if (node.children) {
      result.push(...flattenFileTree(node.children));
    }
  }

  return result;
}

/**
 * Find a file node by path
 */
export function findFileNode(
  nodes: WorkspaceFileNode[],
  targetPath: string,
): WorkspaceFileNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }
    if (node.children) {
      const found = findFileNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * If `path` lives under `oldDirPath` (a strict descendant, not the directory
 * itself), return the equivalent path rewritten under `newDirPath`; otherwise
 * null. Used to keep open tabs/documents/expanded folders in sync after a
 * directory rename.
 */
export function rewriteDescendantPath(
  path: string,
  oldDirPath: string,
  newDirPath: string,
): string | null {
  if (!path.startsWith(oldDirPath)) return null;
  const rest = path.slice(oldDirPath.length);
  if (rest[0] !== "/" && rest[0] !== "\\") return null;
  return newDirPath + rest;
}

/**
 * Whether `path` is a strict descendant of `ancestorPath` (not the directory
 * itself). Used to purge a collapsed folder's descendants from the expanded
 * set so re-expanding it doesn't resurrect stale child expansion state.
 */
export function isDescendantPath(path: string, ancestorPath: string): boolean {
  if (!path.startsWith(ancestorPath)) return false;
  const rest = path.slice(ancestorPath.length);
  return rest[0] === "/" || rest[0] === "\\";
}

/**
 * Get the directory name from a path
 */
export function getDirectoryName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 2] || "";
}

/**
 * Format file size (placeholder for future use)
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate a filename if it's too long
 */
export function truncateFilename(filename: string, maxLength: number = 30): string {
  if (filename.length <= maxLength) return filename;
  const ext = getFileExtension(filename);
  const name = filename.slice(0, -(ext.length + 1));
  const truncatedName = name.slice(0, maxLength - ext.length - 4) + "...";
  return `${truncatedName}.${ext}`;
}
