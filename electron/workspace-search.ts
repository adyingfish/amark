import type { Commands, WorkspaceSearchResult } from "../shared/desktop";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { isMarkdown, skipEntry, sortByName, readText } from "./workspace-files.js";

const MAX_PER_FILE = 50;
const MAX_TOTAL = 500;
const CONTEXT = 50;

function findMatches(
  file: string,
  content: string,
  query: string,
  caseSensitive: boolean,
  result: WorkspaceSearchResult,
) {
  const length = Array.from(query).length;
  const needle = caseSensitive ? query : query.toLowerCase();
  let count = 0;
  let lineStart = 0;
  let lineNumber = 0;
  for (const rawLine of content.split("\n")) {
    lineNumber++;
    const startOfLine = lineStart;
    lineStart += rawLine.length + 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    // Most lines have no match. Avoid allocating a code-point array and a
    // substring for each character. Greek sigma casing depends on adjacent
    // characters, so keep the candidate-by-candidate check for those lines.
    if (
      caseSensitive
        ? !line.includes(needle)
        : !line.includes("Σ") && !line.toLowerCase().includes(needle)
    )
      continue;
    const chars = Array.from(line);
    let offset = 0;
    for (let i = 0; i <= chars.length - length; ) {
      const candidate = chars.slice(i, i + length).join("");
      if ((caseSensitive ? candidate : candidate.toLowerCase()) !== needle) {
        offset += chars[i++].length;
        continue;
      }
      if (count === MAX_PER_FILE || result.matches.length === MAX_TOTAL) {
        result.truncated = true;
        return;
      }
      const left = Math.max(0, i - CONTEXT);
      const right = Math.min(chars.length, i + length + CONTEXT);
      const before = (left > 0 ? "…" : "") + chars.slice(left, i).join("");
      const after = chars.slice(i + length, right).join("") + (right < chars.length ? "…" : "");
      result.matches.push({
        file_path: file,
        file_name: path.basename(file),
        line: lineNumber,
        column: i + 1,
        start: startOfLine + offset,
        end: startOfLine + offset + candidate.length,
        preview: before + candidate + after,
        preview_match_start: before.length,
        preview_match_end: before.length + candidate.length,
      });
      count++;
      i += length;
      offset += candidate.length;
    }
  }
}

async function searchWorkspace({
  rootPath,
  query,
  caseSensitive,
  showHidden,
  overrides,
}: Commands["search_workspace"]["args"]) {
  const result: WorkspaceSearchResult = { matches: [], truncated: false };
  if (!query) return result;
  const pathKey = (file: string) => (process.platform === "win32" ? file.toLowerCase() : file);
  const dirty = new Map(
    overrides.map(({ path: file, content }) => [pathKey(path.resolve(file)), content]),
  );

  async function visit(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort(sortByName)) {
      if (skipEntry(entry.name, showHidden)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile() && isMarkdown(file)) {
        const content = dirty.get(pathKey(file)) ?? (await readText(file).catch(() => null));
        if (content !== null) findMatches(file, content, query, caseSensitive, result);
      }
      if (result.matches.length === MAX_TOTAL && result.truncated) return;
    }
  }
  await visit(rootPath);
  return result;
}

searchWorkspace(workerData).then((result) => parentPort!.postMessage(result));
