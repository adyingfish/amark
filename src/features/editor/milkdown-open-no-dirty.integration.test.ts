// @vitest-environment jsdom
//
// Regression guard for the "opening a file silently marks it dirty" bug.
//
// Milkdown's listener debounces markdownUpdated by ~200ms, so a programmatic
// document load dispatched as a normal transaction (replaceAll(md)) fires a
// spurious markdownUpdated *after* MilkdownAdapter's synchronous
// isSettingContent guard has already reset — which marked freshly-opened files
// dirty and let a later save rewrite them in normalized form. The adapter loads
// with replaceAll(md, /* flush */ true), which installs a fresh editor state
// instead of dispatching a transaction, so the listener never sees the load.
//
// These tests assert BOTH halves: a flush load is silent, and a genuine user
// edit still fires (i.e. we did not over-suppress real changes).

import { describe, expect, it } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { replaceAll } from "@milkdown/kit/utils";
import remarkBreaks from "remark-breaks";
import { buildStringifyOptions } from "./milkdown-stringify-options";

// A list whose blank lines around a nested sub-list make CommonMark treat the
// whole list as loose — i.e. a document the serializer would reformat. If the
// load echoed through markdownUpdated, this is exactly what would get written
// back to disk.
const REFORMATTING_SRC = "- parent\n\n  - child\n\n- sibling";
const DEBOUNCE_GRACE_MS = 350; // listener debounce is 200ms

async function makeEditor(onMarkdown: (md: string) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, "");
      ctx.set(remarkPluginsCtx, [{ plugin: remarkBreaks, options: {} }]);
      ctx.set(remarkStringifyOptionsCtx, buildStringifyOptions(ctx.get(remarkStringifyOptionsCtx)));
      ctx.get(listenerCtx).markdownUpdated((_c, md) => onMarkdown(md));
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)
    .create();
  return { editor, container };
}

describe("opening a document does not register as a user edit", () => {
  it("a flush load fires no markdownUpdated even after the debounce window", async () => {
    const calls: string[] = [];
    const { editor, container } = await makeEditor((md) => calls.push(md));

    editor.action(replaceAll(REFORMATTING_SRC, true)); // flush = true, as the adapter does
    await new Promise((r) => setTimeout(r, DEBOUNCE_GRACE_MS));

    expect(calls).toEqual([]);
    editor.destroy();
    container.remove();
  });

  it("a genuine user edit still fires markdownUpdated (no over-suppression)", async () => {
    const calls: string[] = [];
    const { editor, container } = await makeEditor((md) => calls.push(md));

    editor.action(replaceAll(REFORMATTING_SRC, true));
    await new Promise((r) => setTimeout(r, DEBOUNCE_GRACE_MS));
    expect(calls).toEqual([]); // load was silent

    // Simulate the user typing: dispatch a real edit transaction.
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("x", 1));
    });
    await new Promise((r) => setTimeout(r, DEBOUNCE_GRACE_MS));

    expect(calls.length).toBe(1);
    editor.destroy();
    container.remove();
  });
});
