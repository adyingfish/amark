// remark-latex-math.ts - Add MathJax-style \(...\) and \[...\] delimiters.
//
// These need micromark constructs so Markdown emphasis/link syntax inside a
// formula is not parsed first. Display formulas split their surrounding
// paragraph into proper block nodes before Milkdown consumes the mdast tree.
import type { Root } from "mdast";
import type { Extension as FromMarkdownExtension, Handle } from "mdast-util-from-markdown";
import type { Construct, Extension, TokenType, Tokenizer } from "micromark-util-types";
import type { Plugin } from "unified";

const DISPLAY_KEY = "amarkLatexDisplayMath";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    latexMathText: "latexMathText";
    latexMathTextMarker: "latexMathTextMarker";
    latexMathTextData: "latexMathTextData";
    latexMathDisplay: "latexMathDisplay";
    latexMathDisplayMarker: "latexMathDisplayMarker";
    latexMathDisplayData: "latexMathDisplayData";
  }
}

function closeConstruct(markerType: TokenType, closeCode: number): Construct {
  return {
    partial: true,
    tokenize(effects, ok, nok) {
      return start;

      function start(code: number | null) {
        if (code !== 92) return nok(code);
        effects.enter(markerType);
        effects.consume(code);
        return close;
      }

      function close(code: number | null) {
        if (code !== closeCode) return nok(code);
        effects.consume(code);
        effects.exit(markerType);
        return ok;
      }
    },
  };
}

function mathTokenizer(
  type: TokenType,
  markerType: TokenType,
  dataType: TokenType,
  openCode: number,
  closeCode: number,
): Tokenizer {
  const close = closeConstruct(markerType, closeCode);

  return function (effects, ok, nok) {
    return start;

    function start(code: number | null) {
      if (code !== 92) return nok(code);
      effects.enter(type);
      effects.enter(markerType);
      effects.consume(code);
      return open;
    }

    function open(code: number | null) {
      if (code !== openCode) return nok(code);
      effects.consume(code);
      effects.exit(markerType);
      return between;
    }

    function between(code: number | null) {
      if (code === null) return nok(code);
      if (code === 92) return effects.attempt(close, done, escapedDataStart)(code);
      if (code === -5 || code === -4 || code === -3) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return between;
      }
      return dataStart(code);
    }

    function escapedDataStart(code: number | null) {
      effects.enter(dataType);
      effects.consume(code);
      return data;
    }

    function dataStart(code: number | null) {
      effects.enter(dataType);
      return data(code);
    }

    function data(code: number | null) {
      if (code === null || code === 92 || code === -5 || code === -4 || code === -3) {
        effects.exit(dataType);
        return between(code);
      }
      effects.consume(code);
      return data;
    }

    function done(code: number | null) {
      effects.exit(type);
      return ok(code);
    }
  };
}

const latexMathSyntax: Extension = {
  text: {
    92: [
      {
        name: "latexMathText",
        tokenize: mathTokenizer(
          "latexMathText",
          "latexMathTextMarker",
          "latexMathTextData",
          40,
          41,
        ),
      },
      {
        name: "latexMathDisplay",
        tokenize: mathTokenizer(
          "latexMathDisplay",
          "latexMathDisplayMarker",
          "latexMathDisplayData",
          91,
          93,
        ),
      },
    ],
  },
};

const enterInlineMath: Handle = function (token) {
  this.enter({ type: "inlineMath", value: "" }, token);
  this.buffer();
};

const enterDisplayMath: Handle = function (token) {
  this.enter({ type: "inlineMath", value: "", data: { [DISPLAY_KEY]: true } }, token);
  this.buffer();
};

const exitMathData: Handle = function (token) {
  this.config.enter.data.call(this, token);
  this.config.exit.data.call(this, token);
};

const exitMath: Handle = function (token) {
  const value = this.resume();
  const node = this.stack[this.stack.length - 1];
  if (node.type !== "inlineMath") throw new Error("Expected an inlineMath node");
  node.value = value;
  this.exit(token);
};

const latexMathFromMarkdown: FromMarkdownExtension = {
  enter: {
    latexMathText: enterInlineMath,
    latexMathDisplay: enterDisplayMath,
  },
  exit: {
    latexMathTextData: exitMathData,
    latexMathText: exitMath,
    latexMathDisplayData: exitMathData,
    latexMathDisplay: exitMath,
  },
};

interface SourceNode {
  type?: string;
  value?: string;
  meta?: string | null;
  data?: Record<string, unknown>;
  position?: {
    start?: { line?: number; column?: number; offset?: number };
    end?: { line?: number; column?: number; offset?: number };
  };
  children?: SourceNode[];
}

function isDisplayMath(node: SourceNode): boolean {
  return Boolean(node.data?.[DISPLAY_KEY]);
}

function paragraph(children: SourceNode[]): SourceNode | null {
  const normalized = [...children];
  const first = normalized[0];
  if (first?.type === "text") normalized[0] = { ...first, value: first.value?.trimStart() };
  const last = normalized[normalized.length - 1];
  if (last?.type === "text") {
    normalized[normalized.length - 1] = { ...last, value: last.value?.trimEnd() };
  }
  const content = normalized.filter((child) => child.type !== "text" || child.value !== "");
  if (content.length === 0) return null;

  return {
    type: "paragraph",
    children: content,
    position: {
      start: content[0]?.position?.start,
      end: content[content.length - 1]?.position?.end,
    },
  };
}

function splitDisplayMath(node: SourceNode): void {
  const children = node.children;
  if (!children) return;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (child.type === "paragraph" && child.children?.some(isDisplayMath)) {
      const replacements: SourceNode[] = [];
      let phrasing: SourceNode[] = [];

      for (const content of child.children) {
        if (isDisplayMath(content)) {
          const before = paragraph(phrasing);
          if (before) replacements.push(before);
          replacements.push({
            type: "math",
            value: content.value ?? "",
            meta: null,
            position: content.position,
          });
          phrasing = [];
        } else {
          phrasing.push(content);
        }
      }
      const after = paragraph(phrasing);
      if (after) replacements.push(after);

      children.splice(index, 1, ...replacements);
      index += replacements.length - 1;
      continue;
    }
    splitDisplayMath(child);
  }
}

export const remarkLatexMath: Plugin<[], Root> = function () {
  const processorData = this.data();
  const micromarkExtensions =
    processorData.micromarkExtensions || (processorData.micromarkExtensions = []);
  const fromMarkdownExtensions =
    processorData.fromMarkdownExtensions || (processorData.fromMarkdownExtensions = []);

  micromarkExtensions.push(latexMathSyntax);
  fromMarkdownExtensions.push(latexMathFromMarkdown);

  return (tree): void => splitDisplayMath(tree);
};
