// keyboard-shortcuts.ts - Global accelerators (editor-agnostic UI layer).
//
// The native menu used to register OS accelerators; with the menu removed they
// are re-implemented here. Each shortcut dispatches the same Rust-side action
// id via `menu_action`. Edit shortcuts (undo/redo/cut/copy/paste/select-all)
// are intentionally left to the webview's built-in handling.
import { runMenuAction } from "./menu-bar";

/**
 * Install global keyboard accelerators. Returns a disposer that removes them.
 */
export function setupKeyboardShortcuts(): () => void {
  const handler = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "F11") {
      e.preventDefault();
      runMenuAction("view-fullscreen");
      return;
    }

    if (!mod) return;

    switch (e.key) {
      case "n":
      case "N":
        e.preventDefault();
        runMenuAction("new");
        break;
      case "o":
      case "O":
        e.preventDefault();
        runMenuAction(e.shiftKey ? "menu-open-folder" : "menu-open");
        break;
      case "s":
      case "S":
        e.preventDefault();
        runMenuAction(e.shiftKey ? "menu-save-as" : "menu-save");
        break;
      case "=":
      case "+":
        e.preventDefault();
        runMenuAction("view-zoom-in");
        break;
      case "-":
        e.preventDefault();
        runMenuAction("view-zoom-out");
        break;
      case "0":
        e.preventDefault();
        runMenuAction("view-zoom-reset");
        break;
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
