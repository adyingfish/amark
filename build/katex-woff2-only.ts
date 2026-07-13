import { Buffer } from "node:buffer";
import type { Plugin } from "vite-plus";

export const KATEX_FONT_FACE_COUNT = 20;

export interface KatexCssTransformResult {
  css: string;
  fontFaceCount: number;
  woff2SourceCount: number;
}

export interface BundleArtifact {
  fileName: string;
  bytes: number;
}

export interface KatexFontBudget {
  maxWoff2Bytes: number;
}

export const DEFAULT_KATEX_FONT_BUDGET: KatexFontBudget = {
  maxWoff2Bytes: 270_000,
};

const FONT_FACE_PATTERN = /@font-face\s*\{[^{}]*\}/gi;
const SOURCE_DECLARATION_PATTERN = /src\s*:\s*[^;}]+/i;
const WOFF2_SOURCE_PATTERN = /url\([^)]*\)\s*format\(\s*["']woff2["']\s*\)/gi;
const WOFF2_FORMAT_PATTERN = /format\(\s*["']woff2["']\s*\)/gi;
const LEGACY_FORMAT_PATTERN = /format\(\s*["'](?:woff|truetype)["']\s*\)/i;
const LEGACY_FONT_REFERENCE_PATTERN = /\.(?:woff|ttf)(?=[?#'"\s)]|$)/i;
const KATEX_FONT_ASSET_PATTERN = /(?:^|\/)KaTeX_[^/]+\.(woff2?|ttf)$/i;
const KATEX_FONT_FAMILY_PATTERN = /font-family\s*:\s*["']?KaTeX_/i;
const INLINE_WOFF2_PATTERN = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/gi;

const formatBytes = (bytes: number): string => `${(bytes / 1_000).toFixed(1)} KB`;

export const isKatexStylesheet = (id: string): boolean => {
  const normalizedId = id.split(/[?#]/, 1)[0].replaceAll("\\", "/");
  return /(?:^|\/)node_modules\/katex\/dist\/katex\.min\.css$/.test(normalizedId);
};

export const keepKatexWoff2Sources = (css: string): KatexCssTransformResult => {
  const fontFaces = css.match(FONT_FACE_PATTERN) ?? [];
  if (fontFaces.length !== KATEX_FONT_FACE_COUNT) {
    throw new Error(
      `[katex-woff2-only] Expected ${KATEX_FONT_FACE_COUNT} @font-face rules, found ${fontFaces.length}. Review the transformer after upgrading KaTeX.`,
    );
  }

  const transformedCss = css.replace(FONT_FACE_PATTERN, (fontFace) => {
    const sourceDeclaration = fontFace.match(SOURCE_DECLARATION_PATTERN)?.[0];
    if (!sourceDeclaration) {
      throw new Error("[katex-woff2-only] A KaTeX @font-face rule has no src declaration.");
    }

    const woff2Sources = sourceDeclaration.match(WOFF2_SOURCE_PATTERN) ?? [];
    if (woff2Sources.length !== 1 || !woff2Sources[0].includes(".woff2")) {
      throw new Error(
        `[katex-woff2-only] Expected exactly one local WOFF2 source per @font-face rule, found ${woff2Sources.length}.`,
      );
    }

    return fontFace.replace(SOURCE_DECLARATION_PATTERN, `src:${woff2Sources[0]}`);
  });

  const woff2SourceCount = transformedCss.match(WOFF2_FORMAT_PATTERN)?.length ?? 0;
  if (woff2SourceCount !== KATEX_FONT_FACE_COUNT) {
    throw new Error(
      `[katex-woff2-only] Expected ${KATEX_FONT_FACE_COUNT} WOFF2 sources after transformation, found ${woff2SourceCount}.`,
    );
  }
  if (
    LEGACY_FORMAT_PATTERN.test(transformedCss) ||
    LEGACY_FONT_REFERENCE_PATTERN.test(transformedCss)
  ) {
    throw new Error(
      "[katex-woff2-only] Legacy WOFF or TTF references remain after transformation.",
    );
  }

  return {
    css: transformedCss,
    fontFaceCount: fontFaces.length,
    woff2SourceCount,
  };
};

export const assertKatexBundleArtifacts = (
  artifacts: readonly BundleArtifact[],
  budget: KatexFontBudget = DEFAULT_KATEX_FONT_BUDGET,
  inlineWoff2Bytes = 0,
): void => {
  const katexFonts = artifacts.filter(({ fileName }) => KATEX_FONT_ASSET_PATTERN.test(fileName));
  const legacyFonts = katexFonts.filter(({ fileName }) => /\.(?:woff|ttf)$/i.test(fileName));
  if (legacyFonts.length > 0) {
    throw new Error(
      `[katex-woff2-only] Legacy KaTeX font assets were emitted: ${legacyFonts.map(({ fileName }) => fileName).join(", ")}.`,
    );
  }

  const woff2Fonts = katexFonts.filter(({ fileName }) => /\.woff2$/i.test(fileName));
  if (woff2Fonts.length === 0) {
    throw new Error("[katex-woff2-only] No emitted KaTeX WOFF2 assets were found.");
  }

  const woff2Bytes = woff2Fonts.reduce((sum, { bytes }) => sum + bytes, 0) + inlineWoff2Bytes;
  if (woff2Bytes > budget.maxWoff2Bytes) {
    throw new Error(
      `[katex-woff2-only] Emitted KaTeX WOFF2 assets total ${formatBytes(woff2Bytes)}, exceeding the ${formatBytes(budget.maxWoff2Bytes)} budget.`,
    );
  }
};

export const countInlineKatexWoff2Bytes = (css: string): number => {
  let bytes = 0;
  for (const fontFace of css.match(FONT_FACE_PATTERN) ?? []) {
    if (!KATEX_FONT_FAMILY_PATTERN.test(fontFace)) continue;
    for (const match of fontFace.matchAll(INLINE_WOFF2_PATTERN)) {
      bytes += Buffer.from(match[1], "base64").byteLength;
    }
  }
  return bytes;
};

export const katexWoff2OnlyPlugin = (): Plugin => {
  let transformedKatexStylesheet = false;

  return {
    name: "amark:katex-woff2-only",
    enforce: "pre",
    buildStart() {
      transformedKatexStylesheet = false;
    },
    transform(css, id) {
      if (!isKatexStylesheet(id)) return null;

      const result = keepKatexWoff2Sources(css);
      transformedKatexStylesheet = true;
      return { code: result.css, map: null };
    },
    generateBundle(_options, bundle) {
      if (!transformedKatexStylesheet) {
        throw new Error(
          "[katex-woff2-only] KaTeX CSS was not transformed. Check the stylesheet import and plugin path matcher.",
        );
      }

      const artifacts = Object.values(bundle)
        .filter((output) => output.type === "asset")
        .map(
          (output): BundleArtifact => ({
            fileName: output.fileName,
            bytes:
              typeof output.source === "string"
                ? Buffer.byteLength(output.source)
                : output.source.byteLength,
          }),
        );
      const inlineWoff2Bytes = Object.values(bundle).reduce((total, output) => {
        if (
          output.type !== "asset" ||
          !output.fileName.endsWith(".css") ||
          typeof output.source !== "string"
        ) {
          return total;
        }
        return total + countInlineKatexWoff2Bytes(output.source);
      }, 0);
      assertKatexBundleArtifacts(artifacts, DEFAULT_KATEX_FONT_BUDGET, inlineWoff2Bytes);
    },
  };
};
