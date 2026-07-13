import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertKatexBundleArtifacts,
  isKatexStylesheet,
  KATEX_FONT_FACE_COUNT,
  keepKatexWoff2Sources,
} from "./katex-woff2-only";

const katexCssPath = fileURLToPath(
  new URL("../node_modules/katex/dist/katex.min.css", import.meta.url),
);

describe("keepKatexWoff2Sources", () => {
  it("keeps all KaTeX font faces while removing legacy sources", () => {
    const source = readFileSync(katexCssPath, "utf8");
    const result = keepKatexWoff2Sources(source);

    expect(result.fontFaceCount).toBe(KATEX_FONT_FACE_COUNT);
    expect(result.woff2SourceCount).toBe(KATEX_FONT_FACE_COUNT);
    expect(result.css).not.toMatch(/format\(["']woff["']\)/);
    expect(result.css).not.toMatch(/format\(["']truetype["']\)/);
    expect(result.css).not.toMatch(/\.(?:woff|ttf)(?=[?#'"\s)]|$)/);
    expect(result.css).toContain(".katex-display");
  });

  it("fails loudly when the KaTeX font-face structure changes", () => {
    expect(() => keepKatexWoff2Sources(".katex{display:block}")).toThrow(
      `Expected ${KATEX_FONT_FACE_COUNT} @font-face rules`,
    );
  });
});

describe("isKatexStylesheet", () => {
  it("matches resolved KaTeX CSS ids with Vite queries", () => {
    expect(isKatexStylesheet("/repo/node_modules/katex/dist/katex.min.css?direct")).toBe(true);
    expect(isKatexStylesheet("C:\\repo\\node_modules\\katex\\dist\\katex.min.css")).toBe(true);
    expect(isKatexStylesheet("/repo/src/katex.min.css")).toBe(false);
  });
});

describe("assertKatexBundleArtifacts", () => {
  const validArtifacts = [
    { fileName: "assets/KaTeX_Main-Regular-a1.woff2", bytes: 24_000 },
    { fileName: "assets/index-a1.js", bytes: 1_000_000 },
    { fileName: "assets/index-a1.css", bytes: 70_000 },
  ];

  it("accepts a WOFF2-only bundle within budget", () => {
    expect(() => assertKatexBundleArtifacts(validArtifacts)).not.toThrow();
  });

  it("rejects legacy font assets", () => {
    expect(() =>
      assertKatexBundleArtifacts([
        ...validArtifacts,
        { fileName: "assets/KaTeX_Main-Regular-a1.ttf", bytes: 50_000 },
      ]),
    ).toThrow("Legacy KaTeX font assets were emitted");
  });

  it("rejects a production bundle over the total budget", () => {
    expect(() =>
      assertKatexBundleArtifacts([
        { fileName: "assets/KaTeX_Main-Regular-a1.woff2", bytes: 24_000 },
        { fileName: "assets/index-a1.js", bytes: 1_500_000 },
      ]),
    ).toThrow("production budget");
  });
});
