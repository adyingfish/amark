// milkdown-math-view.ts - Editable NodeViews for KaTeX-backed math nodes.
//
// The schema nodes stay atomic so cursor movement and Markdown serialization
// remain predictable. In WYSIWYG mode, clicking the rendered formula opens a
// small LaTeX editor inside the NodeView with a live KaTeX preview.
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { NodeSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";
import katex from "katex";
import {
  mathBlockSchema,
  mathInlineSchema,
  MATH_BLOCK_DATA_TYPE,
  MATH_INLINE_DATA_TYPE,
} from "./milkdown-math-node";

type MathKind = "inline" | "block";

const KATEX_OPTIONS = { throwOnError: false } as const;

const renderMath = (target: HTMLElement, code: string, displayMode: boolean): void => {
  katex.render(code, target, { ...KATEX_OPTIONS, displayMode });
};

class MathNodeView implements NodeView {
  readonly dom: HTMLElement;

  private node: ProseMirrorNode;
  private readonly preview: HTMLElement;
  private readonly editorPanel: HTMLElement;
  private readonly input: HTMLInputElement | HTMLTextAreaElement;
  private readonly draftPreview: HTMLElement;
  private editing = false;

  constructor(
    initialNode: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly kind: MathKind,
  ) {
    this.node = initialNode;
    const isBlock = kind === "block";

    this.dom = document.createElement(isBlock ? "div" : "span");
    this.dom.className = `math-node-view math-node-view-${kind}`;
    this.dom.dataset.type = isBlock ? MATH_BLOCK_DATA_TYPE : MATH_INLINE_DATA_TYPE;
    this.dom.contentEditable = "false";

    this.preview = document.createElement(isBlock ? "div" : "span");
    this.preview.className = "math-preview";
    this.preview.tabIndex = 0;
    this.preview.setAttribute("role", "button");
    this.preview.setAttribute("aria-label", "Edit LaTeX formula");
    this.preview.title = "编辑 LaTeX / Edit LaTeX";

    this.editorPanel = document.createElement(isBlock ? "div" : "span");
    this.editorPanel.className = "math-editor-panel";
    this.editorPanel.hidden = true;

    this.input = document.createElement(isBlock ? "textarea" : "input");
    this.input.className = "math-source-input";
    this.input.dataset.mathInput = "true";
    this.input.setAttribute("aria-label", isBlock ? "Edit block LaTeX" : "Edit inline LaTeX");
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("autocomplete", "off");
    this.input.spellcheck = false;
    if (this.input instanceof HTMLInputElement) this.input.type = "text";

    this.draftPreview = document.createElement(isBlock ? "div" : "span");
    this.draftPreview.className = "math-draft-preview";
    this.draftPreview.setAttribute("aria-hidden", "true");

    const hint = document.createElement("span");
    hint.className = "math-editor-hint";
    hint.textContent = isBlock ? "Ctrl/⌘ + Enter · Esc" : "Enter · Esc";

    this.editorPanel.append(this.input, this.draftPreview, hint);
    this.dom.append(this.preview, this.editorPanel);
    this.bindNode(initialNode);

    this.preview.addEventListener("click", this.handlePreviewClick);
    this.preview.addEventListener("keydown", this.handlePreviewKeyDown);
    this.input.addEventListener("input", this.handleInput);
    this.input.addEventListener("keydown", this.handleInputKeyDown);
    this.editorPanel.addEventListener("focusout", this.handleFocusOut);
  }

  update = (updatedNode: ProseMirrorNode): boolean => {
    if (updatedNode.type !== this.node.type) return false;

    this.node = updatedNode;
    this.bindDataAttributes(updatedNode);
    if (!this.editing) {
      renderMath(this.preview, this.valueOf(updatedNode), this.isDisplayMode(updatedNode));
    }
    return true;
  };

  selectNode = (): void => {
    this.dom.classList.add("ProseMirror-selectednode");
  };

  deselectNode = (): void => {
    this.dom.classList.remove("ProseMirror-selectednode");
  };

  stopEvent = (event: Event): boolean => {
    const target = event.target;
    if (!(target instanceof globalThis.Node)) return false;
    if (this.editorPanel.contains(target)) return true;
    return (
      this.view.editable &&
      this.preview.contains(target) &&
      (event.type === "click" || event.type === "keydown")
    );
  };

  ignoreMutation = (): boolean => true;

  destroy = (): void => {
    this.preview.removeEventListener("click", this.handlePreviewClick);
    this.preview.removeEventListener("keydown", this.handlePreviewKeyDown);
    this.input.removeEventListener("input", this.handleInput);
    this.input.removeEventListener("keydown", this.handleInputKeyDown);
    this.editorPanel.removeEventListener("focusout", this.handleFocusOut);
  };

  private readonly handlePreviewClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.startEditing();
  };

  private readonly handlePreviewKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key !== "Enter" && event.key !== "F2") return;
    event.preventDefault();
    this.startEditing();
  };

  private readonly handleInput = (): void => {
    renderMath(this.draftPreview, this.input.value, this.isDisplayMode(this.node));
  };

  private readonly handleInputKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.finishEditing(false, true);
      return;
    }

    const shouldCommit =
      event.key === "Enter" &&
      (this.kind === "inline" || event.ctrlKey || event.metaKey) &&
      !event.isComposing;
    if (!shouldCommit) return;

    event.preventDefault();
    this.finishEditing(true, true);
  };

  private readonly handleFocusOut = (): void => {
    queueMicrotask(() => {
      if (this.editing && !this.editorPanel.contains(document.activeElement)) {
        this.finishEditing(true, false);
      }
    });
  };

  private startEditing(): void {
    if (this.editing || !this.view.editable) return;

    const pos = this.getPos();
    if (pos != null) {
      this.view.dispatch(
        this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)),
      );
    }

    this.editing = true;
    this.input.value = this.valueOf(this.node);
    renderMath(this.draftPreview, this.input.value, this.isDisplayMode(this.node));
    this.preview.hidden = true;
    this.editorPanel.hidden = false;
    this.dom.classList.add("is-editing");
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  private finishEditing(commit: boolean, focusEditor: boolean): void {
    if (!this.editing) return;

    if (commit && this.input.value !== this.valueOf(this.node)) {
      this.commitValue(this.input.value);
    }

    this.editing = false;
    this.editorPanel.hidden = true;
    this.preview.hidden = false;
    this.dom.classList.remove("is-editing");
    renderMath(this.preview, this.valueOf(this.node), this.isDisplayMode(this.node));

    if (focusEditor) this.view.focus();
  }

  private commitValue(value: string): void {
    const pos = this.getPos();
    if (pos == null) return;

    if (this.kind === "block") {
      const attrs = { ...this.node.attrs, value };
      this.node = this.node.type.create(attrs, this.node.content, this.node.marks);
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, attrs));
      return;
    }

    const content = value ? this.view.state.schema.text(value) : null;
    const replacement = this.node.type.create(this.node.attrs, content, this.node.marks);
    const previousNodeSize = this.node.nodeSize;
    this.node = replacement;
    this.view.dispatch(this.view.state.tr.replaceWith(pos, pos + previousNodeSize, replacement));
  }

  private bindNode(node: ProseMirrorNode): void {
    this.bindDataAttributes(node);
    renderMath(this.preview, this.valueOf(node), this.isDisplayMode(node));
  }

  private bindDataAttributes(node: ProseMirrorNode): void {
    this.dom.dataset.value = this.valueOf(node);
    if (this.kind === "inline" && this.isDisplayMode(node)) {
      this.dom.dataset.display = "true";
    } else {
      delete this.dom.dataset.display;
    }
    if (this.kind === "block" && node.attrs.meta) {
      this.dom.dataset.meta = node.attrs.meta as string;
    } else {
      delete this.dom.dataset.meta;
    }
  }

  private valueOf(node: ProseMirrorNode): string {
    return this.kind === "block" ? (node.attrs.value as string) : node.textContent;
  }

  private isDisplayMode(node: ProseMirrorNode): boolean {
    return this.kind === "block" || Boolean(node.attrs.display);
  }
}

const createMathView = (kind: MathKind): NodeViewConstructor => {
  return (node, view, getPos) => new MathNodeView(node, view, getPos, kind);
};

export const mathInlineView = $view(mathInlineSchema.node, () => createMathView("inline"));
export const mathBlockView = $view(mathBlockSchema.node, () => createMathView("block"));
