// remark-standalone-display-math.ts - Treat a source-line `$$...$$` as display math.
//
// remark-math parses same-line double-dollar fences as inlineMath, even when
// they occupy their own source line. When such a formula is a paragraph's only
// content, promote the paragraph to a block math node: an inline atom stranded
// alone in a paragraph makes ProseMirror append its trailing-break hack, which
// the block-level formula pushes onto a phantom empty line (and forward-delete
// there merges the next paragraph onto the formula's source line). The source
// preserved by remark-math-source keeps the Markdown round-trip exact. When
// other inline content shares the paragraph, keep the mdast node inline but
// annotate it for display-mode KaTeX rendering.
import type { Root } from "mdast";
import type { Plugin } from "unified";
import { readPreservedMathSource } from "./remark-math-source";

const DISPLAY_KEY = "amarkStandaloneDisplayMath";

interface SourceNode {
  type?: string;
  value?: string;
  meta?: string | null;
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

function isStandaloneDisplay(node: SourceNode, markdown: string): boolean {
  if (node.type !== "inlineMath") return false;
  const source = readPreservedMathSource(node);
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return (
    source !== null &&
    hasDoubleDollarFence(source.raw) &&
    start !== undefined &&
    end !== undefined &&
    occupiesSourceLine(markdown, start, end)
  );
}

function walk(node: SourceNode, markdown: string): void {
  const children = node.children;
  if (!children) return;

  children.forEach((child, index) => {
    const soleChild =
      child.type === "paragraph" && child.children?.length === 1 ? child.children[0] : undefined;
    if (soleChild && isStandaloneDisplay(soleChild, markdown)) {
      children[index] = {
        type: "math",
        value: soleChild.value ?? "",
        meta: null,
        data: soleChild.data,
      };
      return;
    }

    if (isStandaloneDisplay(child, markdown)) {
      child.data = { ...child.data, [DISPLAY_KEY]: true };
    }
    walk(child, markdown);
  });
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
