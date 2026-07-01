// split-divider.ts - Draggable split-view divider (editor-agnostic UI layer).
//
// Wires pointer dragging on the bar that sits between the two split panes. The
// left (source) pane's width is expressed as a fraction of the panes container
// and published as a CSS variable (`--split-ratio`); CSS turns that into a
// flex-basis while the right (rich) pane fills the rest. Double-clicking the
// bar restores an even split. The chosen ratio persists across sessions.
//
// This module is intentionally editor-agnostic: it only touches the panes
// container, the divider element, and one CSS variable — never the editor.

const STORAGE_KEY = "amark-split-ratio";
const DEFAULT_RATIO = 0.5;
// Keep both panes usable: neither side may collapse past this fraction.
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

export interface SplitDividerHandle {
  destroy(): void;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * Make `divider` drag-resize the split layout hosted by `panes`. Returns a
 * handle whose `destroy()` detaches every listener. The ratio is restored from
 * localStorage on setup and written back when a drag ends or a reset happens.
 */
export function setupSplitDivider(panes: HTMLElement, divider: HTMLElement): SplitDividerHandle {
  const applyRatio = (ratio: number, persist: boolean): void => {
    const clamped = clampRatio(ratio);
    panes.style.setProperty("--split-ratio", String(clamped));
    if (persist) localStorage.setItem(STORAGE_KEY, String(clamped));
  };

  // Restore the persisted split before the first paint; fall back to even.
  const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? "");
  applyRatio(saved, false);

  let dragging = false;

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    const rect = panes.getBoundingClientRect();
    if (rect.width === 0) return;
    applyRatio((event.clientX - rect.left) / rect.width, false);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    divider.releasePointerCapture?.(event.pointerId);
    divider.classList.remove("dragging");
    // Persist only the settled position, not every intermediate frame.
    applyRatio(Number.parseFloat(panes.style.getPropertyValue("--split-ratio")), true);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return; // primary button only
    dragging = true;
    divider.setPointerCapture?.(event.pointerId);
    divider.classList.add("dragging");
    // Pointer capture routes move/up back to the divider, so dragging across
    // the textarea or rich view never lets those surfaces steal the gesture.
    event.preventDefault();
  };

  const onDoubleClick = (): void => {
    applyRatio(DEFAULT_RATIO, true);
  };

  divider.addEventListener("pointerdown", onPointerDown);
  divider.addEventListener("pointermove", onPointerMove);
  divider.addEventListener("pointerup", endDrag);
  divider.addEventListener("pointercancel", endDrag);
  divider.addEventListener("dblclick", onDoubleClick);

  return {
    destroy(): void {
      divider.removeEventListener("pointerdown", onPointerDown);
      divider.removeEventListener("pointermove", onPointerMove);
      divider.removeEventListener("pointerup", endDrag);
      divider.removeEventListener("pointercancel", endDrag);
      divider.removeEventListener("dblclick", onDoubleClick);
    },
  };
}
