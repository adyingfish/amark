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

// 用户手势之后多久内的 scroll 事件仍视为该侧在主动驱动。滚动条长拖拽期间
// 每次被镜像的 scroll 都会续期，所以这里只需覆盖手势与首个事件的间隔。
const DRIVE_WINDOW_MS = 1500;

function scrollRatio(el: HTMLElement): number {
  const range = el.scrollHeight - el.clientHeight;
  return range > 0 ? el.scrollTop / range : 0;
}

function applyScrollRatio(el: HTMLElement, ratio: number): void {
  const range = el.scrollHeight - el.clientHeight;
  if (range <= 0) return;
  const target = range * ratio;
  // 亚像素死区：两个面板高度不同，比例映射往返一圈必有取整损耗，
  // 差距不足 2px 就不落笔——不写 scrollTop 就没有事件，抖动在不动点自灭。
  if (Math.abs(target - el.scrollTop) < 2) return;
  el.scrollTop = target;
}

/**
 * Mirror scroll position between `a` and `b` by percentage of scrollable
 * range. Returns a handle whose `destroy()` detaches both listeners.
 *
 * 方向锁：只有刚被用户直接操作过（滚轮 / 按键 / 在面板内按下指针）的一侧
 * 才有权驱动另一侧。程序化滚动——镜像写入本身、排版镜像重建后的位置恢复、
 * 内容替换引起的钳制——也会派发 scroll 事件，但拿不到驱动权，一律不回传。
 * 此前用「rAF 内置闸门」吞回声，在 WebKitGTK 的异步滚动下回声会迟到一帧、
 * 绕过闸门，两个面板随取整损耗互相追逐，表现为持续缓慢自动上滚；按手势
 * 授权驱动方向后，反馈回路从结构上无法成环。
 */
export function setupSyncScroll(a: HTMLElement, b: HTMLElement): SyncScrollHandle {
  let driver: HTMLElement | null = null;
  let driverUntil = 0;

  const claim = (el: HTMLElement) => (): void => {
    driver = el;
    driverUntil = performance.now() + DRIVE_WINDOW_MS;
  };

  const mirror = (source: HTMLElement, target: HTMLElement) => (): void => {
    if (driver !== source || performance.now() > driverUntil) return;
    // 拖拽滚动条期间没有新手势，靠持续的 scroll 事件本身续期驱动权。
    driverUntil = performance.now() + DRIVE_WINDOW_MS;
    applyScrollRatio(target, scrollRatio(source));
  };

  const gestures = ["wheel", "mousedown", "keydown", "touchstart"] as const;
  const claimA = claim(a);
  const claimB = claim(b);
  const onAScroll = mirror(a, b);
  const onBScroll = mirror(b, a);

  for (const type of gestures) {
    a.addEventListener(type, claimA, { passive: true });
    b.addEventListener(type, claimB, { passive: true });
  }
  a.addEventListener("scroll", onAScroll, { passive: true });
  b.addEventListener("scroll", onBScroll, { passive: true });

  return {
    sync(): void {
      applyScrollRatio(b, scrollRatio(a));
    },
    destroy(): void {
      for (const type of gestures) {
        a.removeEventListener(type, claimA);
        b.removeEventListener(type, claimB);
      }
      a.removeEventListener("scroll", onAScroll);
      b.removeEventListener("scroll", onBScroll);
    },
  };
}
