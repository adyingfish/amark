import { invoke } from "@/services/desktop";

/** Dispatch a menu or keyboard action to the current window. */
export function runMenuAction(id: string): void {
  // Chromium's native page zoom is shared across windows with the same origin.
  const style = document.documentElement.style;
  if (id === "view-zoom-reset") {
    style.zoom = "1";
    return;
  }
  if (id === "view-zoom-in" || id === "view-zoom-out") {
    const next = Number.parseFloat(style.zoom || "1") + (id === "view-zoom-in" ? 0.1 : -0.1);
    style.zoom = Math.max(0.5, next).toFixed(1);
    return;
  }
  void invoke("menu_action", { id });
}
