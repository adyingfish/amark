// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupWindowClose } from "./window-close";
import { saveDocument, updateDocumentContent } from "../features/document/document-controller";
import { documentStore } from "../features/document/document-store";

function nativeClose(
  confirm: () => Promise<boolean>,
  invoke = vi.fn().mockResolvedValue({ ok: true }),
) {
  const on = vi.fn();
  vi.stubGlobal("amark", { on, invoke });
  setupWindowClose(confirm);
  expect(on.mock.calls[0][0]).toBe("window-close-requested");
  return { close: on.mock.calls[0][1] as () => Promise<void>, invoke };
}

afterEach(() => {
  vi.unstubAllGlobals();
  documentStore.clearAll();
});

describe("native window close", () => {
  it("acknowledges once even when a second close arrives while confirming", async () => {
    let finish!: (answer: boolean) => void;
    const confirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { close, invoke } = nativeClose(confirm);
    const pending = close();
    await close();
    expect(invoke).not.toHaveBeenCalled();
    finish(true);
    await pending;
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls).toEqual([["window_destroy"]]);
  });

  it("keeps an untitled document open when its save dialog is cancelled", async () => {
    const path = "untitled://Untitled.md";
    documentStore.createUntitledDocument(path);
    const { close, invoke } = nativeClose(
      async () => (await saveDocument(path)) !== null,
      vi.fn().mockResolvedValue({ ok: true, value: null }),
    );
    await close();
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "dialog_save_file",
      "window_cancel_close",
    ]);
    expect(documentStore.isDirty(path)).toBe(true);
  });

  it("preserves text typed while Electron is writing the previous revision", async () => {
    const path = "/workspace/sample.md";
    documentStore.loadDocument(path, "original");
    updateDocumentContent(path, "first revision");
    const { close, invoke } = nativeClose(
      async () => (await saveDocument(path)) !== null,
      vi.fn().mockImplementation(async (name) => {
        if (name === "save_file_v2") updateDocumentContent(path, "newer revision");
        return { ok: true, value: true };
      }),
    );
    await close();
    expect(invoke.mock.calls).toEqual([
      ["save_file_v2", { path, content: "first revision" }],
      ["window_cancel_close"],
    ]);
    expect(documentStore.getDocument(path)).toMatchObject({
      markdown: "newer revision",
      lastSavedMarkdown: "first revision",
      saveStatus: "dirty",
    });
  });
});
