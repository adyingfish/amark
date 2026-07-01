// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createMilkdownAdapter } from "./milkdown-adapter";
import type { EditorAdapter } from "./editor-adapter";

const DEBOUNCE_GRACE_MS = 350;

let activeAdapter: EditorAdapter | null = null;

afterEach(() => {
  activeAdapter?.unmount();
  activeAdapter = null;
  document.body.innerHTML = "";
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  element.getBoundingClientRect = () =>
    ({
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      left: rect.left ?? 0,
      top: rect.top ?? 0,
      right: rect.right ?? 200,
      bottom: rect.bottom ?? 28,
      width: rect.width ?? 200,
      height: rect.height ?? 28,
      toJSON: () => ({}),
    }) as DOMRect;
}

async function mountAdapter(markdown: string): Promise<{
  adapter: EditorAdapter;
  container: HTMLDivElement;
  updates: string[];
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const adapter = createMilkdownAdapter();
  activeAdapter = adapter;
  const updates: string[] = [];

  await adapter.mount(container);
  adapter.onChange((nextMarkdown) => updates.push(nextMarkdown));
  adapter.setContent(markdown);

  return { adapter, container, updates };
}

describe("Milkdown task checkbox click", () => {
  it("toggles a task item when clicking its visual checkbox", async () => {
    const { adapter, container, updates } = await mountAdapter("- [ ] todo\n- [x] done");
    const taskItem = container.querySelector('li[data-item-type="task"][data-checked="false"]');
    expect(taskItem).toBeInstanceOf(HTMLElement);

    setRect(taskItem as HTMLElement, { left: 10, top: 20, right: 210, bottom: 48 });
    taskItem!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX: 16,
        clientY: 28,
      }),
    );

    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("- [x] todo\n- [x] done\n");
    expect(updates[updates.length - 1]).toBe("- [x] todo\n- [x] done\n");
  });

  it("does not toggle when clicking the task text", async () => {
    const { adapter, container, updates } = await mountAdapter("- [ ] todo");
    const taskItem = container.querySelector('li[data-item-type="task"]');
    expect(taskItem).toBeInstanceOf(HTMLElement);

    setRect(taskItem as HTMLElement, { left: 10, top: 20, right: 210, bottom: 48 });
    taskItem!.querySelector("p")!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX: 72,
        clientY: 28,
      }),
    );

    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("- [ ] todo");
    expect(updates).toEqual([]);
  });

  it("does not toggle in read-only preview mode", async () => {
    const { adapter, container, updates } = await mountAdapter("- [ ] todo");
    adapter.setEditable(false);
    const taskItem = container.querySelector('li[data-item-type="task"]');
    expect(taskItem).toBeInstanceOf(HTMLElement);

    setRect(taskItem as HTMLElement, { left: 10, top: 20, right: 210, bottom: 48 });
    taskItem!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX: 16,
        clientY: 28,
      }),
    );

    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("- [ ] todo");
    expect(updates).toEqual([]);
  });
});
