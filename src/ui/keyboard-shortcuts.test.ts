// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { runMenuAction } from "./menu-bar";
import { setupKeyboardShortcuts } from "./keyboard-shortcuts";

vi.mock("./menu-bar", () => ({ runMenuAction: vi.fn() }));

afterEach(() => {
  vi.mocked(runMenuAction).mockReset();
});

describe("search keyboard shortcuts", () => {
  it("dispatches current-document find for Ctrl+F", () => {
    const cleanup = setupKeyboardShortcuts();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
    expect(runMenuAction).toHaveBeenCalledWith("menu-find");
    cleanup();
  });

  it("dispatches workspace search for Cmd+Shift+F", () => {
    const cleanup = setupKeyboardShortcuts();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F", metaKey: true, shiftKey: true }));
    expect(runMenuAction).toHaveBeenCalledWith("menu-find-workspace");
    cleanup();
  });
});
