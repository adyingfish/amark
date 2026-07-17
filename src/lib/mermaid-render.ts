// mermaid-render.ts - Shared, lazily-loaded Mermaid rendering helper.
//
// Mermaid is a heavy dependency, so it is pulled in via dynamic import on
// first use and kept out of the initial bundle. Both the editor NodeView
// (features/editor/milkdown-mermaid-view.ts) and the HTML export pipeline
// (features/export/export-document.ts) render through this module so diagrams
// look identical on screen and in exported documents.

import type { MermaidConfig } from "mermaid";

type MermaidApi = typeof import("mermaid").default;

export interface MermaidRenderResult {
  svg: string;
  /**
   * Installs the diagram's interactive behaviors (tooltips, and any
   * link/click handlers permitted by the active securityLevel). Mermaid's
   * render contract requires calling this with the element *after* the SVG
   * has been inserted into the DOM.
   */
  bindFunctions?: (element: Element) => void;
}

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderSeq = 0;

const loadMermaid = (): Promise<MermaidApi> => {
  mermaidPromise ??= import("mermaid").then((module) => module.default);
  return mermaidPromise;
};

const readThemeVariable = (styles: CSSStyleDeclaration, name: string, fallback: string): string => {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
};

// Derive diagram colors from the active app theme (theme classes set CSS
// variables on <body>, see themes/base.css), so diagrams follow light/dark
// and custom themes instead of shipping fixed colors.
const currentMermaidConfig = (): MermaidConfig => {
  const styles = getComputedStyle(document.body);
  const background = readThemeVariable(styles, "--bg-color", "#ffffff");
  const textColor = readThemeVariable(styles, "--text-color", "#1f1f1f");
  const mutedColor = readThemeVariable(styles, "--text-muted", "#6b6b68");
  const subtleFill = readThemeVariable(styles, "--code-bg", "#f0f0f0");

  return {
    startOnLoad: false,
    securityLevel: "strict",
    // We surface parse errors ourselves; keep mermaid's bomb graphic out of
    // the document.
    suppressErrorRendering: true,
    theme: "base",
    themeVariables: {
      background,
      primaryColor: background,
      primaryTextColor: textColor,
      primaryBorderColor: mutedColor,
      secondaryColor: subtleFill,
      tertiaryColor: subtleFill,
      lineColor: mutedColor,
      textColor,
      fontFamily: styles.fontFamily || "sans-serif",
    },
  };
};

/**
 * Render mermaid source to an SVG string themed after the active app theme.
 * Rejects with the mermaid parse/render error when the source is invalid.
 * Callers that insert the SVG into a live DOM must invoke the returned
 * `bindFunctions` with the container element (see MermaidRenderResult).
 */
export async function renderMermaidDiagram(source: string): Promise<MermaidRenderResult> {
  const mermaid = await loadMermaid();
  mermaid.initialize(currentMermaidConfig());
  const renderId = `amark-mermaid-${(renderSeq += 1)}`;
  try {
    const { svg, bindFunctions } = await mermaid.render(renderId, source);
    return { svg, bindFunctions };
  } catch (error) {
    // Mermaid may leave its temporary render container behind on failure.
    document.getElementById(renderId)?.remove();
    document.getElementById(`d${renderId}`)?.remove();
    throw error;
  }
}
