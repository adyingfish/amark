// export-document.ts - Editor-agnostic document export helpers.
//
// Turns rendered editor HTML into a standalone, self-styled HTML document and
// drives browser-based PDF export via the print dialog. This module must not
// import any editor-specific code; callers pass in the already-rendered HTML
// body (e.g. from EditorAdapter.getHTML()).

/** Collect all same-origin stylesheet text currently applied to the app. */
function collectAppStyles(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        chunks.push(rule.cssText);
      }
    } catch {
      // Cross-origin sheets throw on cssRules access; skip them.
    }
  }
  return chunks.join("\n");
}

// Neutralize the app's screen-oriented layout (fixed viewport heights, hidden
// overflow) so exported/printed output flows as a normal document.
const EXPORT_OVERRIDES = `
  html, body { height: auto; overflow: visible; }
  #editor { height: auto; overflow: visible; padding: 40px; }
  #editor .ProseMirror { min-height: auto; max-width: 780px; margin: 0 auto; }
  @media print {
    #editor { padding: 0; }
    #editor .ProseMirror { max-width: none; }
  }
`;

/**
 * Build a complete, self-contained HTML document from rendered editor HTML.
 * The result mirrors the in-app appearance: it carries the active theme class,
 * inlines the app stylesheets, and wraps the content in the editor's DOM shape
 * (`#editor > .ProseMirror`) so existing CSS selectors apply.
 */
export function buildHtmlDocument(bodyHtml: string, title: string): string {
  const themeClass = document.body.className;
  const styles = collectAppStyles();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
<style>${EXPORT_OVERRIDES}</style>
</head>
<body class="${escapeHtml(themeClass)}">
<div id="editor"><div class="ProseMirror">${bodyHtml}</div></div>
</body>
</html>`;
}

/**
 * Open a fully-formed HTML document in an offscreen iframe and trigger the
 * browser print dialog (where the user can choose "Save as PDF"). The iframe is
 * removed once printing is dismissed.
 */
export function printHtmlDocument(htmlDoc: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";

  const cleanup = () => {
    // Defer removal so the print dialog has fully detached from the frame.
    window.setTimeout(() => iframe.remove(), 0);
  };

  iframe.addEventListener("load", () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }
    frameWindow.addEventListener("afterprint", cleanup, { once: true });
    frameWindow.focus();
    frameWindow.print();
  });

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(htmlDoc);
  doc.close();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
