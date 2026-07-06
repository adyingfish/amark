// @vitest-environment jsdom
//
// Proves the imageSrcSchema extension actually takes over rendering: a later
// .use() with the same node name must override commonmark's built-in image
// schema (schema assembly keeps the last registration), and its toDOM must
// route local paths through convertFileSrc while leaving node.attrs.src — and
// therefore markdown serialization — untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { replaceAll } from "@milkdown/kit/utils";
import { imageSrcSchema } from "./milkdown-image-src";
import { setImageBaseDirFromFile } from "../../services/image-src";

// convertFileSrc reads window.__TAURI_INTERNALS__ at call time; stub the
// shape it needs so toDOM can run outside a real Tauri webview.
type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

beforeEach(() => {
  (window as TauriWindow).__TAURI_INTERNALS__ = {
    convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  };
});

afterEach(() => {
  delete (window as TauriWindow).__TAURI_INTERNALS__;
  setImageBaseDirFromFile(null);
  vi.restoreAllMocks();
});

async function makeEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, "");
    })
    .use(commonmark)
    .use(imageSrcSchema)
    .create();
  return { editor, container };
}

describe("imageSrcSchema", () => {
  it("renders a relative image src through the asset protocol", async () => {
    const { editor, container } = await makeEditor();
    setImageBaseDirFromFile("/ws/docs/note.md");

    editor.action(replaceAll("![alt](./assets/a.png)", true));

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(
      `asset://localhost/${encodeURIComponent("/ws/docs/assets/a.png")}`,
    );

    editor.destroy();
    container.remove();
  });

  it("leaves remote srcs and markdown serialization untouched", async () => {
    const { editor, container } = await makeEditor();
    setImageBaseDirFromFile("/ws/docs/note.md");

    editor.action(replaceAll("![alt](https://example.com/a.png)", true));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");

    // The rewrite is render-only: the document node keeps the original path.
    editor.action(replaceAll("![alt](./assets/a.png)", true));
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let src: string | undefined;
      view.state.doc.descendants((node) => {
        if (node.type.name === "image") src = node.attrs.src as string;
      });
      expect(src).toBe("./assets/a.png");
    });

    editor.destroy();
    container.remove();
  });
});
