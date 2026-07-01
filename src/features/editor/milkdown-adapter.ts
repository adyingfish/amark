// milkdown-adapter.ts - Milkdown editor adapter
import type { EditorAdapter, EditorOptions } from "./editor-adapter";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  schemaCtx,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import { DOMSerializer, type Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import remarkBreaks from "remark-breaks";
import { buildStringifyOptions } from "./milkdown-stringify-options";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { replaceAll } from "@milkdown/kit/utils";

const TASK_CHECKBOX_HIT_WIDTH = 28;

export class MilkdownAdapter implements EditorAdapter {
  private editor: Editor | null = null;
  private container: HTMLElement | null = null;
  private changeCallback: ((markdown: string) => void) | null = null;
  private currentContent: string = "";
  // Whether the rich view accepts edits. The read-only preview (仅预览) reuses
  // this same surface with editing disabled; the editable WYSIWYG view re-enables
  // it. Tracked so the value survives content re-renders.
  private editable: boolean = true;
  // True while we are programmatically replacing the document (e.g. opening a
  // file). During this window the editor's own change listener must stay silent,
  // otherwise replaceAll() is treated as user input and triggers a cascade of
  // redundant store updates / re-renders.
  //
  // NOTE: this synchronous flag alone is NOT enough — Milkdown's listener
  // debounces markdownUpdated by ~200ms, so the echo of a programmatic load
  // fires long after setContent() returns and the flag has been reset. That
  // race is what silently marked freshly-opened files dirty (and let a
  // subsequent save rewrite them in normalized form). The real fix is using
  // replaceAll(markdown, /* flush */ true) below, which installs a fresh editor
  // state instead of dispatching a doc-change transaction, so the listener
  // never observes the load at all. The flag stays as cheap belt-and-suspenders.
  private isSettingContent: boolean = false;

  private readonly handleTaskCheckboxClick = (event: MouseEvent): void => {
    if (!this.editor || !this.editable || event.defaultPrevented || event.button !== 0) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const taskItem = target.closest('li[data-item-type="task"]');
    if (!(taskItem instanceof HTMLElement) || !this.isInsideTaskCheckboxHitArea(event, taskItem)) {
      return;
    }

    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const found = this.findTaskListItemPosition(view, taskItem);
      if (!found) return;

      event.preventDefault();
      event.stopPropagation();
      view.focus();
      view.dispatch(
        view.state.tr.setNodeMarkup(found.pos, undefined, {
          ...found.node.attrs,
          checked: !found.node.attrs.checked,
        }),
      );
    });
  };

  async mount(container: HTMLElement): Promise<void> {
    this.container = container;

    this.editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, container);
        ctx.set(defaultValueCtx, "");

        // 让单个换行(\n)也按换行显示，而非按 CommonMark 默认折叠为空格
        ctx.set(remarkPluginsCtx, [{ plugin: remarkBreaks, options: {} }]);

        // 修正 Milkdown 回写 Markdown 时对源文件的意外改写：保留 "-" 列表符号、
        // 不把裸链接包成 <...>、避免紧凑列表被序列化成松散列表。详见
        // milkdown-stringify-options.ts。必须在已注入的默认选项上合并，
        // 以保留 Milkdown 自带的 emphasis/strong 标记保留逻辑。
        ctx.set(
          remarkStringifyOptionsCtx,
          buildStringifyOptions(ctx.get(remarkStringifyOptionsCtx)),
        );

        // Set up listener for changes
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          // Ignore updates caused by our own setContent() call.
          if (this.isSettingContent) return;
          this.currentContent = markdown;
          if (this.changeCallback) {
            this.changeCallback(markdown);
          }
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .use(clipboard)
      .create();

    container.addEventListener("click", this.handleTaskCheckboxClick);
  }

  unmount(): void {
    this.container?.removeEventListener("click", this.handleTaskCheckboxClick);
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    this.container = null;
  }

  setContent(markdown: string): void {
    if (!this.editor) return;

    // Only update if content actually changed to avoid cursor jumps
    if (this.currentContent !== markdown) {
      this.currentContent = markdown;
      this.isSettingContent = true;
      try {
        // flush = true: rebuild the editor state from scratch rather than
        // dispatching a transaction, so Milkdown's debounced listener never
        // mistakes the load for a user edit (see isSettingContent note above).
        // Resetting undo history is the right behaviour when loading a document.
        this.editor.action(replaceAll(markdown, true));
      } finally {
        this.isSettingContent = false;
      }
    }
  }

  getContent(): string {
    return this.currentContent;
  }

  getHTML(): string {
    if (!this.editor) return "";

    let html = "";
    this.editor.action((ctx) => {
      const schema = ctx.get(schemaCtx);
      const view = ctx.get(editorViewCtx);
      const fragment = DOMSerializer.fromSchema(schema).serializeFragment(view.state.doc.content);
      const container = document.createElement("div");
      container.appendChild(fragment);
      html = container.innerHTML;
    });
    return html;
  }

  setEditable(editable: boolean): void {
    if (this.editable === editable) return;
    this.editable = editable;
    if (!this.editor) return;

    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // ProseMirror reads `editable` as a predicate over state; returning the
      // tracked flag flips the contenteditable surface without re-mounting.
      view.setProps({ editable: () => editable });
    });
  }

  focus(): void {
    if (!this.container) return;

    const proseMirror = this.container.querySelector(".ProseMirror");
    if (proseMirror) {
      (proseMirror as HTMLElement).focus();
    }
  }

  onChange(callback: (markdown: string) => void): void {
    this.changeCallback = callback;
  }

  private isInsideTaskCheckboxHitArea(event: MouseEvent, taskItem: HTMLElement): boolean {
    const rect = taskItem.getBoundingClientRect();
    const withinX =
      event.clientX >= rect.left && event.clientX <= rect.left + TASK_CHECKBOX_HIT_WIDTH;
    const withinY =
      rect.height === 0 || (event.clientY >= rect.top && event.clientY <= rect.bottom);
    return withinX && withinY;
  }

  private findTaskListItemPosition(
    view: EditorView,
    taskItem: HTMLElement,
  ): { pos: number; node: ProseMirrorNode } | null {
    const candidates = new Set<number>();

    try {
      candidates.add(view.posAtDOM(taskItem, 0));
      candidates.add(view.posAtDOM(taskItem, taskItem.childNodes.length));
    } catch {
      return null;
    }

    for (const pos of candidates) {
      const direct = view.state.doc.nodeAt(pos);
      if (direct?.type.name === "list_item" && direct.attrs.checked != null) {
        return { pos, node: direct };
      }

      const safePos = Math.max(0, Math.min(pos, view.state.doc.content.size));
      const resolved = view.state.doc.resolve(safePos);
      for (let depth = resolved.depth; depth > 0; depth--) {
        const node = resolved.node(depth);
        if (node.type.name === "list_item" && node.attrs.checked != null) {
          return { pos: resolved.before(depth), node };
        }
      }
    }

    return null;
  }
}

export function createMilkdownAdapter(_options: EditorOptions = {}): EditorAdapter {
  return new MilkdownAdapter();
}
