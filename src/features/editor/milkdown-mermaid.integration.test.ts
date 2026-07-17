// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import type { EditorAdapter } from "./editor-adapter";
import { createMilkdownAdapter } from "./milkdown-adapter";

const bindFunctionsMock = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => {
      if (source.includes("broken")) {
        throw new Error("Parse error on line 1");
      }
      return { svg: '<svg data-mermaid-mock="true"></svg>', bindFunctions: bindFunctionsMock };
    }),
  },
}));

const DEBOUNCE_GRACE_MS = 350;

let activeAdapter: EditorAdapter | null = null;

afterEach(() => {
  activeAdapter?.unmount();
  activeAdapter = null;
  document.body.innerHTML = "";
  document.body.className = "";
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

async function waitForDiagram(container: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    expect(
      container.querySelector(
        '[data-type="mermaid-block"] .mermaid-preview svg[data-mermaid-mock]',
      ),
    ).not.toBeNull();
  });
}

function openMermaidEditor(container: HTMLElement): HTMLTextAreaElement {
  const preview = container.querySelector<HTMLElement>(
    '[data-type="mermaid-block"] .mermaid-preview',
  );
  preview?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

  const input = container.querySelector<HTMLTextAreaElement>(
    '[data-type="mermaid-block"] textarea[data-mermaid-input="true"]',
  );
  expect(input).toBeInstanceOf(HTMLTextAreaElement);
  expect(input?.closest<HTMLElement>(".mermaid-editor-panel")?.hidden).toBe(false);
  return input!;
}

describe("Milkdown mermaid code blocks", () => {
  it("renders a mermaid fence as a diagram and keeps the markdown source intact", async () => {
    const markdown = "```mermaid\ngraph TD;\n  A-->B;\n```";
    const { adapter, container } = await mountAdapter(markdown);
    await waitForDiagram(container);

    expect(adapter.getContent()).toBe(markdown);
    // Mermaid's render contract: bindFunctions runs against the element that
    // holds the inserted SVG, installing tooltips/link behaviors.
    const preview = container.querySelector('[data-type="mermaid-block"] .mermaid-preview');
    expect(bindFunctionsMock).toHaveBeenCalledWith(preview);
  });

  it("publishes an edited diagram through the adapter change listener", async () => {
    const { adapter, container, updates } = await mountAdapter(
      "```mermaid\ngraph TD;\n  A-->B;\n```",
    );
    await waitForDiagram(container);
    const input = openMermaidEditor(container);

    input.value = "graph LR;\n  C-->D;";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter", ctrlKey: true }),
    );
    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("```mermaid\ngraph LR;\n  C-->D;\n```\n");
    expect(updates[updates.length - 1]).toBe("```mermaid\ngraph LR;\n  C-->D;\n```\n");
    expect(input.closest<HTMLElement>(".mermaid-editor-panel")?.hidden).toBe(true);
  });

  it("commits an active diagram edit before switching the rich view to read-only", async () => {
    const { adapter, container, updates } = await mountAdapter("```mermaid\ngraph TD;\n```");
    await waitForDiagram(container);
    const input = openMermaidEditor(container);

    input.value = "graph LR;\n  E-->F;";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    adapter.setEditable(false);
    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("```mermaid\ngraph LR;\n  E-->F;\n```\n");
    expect(updates[updates.length - 1]).toBe("```mermaid\ngraph LR;\n  E-->F;\n```\n");
    expect(input.closest<HTMLElement>(".mermaid-editor-panel")?.hidden).toBe(true);
    expect(
      container.querySelector<HTMLElement>('[data-type="mermaid-block"] .mermaid-preview')
        ?.tabIndex,
    ).toBe(-1);
  });

  it("cancels an edit with Escape", async () => {
    const { adapter, container, updates } = await mountAdapter("```mermaid\ngraph TD;\n```");
    await waitForDiagram(container);
    const input = openMermaidEditor(container);

    input.value = "discarded";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await wait(DEBOUNCE_GRACE_MS);

    expect(adapter.getContent()).toBe("```mermaid\ngraph TD;\n```");
    expect(updates).toEqual([]);
    expect(input.closest<HTMLElement>(".mermaid-editor-panel")?.hidden).toBe(true);
  });

  it("shows an error state instead of a diagram for invalid mermaid source", async () => {
    const { container } = await mountAdapter("```mermaid\nbroken\n```");

    await vi.waitFor(() => {
      const preview = container.querySelector<HTMLElement>(
        '[data-type="mermaid-block"] .mermaid-preview',
      );
      expect(preview?.classList.contains("is-error")).toBe(true);
      expect(preview?.textContent).toContain("Mermaid");
    });
  });

  it("keeps non-mermaid code blocks as plain pre/code", async () => {
    const { container } = await mountAdapter("```python\nprint(1)\n```");

    const code = container.querySelector('pre[data-language="python"] > code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("print(1)");
    expect(container.querySelector('[data-type="mermaid-block"]')).toBeNull();
  });

  it("re-renders diagrams when the app theme changes", async () => {
    const { container } = await mountAdapter("```mermaid\ngraph TD;\n```");
    await waitForDiagram(container);

    const renderMock = vi.mocked(mermaid.render);
    renderMock.mockClear();
    document.body.classList.add("theme-dark");

    await vi.waitFor(() => {
      expect(renderMock).toHaveBeenCalled();
    });
  });
});
