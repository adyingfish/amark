// sync-scroll.ts - Linked scrolling between the split-view panes (editor-agnostic UI layer).
//
// In 分屏 (split) mode the raw-source textarea and the rich preview scroll
// independently. Source Markdown and its rendered output rarely have matching
// heights per line, so exact position mapping isn't possible; instead this
// mirrors scroll position by percentage of the scrollable range, which keeps
// the two panes roughly aligned without touching either surface's internals.
//
// This module only touches the two scrollable DOM nodes handed to it — never
// the editor implementation — so it stays valid across an eventual Milkdown
// -> Tiptap swap.

export interface SyncScrollHandle {
  /** Snap `b` to `a`'s current scroll ratio immediately, without waiting for a scroll event. */
  sync(): void;
  destroy(): void;
}

function scrollRatio(el: HTMLElement): number {
  const range = el.scrollHeight - el.clientHeight;
  return range > 0 ? el.scrollTop / range : 0;
}

function applyScrollRatio(el: HTMLElement, ratio: number): void {
  const range = el.scrollHeight - el.clientHeight;
  if (range > 0) el.scrollTop = range * ratio;
}

/**
 * Mirror scroll position between `a` and `b` by percentage of scrollable
 * range. Returns a handle whose `destroy()` detaches both listeners.
 */
export function setupSyncScroll(a: HTMLElement, b: HTMLElement): SyncScrollHandle {
  // Guards against the mirrored scroll (applyScrollRatio) re-triggering the
  // other side's own listener and looping forever. Cleared on the next frame
  // so a genuine, separate scroll on either side is never swallowed.
  let syncing = false;

  const mirror = (source: HTMLElement, target: HTMLElement) => () => {
    if (syncing) return;
    syncing = true;
    applyScrollRatio(target, scrollRatio(source));
    requestAnimationFrame(() => {
      syncing = false;
    });
  };

  const onAScroll = mirror(a, b);
  const onBScroll = mirror(b, a);

  a.addEventListener("scroll", onAScroll, { passive: true });
  b.addEventListener("scroll", onBScroll, { passive: true });

  return {
    sync(): void {
      applyScrollRatio(b, scrollRatio(a));
    },
    destroy(): void {
      a.removeEventListener("scroll", onAScroll);
      b.removeEventListener("scroll", onBScroll);
    },
  };
}
