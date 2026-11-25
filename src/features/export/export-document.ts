// export-document.ts - Editor-agnostic document export helpers.
//
// Turns rendered editor HTML into a standalone, self-styled HTML document and
// prepares the same content for the native PDF exporter. This module must not
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

async function loadAssetDataUrl(url: string, mimeType?: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load export asset (" + response.status + "): " + url);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return (
    "data:" +
    (mimeType ?? response.headers.get("Content-Type") ?? "application/octet-stream") +
    ";base64," +
    bytesToBase64(bytes)
  );
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
        dataUrl = loadAssetDataUrl(url.href, fontMimeType(url));
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
  #editor .ProseMirror { min-height: auto; max-width: 42em; margin: 0 auto; }
  @media print {
    #editor { padding: 0; }
    #editor .ProseMirror { max-width: none; }
  }
`;

/**
 * Replace ```mermaid code blocks in serialized editor HTML with rendered SVG
 * diagrams, so exported documents show the diagram instead of the source
 * fence. Blocks that fail to render are left untouched (source preserved).
 * Rendering goes through the same lazy helper as the editor, so colors match
 * the active app theme.
 *
 * Exported documents are intentionally static: `bindFunctions` is not invoked
 * here because the exported file carries no mermaid runtime, so event-based
 * behaviors (tooltips, click/link handlers) could not fire anyway — and
 * running it against the app's live document would only leak mermaid's
 * tooltip element into the editor. This mirrors the in-editor default, where
 * `securityLevel: "strict"` already strips click/link interactions.
 */
export async function renderMermaidBlocksInHtml(html: string): Promise<string> {
  if (!html.toLowerCase().includes('data-language="mermaid"')) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = Array.from(doc.querySelectorAll("pre[data-language]")).filter(
    (el) => el.getAttribute("data-language")?.trim().toLowerCase() === "mermaid",
  );
  if (blocks.length === 0) return html;

  const { renderMermaidDiagram } = await import("../../lib/mermaid-render");
  let replaced = false;
  await Promise.all(
    blocks.map(async (pre) => {
      try {
        const { svg } = await renderMermaidDiagram(pre.textContent ?? "");
        const container = doc.createElement("div");
        container.className = "mermaid-diagram";
        container.innerHTML = svg;
        pre.replaceWith(container);
        replaced = true;
      } catch {
        // Keep the source block: exporting the raw fence beats losing content.
      }
    }),
  );
  return replaced ? doc.body.innerHTML : html;
}

/** Per-window image URLs expire when AMark closes. Keep exported documents portable. */
async function embedWorkspaceImages(bodyHtml: string): Promise<string> {
  if (!bodyHtml.includes("amark-asset:")) return bodyHtml;
  const template = document.createElement("template");
  template.innerHTML = bodyHtml;
  const images = template.content.querySelectorAll<HTMLImageElement>('img[src^="amark-asset:"]');
  const dataUrls = new Map<string, Promise<string>>();
  await Promise.all(
    Array.from(images, async (image) => {
      const url = image.getAttribute("src")!;
      let dataUrl = dataUrls.get(url);
      if (!dataUrl) {
        dataUrl = loadAssetDataUrl(url);
        dataUrls.set(url, dataUrl);
      }
      try {
        image.src = await dataUrl;
      } catch {
        // Preserve the alt text for missing or unreadable images.
        image.removeAttribute("src");
      }
    }),
  );
  return template.innerHTML;
}

/**
 * Build a complete, self-contained HTML document from rendered editor HTML.
 * The result mirrors the in-app appearance: it carries the active theme class,
 * inlines the app stylesheets, and wraps the content in the editor's DOM shape
 * (`#editor > .ProseMirror`) so existing CSS selectors apply.
 */
export async function buildHtmlDocument(bodyHtml: string, title: string): Promise<string> {
  const themeClass = document.body.className;
  const [styles, portableBody] = await Promise.all([
    collectAppStyles(),
    embedWorkspaceImages(bodyHtml),
  ]);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles}</style>
<style>${EXPORT_OVERRIDES}</style>
</head>
<body class="${escapeHtml(themeClass)}">
<div id="editor"><div class="ProseMirror">${portableBody}</div></div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
