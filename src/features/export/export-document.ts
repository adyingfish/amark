// export-document.ts - Editor-agnostic document export helpers.
//
// Turns rendered editor HTML into a standalone, self-styled HTML document and
// drives browser-based PDF export via the print dialog. This module must not
// import any editor-specific code; callers pass in the already-rendered HTML
// body (e.g. from EditorAdapter.getHTML()).

const FONT_ASSET_PATTERN = /\.(?:woff2?|ttf)(?:$|[?#])/i;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^'")\s]+))\s*\)/g;

function fontMimeType(url: URL): string {
  const path = url.pathname.toLowerCase();
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  return "font/ttf";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function loadFontDataUrl(url: URL): Promise<string> {
  const response = await fetch(url.href);
  if (!response.ok) {
    throw new Error("Failed to load export font (" + response.status + "): " + url.href);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return "data:" + fontMimeType(url) + ";base64," + bytesToBase64(bytes);
}

async function inlineFontAssets(
  css: string,
  baseUrl: string,
  cache: Map<string, Promise<string>>,
): Promise<string> {
  const replacements = await Promise.all(
    Array.from(css.matchAll(CSS_URL_PATTERN)).map(async (match) => {
      const rawUrl = match[1] ?? match[2] ?? match[3];
      if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) return null;

      let url: URL;
      try {
        url = new URL(rawUrl, baseUrl);
      } catch {
        return null;
      }
      if (!FONT_ASSET_PATTERN.test(url.href)) return null;

      let dataUrl = cache.get(url.href);
      if (!dataUrl) {
        dataUrl = loadFontDataUrl(url);
        cache.set(url.href, dataUrl);
      }
      return {
        start: match.index,
        end: match.index + match[0].length,
        value: 'url("' + (await dataUrl) + '")',
      };
    }),
  );

  let result = css;
  for (const replacement of replacements.filter((item) => item !== null).reverse()) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}

/** Collect same-origin stylesheet text and embed its local font assets. */
async function collectAppStyles(): Promise<string> {
  const chunks: string[] = [];
  const fontCache = new Map<string, Promise<string>>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin sheets throw on cssRules access; skip them.
      continue;
    }
    if (!rules) continue;
    const css = Array.from(rules, (rule) => rule.cssText).join("\n");
    chunks.push(await inlineFontAssets(css, sheet.href ?? document.baseURI, fontCache));
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
export async function buildHtmlDocument(bodyHtml: string, title: string): Promise<string> {
  const themeClass = document.body.className;
  const styles = await collectAppStyles();

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

  iframe.addEventListener("load", async () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }
    try {
      await frameWindow.document.fonts?.ready;
    } catch {
      // Printing is still preferable to silently doing nothing if a browser
      // does not implement the CSS Font Loading API correctly.
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
