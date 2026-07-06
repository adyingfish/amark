// milkdown-image-src.ts - Render local image paths through the asset protocol.
//
// The commonmark preset's image toDOM copies node.attrs.src into <img src>
// verbatim, so a local path like `./assets/a.png` resolves against the app's
// own origin and 404s. This extension rewrites only the rendered src via
// services/image-src (editor-agnostic, keeps the resolution logic testable);
// node.attrs.src keeps the original markdown value, so serialization and
// clipboard round-trips are untouched.
import { imageAttr, imageSchema } from "@milkdown/kit/preset/commonmark";
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
