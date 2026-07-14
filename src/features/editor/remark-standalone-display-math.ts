// remark-standalone-display-math.ts - Mark a source-line `$$...$$` as display math.
//
// remark-math parses same-line double-dollar fences as inlineMath, even when
// they occupy their own source line. Keep the mdast node inline so Markdown
// round-trips exactly, but annotate it for display-mode KaTeX rendering.
import type { Root } from "mdast";
import type { Plugin } from "unified";
import { readPreservedMathSource } from "./remark-math-source";

const DISPLAY_KEY = "amarkStandaloneDisplayMath";

interface SourceNode {
  type?: string;
  data?: Record<string, unknown>;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  children?: SourceNode[];
}

function hasDoubleDollarFence(raw: string): boolean {
  const opening = raw.match(/^\${2,}/)?.[0];
  return opening !== undefined && raw.length > opening.length * 2 && raw.endsWith(opening);
}

function occupiesSourceLine(markdown: string, start: number, end: number): boolean {
  const lineStart = markdown.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextNewline = markdown.indexOf("\n", end);
  const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
  return (
    markdown.slice(lineStart, start).trim() === "" && markdown.slice(end, lineEnd).trim() === ""
  );
}

function walk(node: SourceNode, markdown: string): void {
  if (node.type === "inlineMath") {
    const source = readPreservedMathSource(node);
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (
      source &&
      hasDoubleDollarFence(source.raw) &&
      start !== undefined &&
      end !== undefined &&
      occupiesSourceLine(markdown, start, end)
    ) {
      node.data = { ...node.data, [DISPLAY_KEY]: true };
    }
  }

  node.children?.forEach((child) => walk(child, markdown));
}

export function isStandaloneDisplayMath(node: { data?: unknown }): boolean {
  const data = node.data;
  return Boolean(
    data && typeof data === "object" && (data as Record<string, unknown>)[DISPLAY_KEY],
  );
}

export const remarkStandaloneDisplayMath: Plugin<[], Root> = function () {
  return (tree, file): void => walk(tree, String(file.value));
};
