// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { EditorAdapter } from "./editor-adapter";
import { createMilkdownAdapter } from "./milkdown-adapter";

const DEBOUNCE_GRACE_MS = 350;

let activeAdapter: EditorAdapter | null = null;

afterEach(() => {
  activeAdapter?.unmount();
  activeAdapter = null;
  document.body.innerHTML = "";
});

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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

function openInlineFormula(container: HTMLElement): HTMLInputElement {
  const preview = container.querySelector<HTMLElement>('[data-type="math-inline"] .math-preview');
  preview?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

  const input = container.querySelector<HTMLInputElement>(
    '[data-type="math-inline"] input[data-math-input="true"]',
  );
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect(input?.closest<HTMLElement>(".math-editor-panel")?.hidden).toBe(false);
  return input!;
}

describe("Milkdown math WYSIWYG editing", () => {
  it("publishes an edited formula through the adapter change listener", async () => {
    const { adapter, container, updates } = await mountAdapter("energy: $$E=mc^2$$");
    const input = openInlineFormula(container);

    input.value = "F=ma";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("energy: $$F=ma$$\n");
    expect(updates[updates.length - 1]).toBe("energy: $$F=ma$$\n");
  });

  it("commits an active formula before switching the rich view to read-only", async () => {
    const { adapter, container, updates } = await mountAdapter("energy: $$E=mc^2$$");
    const input = openInlineFormula(container);

    input.value = "p=mv";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    adapter.setEditable(false);
    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("energy: $$p=mv$$\n");
    expect(updates[updates.length - 1]).toBe("energy: $$p=mv$$\n");
    expect(input.closest<HTMLElement>(".math-editor-panel")?.hidden).toBe(true);
  });

  it("cancels an edit with Escape", async () => {
    const { adapter, container, updates } = await mountAdapter("energy: $$E=mc^2$$");
    const input = openInlineFormula(container);

    input.value = "discarded";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("energy: $$E=mc^2$$");
    expect(updates).toEqual([]);
    expect(input.closest<HTMLElement>(".math-editor-panel")?.hidden).toBe(true);
  });
});
