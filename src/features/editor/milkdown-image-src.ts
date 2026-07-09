// milkdown-image-src.ts - Render local image paths through the asset protocol.
//
// The commonmark preset's image toDOM copies node.attrs.src into <img src>
// verbatim, so a local path like `./assets/a.png` resolves against the app's
// own origin and 404s. This extension rewrites only the rendered src via
// services/image-src (editor-agnostic, keeps the resolution logic testable);
// node.attrs.src keeps the original markdown value, so serialization and
// clipboard round-trips are untouched.
import { htmlSchema, imageAttr, imageSchema } from "@milkdown/kit/preset/commonmark";
import { resolveImageSrc } from "../../services/image-src";

export const imageSrcSchema = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toDOM: (node) => [
      "img",
      {
        ...ctx.get(imageAttr.key)(node),
        ...node.attrs,
        src: resolveImageSrc(node.attrs.src as string),
      },
    ],
  };
});

// A raw-HTML chunk that is nothing but one <img> tag. Anything else (mixed
// tags, non-img HTML) keeps the preset's literal-text rendering.
const SINGLE_IMG_TAG_PATTERN = /^<img\b[^<>]*\/?>$/i;

// Rendered attributes are an allowlist: raw HTML in a document must not be
// able to attach arbitrary attributes (event handlers, style) to a live
// element.
const IMG_ATTR_ALLOWLIST = ["alt", "title", "width", "height"] as const;

/**
 * The preset's html node renders its raw value as literal text, so an
 * HTML-syntax image (`<img src="...">`) never displayed as an image at all.
 * When the value is a single <img> tag, render a real image instead — same
 * src resolution as markdown-syntax images, allowlisted attributes only.
 * node.attrs.value still holds the raw HTML, so serialization is untouched.
 */
export const htmlImageSchema = htmlSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    toDOM: (node) => {
      const value = (node.attrs.value as string).trim();
      // htmlSchema always defines toDOM; the preset's NodeSpec type just marks it optional.
      if (!SINGLE_IMG_TAG_PATTERN.test(value)) return base.toDOM!(node);

      // DOMParser inert document: nothing loads or executes during parsing.
      const parsed = new DOMParser().parseFromString(value, "text/html").querySelector("img");
      if (!parsed) return base.toDOM!(node);

      const attrs: Record<string, string> = {
        "data-type": "html-img",
        "data-value": node.attrs.value as string,
        src: resolveImageSrc(parsed.getAttribute("src") ?? ""),
      };
      for (const name of IMG_ATTR_ALLOWLIST) {
        const attrValue = parsed.getAttribute(name);
        if (attrValue !== null) attrs[name] = attrValue;
      }
      return ["img", attrs];
    },
    // Keep DOM-based round-trips (parseDOM only matched the literal-text
    // span) able to recover the raw HTML from the rendered image.
    parseDOM: [
      {
        tag: 'img[data-type="html-img"]',
        getAttrs: (dom: HTMLElement) => ({ value: dom.dataset.value ?? "" }),
      },
      ...(base.parseDOM ?? []),
    ],
  };
});
