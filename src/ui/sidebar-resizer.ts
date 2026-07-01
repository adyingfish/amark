// sidebar-resizer.ts - Draggable sidebar-width handle (editor-agnostic UI layer).
//
// Wires pointer dragging on the bar that sits between the sidebar and the editor
// area. The sidebar width is published as a CSS variable (`--sidebar-width`) in
// pixels; CSS turns that into the sidebar's width. Double-clicking the bar
// restores the default width. The chosen width persists across sessions and is
// clamped to a usable range so the sidebar can neither vanish nor dominate.
//
// This module is intentionally editor-agnostic: it only touches the sidebar
// element, the resizer element, and one CSS variable — never the editor.

const STORAGE_KEY = "amark-sidebar-width";
const DEFAULT_WIDTH = 240;
// Keep the sidebar usable: it may neither collapse to nothing nor crowd out the
// editor. These bounds mirror the min/max-width declared in workspace.css.
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export interface SidebarResizerHandle {
  destroy(): void;
}

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

/**
 * Make `resizer` drag-resize `sidebar`. Returns a handle whose `destroy()`
 * detaches every listener. The width is restored from localStorage on setup and
 * written back when a drag ends or a reset happens.
 */
export function setupSidebarResizer(
  sidebar: HTMLElement,
  resizer: HTMLElement,
): SidebarResizerHandle {
  const applyWidth = (width: number, persist: boolean): void => {
    const clamped = clampWidth(width);
    sidebar.style.setProperty("--sidebar-width", `${clamped}px`);
    if (persist) localStorage.setItem(STORAGE_KEY, String(clamped));
  };

  // Restore the persisted width before the first paint; fall back to default.
  const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? "");
  applyWidth(saved, false);

  let dragging = false;

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const rect = sidebar.getBoundingClientRect();
    applyWidth(event.clientX - rect.left, false);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    resizer.releasePointerCapture?.(event.pointerId);
    resizer.classList.remove("dragging");
    // Re-enable the toggle (collapse/expand) width transition after the drag.
    sidebar.classList.remove("resizing");
    // Persist only the settled position, not every intermediate frame.
    applyWidth(Number.parseFloat(sidebar.style.getPropertyValue("--sidebar-width")), true);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return; // primary button only
    dragging = true;
    resizer.setPointerCapture?.(event.pointerId);
    resizer.classList.add("dragging");
    // Suppress the width transition so the sidebar tracks the pointer 1:1.
    sidebar.classList.add("resizing");
    // Pointer capture routes move/up back to the resizer, so dragging across
    // the editor surface never lets it steal the gesture.
    event.preventDefault();
  };

  const onDoubleClick = (): void => {
    applyWidth(DEFAULT_WIDTH, true);
  };

  resizer.addEventListener("pointerdown", onPointerDown);
  resizer.addEventListener("pointermove", onPointerMove);
  resizer.addEventListener("pointerup", endDrag);
  resizer.addEventListener("pointercancel", endDrag);
  resizer.addEventListener("dblclick", onDoubleClick);

  return {
    destroy(): void {
      resizer.removeEventListener("pointerdown", onPointerDown);
      resizer.removeEventListener("pointermove", onPointerMove);
      resizer.removeEventListener("pointerup", endDrag);
      resizer.removeEventListener("pointercancel", endDrag);
      resizer.removeEventListener("dblclick", onDoubleClick);
    },
  };
}
