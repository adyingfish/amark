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

// ---------------------------------------------------------------------------
// Shared render scheduler.
//
// Mermaid executes renders serially, so every diagram pays queueing time
// behind the ones before it. On top of that, each diagram here is only
// scheduled when it is actually needed (the editor NodeViews gate on viewport
// visibility), which keeps first-open and theme-switch cost proportional to
// the number of *visible* diagrams instead of the total. The queue adds two
// things mermaid's internal serialization cannot: dropping tasks that went
// stale before they started, and letting user-facing renders (a diagram that
// just scrolled into view, or the draft being edited) jump ahead of
// lower-priority background refreshes.

interface ScheduledMermaidRender {
  source: string;
  priority: boolean;
  cancelled?: () => boolean;
  resolve: (result: MermaidRenderResult) => void;
  reject: (error: unknown) => void;
}

const renderQueue: ScheduledMermaidRender[] = [];
let pumpingQueue = false;

export interface ScheduleMermaidRenderOptions {
  /** High-priority tasks run before already-queued low-priority ones (FIFO within each class). */
  priority?: boolean;
  /** Checked right before a queued task starts; stale tasks are dropped without rendering. */
  cancelled?: () => boolean;
}

export function scheduleMermaidRender(
  source: string,
  options: ScheduleMermaidRenderOptions = {},
): Promise<MermaidRenderResult> {
  return new Promise<MermaidRenderResult>((resolve, reject) => {
    const task: ScheduledMermaidRender = {
      source,
      priority: options.priority ?? false,
      cancelled: options.cancelled,
      resolve,
      reject,
    };
    if (task.priority) {
      let insertAt = renderQueue.length;
      while (insertAt > 0 && !renderQueue[insertAt - 1].priority) insertAt -= 1;
      renderQueue.splice(insertAt, 0, task);
    } else {
      renderQueue.push(task);
    }
    void pumpRenderQueue();
  });
}

async function pumpRenderQueue(): Promise<void> {
  if (pumpingQueue) return;
  pumpingQueue = true;
  try {
    for (let task = renderQueue.shift(); task; task = renderQueue.shift()) {
      if (task.cancelled?.()) {
        task.reject(new Error("mermaid render cancelled before it started"));
        continue;
      }
      try {
        task.resolve(await renderMermaidDiagram(task.source));
      } catch (error) {
        task.reject(error);
      }
    }
  } finally {
    pumpingQueue = false;
  }
}
