// menu-bar.ts - Dispatches menu actions to Rust (editor-agnostic UI layer).
//
// The menu bar UI itself now lives in App.tsx as a React component; this just
// fires the same Rust-side `menu_action` command the former native menu used,
// so keyboard shortcuts and the React menu bar share one action-dispatch path.
import { invoke } from "@tauri-apps/api/core";

/** Fire a Rust-side menu action by id (mirrors the former native menu events). */
export function runMenuAction(id: string): void {
  void invoke("menu_action", { id });
}
