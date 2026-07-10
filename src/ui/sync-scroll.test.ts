// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { setupSyncScroll } from "./sync-scroll";

/** jsdom never lays out scrollable content, so scrollHeight/clientHeight are
 * stubbed per element to simulate a pane whose content is taller than its
 * viewport. Assigning .scrollTop past the simulated range clamps like a real
 * scroll container would. */
function makeScrollable(scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  let top = 0;
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, scrollHeight - clientHeight));
    },
    configurable: true,
  });
  return el;
}

describe("setupSyncScroll", () => {
  it("mirrors user-driven scroll position by percentage in both directions", () => {
    const a = makeScrollable(2000, 1000); // range 1000
    const b = makeScrollable(3000, 1000); // range 2000
    setupSyncScroll(a, b);

    a.dispatchEvent(new Event("wheel"));
    a.scrollTop = 500; // 50% of a's range
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(1000); // 50% of b's range

    b.dispatchEvent(new Event("wheel"));
    b.scrollTop = 2000; // 100% of b's range
    b.dispatchEvent(new Event("scroll"));
    expect(a.scrollTop).toBe(1000); // 100% of a's range
  });

  it("ignores a mirrored scroll event instead of feeding it back", () => {
    const a = makeScrollable(2000, 1000);
    const b = makeScrollable(2000, 1000);
    setupSyncScroll(a, b);

    a.dispatchEvent(new Event("wheel"));
    a.scrollTop = 400;
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(400);

    // WebKitGTK may deliver this programmatic echo asynchronously. Because b
    // never claimed drive, the echo must not be mirrored back to a.
    b.dispatchEvent(new Event("scroll"));
    expect(a.scrollTop).toBe(400);
  });

  it("ignores programmatic scroll events without a preceding user gesture", () => {
    const a = makeScrollable(2000, 1000);
    const b = makeScrollable(2000, 1000);
    setupSyncScroll(a, b);

    a.scrollTop = 400;
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(0);
  });

  it("sync() snaps the target to the source's current ratio on demand", () => {
    const a = makeScrollable(1500, 1000); // range 500
    const b = makeScrollable(2500, 1000); // range 1500
    const handle = setupSyncScroll(a, b);

    a.scrollTop = 250; // 50%
    handle.sync();
    expect(b.scrollTop).toBe(750); // 50% of 1500
  });

  it("destroy() detaches both listeners", () => {
    const a = makeScrollable(2000, 1000);
    const b = makeScrollable(2000, 1000);
    const handle = setupSyncScroll(a, b);
    a.dispatchEvent(new Event("wheel"));
    handle.destroy();

    a.scrollTop = 800;
    a.dispatchEvent(new Event("scroll"));
    expect(b.scrollTop).toBe(0);
  });
});
