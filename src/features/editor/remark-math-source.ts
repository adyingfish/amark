// remark-math-source.ts - Preserve the exact Markdown spelling of math nodes.
//
// remark-math intentionally stores only semantic value/meta in mdast, so its
// serializer canonicalizes fence lengths. A.mark otherwise goes to considerable
// effort to avoid silent source rewrites, so capture each original token from
// its positional offsets and reuse it while the semantic value is unchanged.
import type { Root } from "mdast";
import type { JSONRecord } from "@milkdown/kit/transformer";
import { mathToMarkdown } from "mdast-util-math";
import type { Plugin } from "unified";

const SOURCE_KEY = "amarkMathSource";

export interface PreservedMathSource {
  raw: string;
  value: string;
  meta: string | null;
}

interface MathSourceNode {
  type: "math" | "inlineMath";
  value: string;
  meta?: string | null;
  data?: Record<string, unknown>;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  children?: MathSourceNode[];
}

function isMathNode(node: { type?: string }): node is MathSourceNode {
  return node.type === "math" || node.type === "inlineMath";
}

function walk(node: unknown, visit: (node: MathSourceNode) => void): void {
  if (!node || typeof node !== "object") return;
  const candidate = node as { type?: string; children?: unknown[] };
  if (isMathNode(candidate)) visit(candidate);
  candidate.children?.forEach((child) => walk(child, visit));
}

function reusableSource(node: MathSourceNode, raw: string): string {
  if (node.type === "inlineMath") return raw;

  // Positional slices inside block quotes/lists contain the container marker
  // on continuation lines. Reusing that whole slice would make remark add the
  // marker a second time. Preserve the exact opening/closing fences but rebuild
  // the body from the semantic value so the parent container can indent it.
  const lines = raw.split(/\r?\n/);
  const opening = lines[0] ?? "$$";
  const openingFence = opening.match(/^\$+/)?.[0] ?? "$$";
  const closing =
    lines
      .at(-1)
      ?.match(/\$+\s*$/)?.[0]
      .trim() || openingFence;
  return opening + "\n" + (node.value ? node.value + "\n" : "") + closing;
}

export function readPreservedMathSource(node: { data?: unknown }): PreservedMathSource | null {
  const data = node.data;
  if (!data || typeof data !== "object") return null;
  const source = (data as Record<string, unknown>)[SOURCE_KEY];
  if (!source || typeof source !== "object") return null;

  const { raw, value, meta } = source as Record<string, unknown>;
  if (typeof raw !== "string" || typeof value !== "string") return null;
  if (meta !== null && typeof meta !== "string") return null;
  return { raw, value, meta };
}

export function mathSourceData(source: PreservedMathSource): JSONRecord {
  return {
    [SOURCE_KEY]: {
      raw: source.raw,
      value: source.value,
      meta: source.meta,
    },
  };
}

export const remarkPreserveMathSource: Plugin<[], Root> = function () {
  const processorData = this.data();
  const toMarkdownExtensions =
    processorData.toMarkdownExtensions || (processorData.toMarkdownExtensions = []);
  const canonical = mathToMarkdown();
  const canonicalMath = canonical.handlers?.math;
  const canonicalInlineMath = canonical.handlers?.inlineMath;

  if (!canonicalMath || !canonicalInlineMath) {
    throw new Error("mdast-util-math did not provide math serializers");
  }

  toMarkdownExtensions.push({
    handlers: {
      math(node, parent, state, info) {
        const source = readPreservedMathSource(node);
        const math = node as MathSourceNode;
        const meta = math.meta ?? null;
        if (source && source.raw && source.value === math.value && source.meta === meta) {
          return source.raw;
        }
        return canonicalMath(node, parent, state, info);
      },
      inlineMath(node, parent, state, info) {
        const source = readPreservedMathSource(node);
        const math = node as MathSourceNode;
        if (source && source.raw && source.value === math.value && source.meta === null) {
          return source.raw;
        }
        return canonicalInlineMath(node, parent, state, info);
      },
    },
  });

  return (tree, file) => {
    const markdown = String(file.value);
    walk(tree, (node) => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (start === undefined || end === undefined) return;

      const source: PreservedMathSource = {
        raw: reusableSource(node, markdown.slice(start, end)),
        value: node.value,
        meta: node.type === "math" ? (node.meta ?? null) : null,
      };
      node.data = { ...node.data, ...mathSourceData(source) };
    });
  };
};
