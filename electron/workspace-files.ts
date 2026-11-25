import type { WorkspaceFileNode } from "../shared/desktop";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const generated = new Set(["node_modules", "target", "dist", "build"]);
const markdownExtensions = new Set([".md", ".markdown", ".mdown", ".mkd"]);

function isMarkdown(file: string) {
  return markdownExtensions.has(path.extname(file).toLowerCase());
}

function skipEntry(name: string, showHidden: boolean) {
  return generated.has(name) || (!showHidden && name.startsWith("."));
}

function sortByName(a: { name: string }, b: { name: string }) {
  const first = a.name.toLowerCase();
  const second = b.name.toLowerCase();
  return first < second ? -1 : first > second ? 1 : 0;
}

function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
}

// Match Rust's read_to_string: preserve a leading BOM and reject invalid UTF-8
// instead of silently saving replacement characters over the original bytes.
async function readText(file: string) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await fs.readFile(file));
}

async function scanDirectory(directory: string, showHidden: boolean): Promise<WorkspaceFileNode[]> {
  const children: WorkspaceFileNode[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (skipEntry(entry.name, showHidden)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      try {
        children.push({
          path: file,
          name: entry.name,
          kind: "directory",
          children: await scanDirectory(file, showHidden),
        });
      } catch {
        // An inaccessible or concurrently removed subdirectory doesn't hide its siblings.
      }
    } else if (entry.isFile() && isMarkdown(file)) {
      children.push({ path: file, name: entry.name, kind: "file" });
    }
  }
  return children.sort((a, b) => {
    if (a.kind === b.kind) return sortByName(a, b);
    return a.kind === "directory" ? -1 : 1;
  });
}

export { isMarkdown, skipEntry, sortByName, within, readText, scanDirectory };
