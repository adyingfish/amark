// milkdown-mermaid-view.ts - Rendered NodeView for ```mermaid fenced code blocks.
//
// The code_block node's plain text stays the single source of truth, so
// Markdown parsing/serialization is untouched and fences round-trip through
// the stock commonmark schema. In WYSIWYG mode a mermaid block shows the
// rendered diagram (SVG via lib/mermaid-render.ts); clicking it opens a small
// source editor with a live draft preview, mirroring the math editing UX in
// milkdown-math-view.ts. Code blocks in any other language fall back to the
// preset's plain pre/code rendering.
//
// Diagrams render lazily: mermaid executes renders serially, so rendering
// every block eagerly makes first-open and theme-switch cost grow linearly
// with the diagram count, even for blocks far outside the viewport. A view
// renders only once it approaches the viewport (shared IntersectionObserver
// with a pre-render margin); off-screen views needing a refresh (theme
// switch, source edit) are marked stale and re-render when they become
// visible. Where IntersectionObserver is missing (e.g. jsdom), every view is
// treated as visible and renders immediately. One exception: in preview-only
// typeset mode the real editor is hidden behind a static clone
// (amark-typeset-active), so pending diagrams render eagerly — the clone
// needs their SVG and visibility gating cannot run.
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { NodeSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { $view } from "@milkdown/kit/utils";
import { scheduleMermaidRender } from "../../lib/mermaid-render";

export const MERMAID_LANGUAGE = "mermaid";
export const MERMAID_DATA_TYPE = "mermaid-block";

const MERMAID_EDIT_TITLE = "编辑 Mermaid / Edit Mermaid";
const DRAFT_RENDER_DEBOUNCE_MS = 300;

const isMermaidLanguage = (language: unknown): boolean =>
  typeof language === "string" && language.trim().toLowerCase() === MERMAID_LANGUAGE;

const errorMessageOf = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("\n")[0] || "Unknown error";
};

// Pre-render margin so a diagram is ready just before it scrolls into view.
const VISIBILITY_ROOT_MARGIN = "200px";

// One IntersectionObserver shared by all diagram views. Stored alongside the
// constructor it was built from so test doubles (vi.stubGlobal) trigger a
// rebuild instead of reusing an observer bound to a stale implementation.
const visibilityCallbacks = new Map<Element, (visible: boolean) => void>();
let visibilityObserver: IntersectionObserver | null = null;
let visibilityObserverCtor: typeof IntersectionObserver | undefined;

const observeVisibility = (
  element: Element,
  callback: (visible: boolean) => void,
): (() => void) => {
  if (typeof IntersectionObserver === "undefined") {
    callback(true);
    return () => {};
  }
  if (!visibilityObserver || visibilityObserverCtor !== IntersectionObserver) {
    visibilityObserver?.disconnect();
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibilityCallbacks.get(entry.target)?.(entry.isIntersecting);
        }
      },
      { rootMargin: VISIBILITY_ROOT_MARGIN },
    );
    visibilityObserverCtor = IntersectionObserver;
    visibilityCallbacks.forEach((_, target) => visibilityObserver?.observe(target));
  }
  visibilityCallbacks.set(element, callback);
  visibilityObserver.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    visibilityObserver?.unobserve(element);
  };
};

// Theme switches only flip a class on <body> (see themes/theme-manager.ts);
// one shared observer notifies every diagram view.
const themeSubscribers = new Set<() => void>();
let themeObserver: MutationObserver | null = null;

const subscribeToThemeChange = (callback: () => void): (() => void) => {
  themeSubscribers.add(callback);
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      themeSubscribers.forEach((notify) => notify());
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  return () => {
    themeSubscribers.delete(callback);
    if (themeSubscribers.size === 0) {
      themeObserver?.disconnect();
      themeObserver = null;
    }
  };
};

// The preview-only typeset mirror hides the real editor host
// (`amark-typeset-active` on #editor, see features/typeset/typeset-dom.ts) and
// shows a static clone. Without a layout box IntersectionObserver never
// fires, so visibility gating would leave the clone's diagrams unrendered.
// Watch the host's class list and let affected views render eagerly instead.
const layoutSubscribers = new Set<() => void>();
const observedHosts = new Set<Element>();
let layoutObserver: MutationObserver | null = null;

const subscribeToLayoutContextChange = (
  host: Element | null,
  callback: () => void,
): (() => void) => {
  layoutSubscribers.add(callback);
  layoutObserver ??= new MutationObserver(() => {
    layoutSubscribers.forEach((notify) => notify());
  });
  if (host && !observedHosts.has(host)) {
    observedHosts.add(host);
    layoutObserver.observe(host, { attributes: true, attributeFilter: ["class"] });
  }
  return () => {
    layoutSubscribers.delete(callback);
    if (layoutSubscribers.size === 0) {
      layoutObserver?.disconnect();
      layoutObserver = null;
      observedHosts.clear();
    }
  };
};

class MermaidCodeBlockView implements NodeView {
  readonly dom: HTMLElement;

  private node: ProseMirrorNode;
  private readonly preview: HTMLElement;
  private readonly editorPanel: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly draftPreview: HTMLElement;
  private editing = false;
  private previewRenderSeq = 0;
  private draftRenderSeq = 0;
  private draftTimer: number | null = null;
  private visible = false;
  // True while the preview has never rendered or was invalidated (theme
  // switch, source edit) since its last render.
  private needsRender = true;
  private readonly unobserveVisibility: () => void;
  private readonly unsubscribeTheme: () => void;
  private readonly unsubscribeLayout: () => void;

  constructor(
    initialNode: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = initialNode;

    this.dom = document.createElement("div");
    this.dom.className = "mermaid-node-view";
    this.dom.dataset.type = MERMAID_DATA_TYPE;
    this.dom.contentEditable = "false";

    this.preview = document.createElement("div");
    this.preview.className = "mermaid-preview is-pending";
    this.preview.tabIndex = 0;
    this.preview.setAttribute("role", "button");
    this.preview.setAttribute("aria-label", "Edit mermaid diagram");
    this.preview.title = MERMAID_EDIT_TITLE;

    this.editorPanel = document.createElement("div");
    this.editorPanel.className = "mermaid-editor-panel";
    this.editorPanel.hidden = true;

    this.input = document.createElement("textarea");
    this.input.className = "mermaid-source-input";
    this.input.dataset.mermaidInput = "true";
    this.input.setAttribute("aria-label", "Edit mermaid source");
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("autocomplete", "off");
    this.input.spellcheck = false;

    this.draftPreview = document.createElement("div");
    this.draftPreview.className = "mermaid-draft-preview";
    this.draftPreview.setAttribute("aria-hidden", "true");

    const hint = document.createElement("span");
    hint.className = "mermaid-editor-hint";
    hint.textContent = "Ctrl/⌘ + Enter · Esc";

    this.editorPanel.append(this.input, this.draftPreview, hint);
    this.dom.append(this.preview, this.editorPanel);

    this.preview.addEventListener("click", this.handlePreviewClick);
    this.preview.addEventListener("keydown", this.handlePreviewKeyDown);
    this.input.addEventListener("input", this.handleInput);
    this.input.addEventListener("keydown", this.handleInputKeyDown);
    this.editorPanel.addEventListener("focusout", this.handleFocusOut);

    this.unobserveVisibility = observeVisibility(this.dom, this.handleVisibilityChange);
    this.unsubscribeTheme = subscribeToThemeChange(this.handleThemeChange);
    // Note: the host is resolved through the EditorView — this.dom is not yet
    // connected to the document while the constructor runs.
    this.unsubscribeLayout = subscribeToLayoutContextChange(
      this.view.dom.closest("#editor"),
      this.handleLayoutContextChange,
    );
  }

  update = (updatedNode: ProseMirrorNode): boolean => {
    if (updatedNode.type !== this.node.type) return false;
    // Language edited away from mermaid: let ProseMirror rebuild this view
    // through the constructor, which picks the plain code-block fallback.
    if (!isMermaidLanguage(updatedNode.attrs.language)) return false;

    const changed = updatedNode.textContent !== this.node.textContent;
    this.node = updatedNode;
    if (changed && !this.editing) {
      if (this.visible) {
        this.renderPreview();
      } else {
        this.markPreviewStale();
      }
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
    this.previewRenderSeq += 1;
    this.draftRenderSeq += 1;
    if (this.draftTimer != null) {
      window.clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
    this.unobserveVisibility();
    this.unsubscribeTheme();
    this.unsubscribeLayout();
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
    if (this.draftTimer != null) window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => {
      this.draftTimer = null;
      this.renderDraft();
    }, DRAFT_RENDER_DEBOUNCE_MS);
  };

  private readonly handleInputKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.finishEditing(false, true);
      return;
    }

    const shouldCommit =
      event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing;
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
    this.input.value = this.currentSource();
    this.renderDraft();
    this.preview.hidden = true;
    this.editorPanel.hidden = false;
    this.dom.classList.add("is-editing");
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  private finishEditing(commit: boolean, focusEditor: boolean): void {
    if (!this.editing) return;

    if (commit && this.input.value !== this.currentSource()) {
      this.commitValue(this.input.value);
    }

    this.editing = false;
    this.editorPanel.hidden = true;
    this.preview.hidden = false;
    this.dom.classList.remove("is-editing");
    this.renderPreview();

    if (focusEditor) this.view.focus();
  }

  private commitValue(value: string): void {
    const pos = this.getPos();
    if (pos == null) return;

    const content = value ? this.view.state.schema.text(value) : null;
    const replacement = this.node.type.create(this.node.attrs, content, this.node.marks);
    this.view.dispatch(this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, replacement));
  }

  private currentSource(): string {
    return this.node.textContent;
  }

  private readonly handleVisibilityChange = (visible: boolean): void => {
    this.visible = visible;
    if (visible && this.needsRender && !this.editing) {
      this.renderPreview();
    }
  };

  private readonly handleThemeChange = (): void => {
    // A never-rendered preview picks up the new theme on its first render.
    if (this.needsRender) return;
    if (this.isHiddenForTypeset()) {
      // Typeset mirror mode rebuilds its clone from our DOM, so refresh right
      // away — visibility gating cannot run while the real editor is hidden.
      this.renderPreview(false);
      return;
    }
    if (this.visible) {
      // Low priority: a diagram scrolling into view may jump ahead of queued
      // theme refreshes.
      this.renderPreview(false);
      if (this.editing) this.renderDraft();
    } else {
      this.markPreviewStale();
    }
  };

  private readonly handleLayoutContextChange = (): void => {
    // The typeset mirror hides the real editor (display: none) and clones it;
    // IntersectionObserver stays silent for a hidden element, so a pending
    // diagram renders eagerly here — the clone needs its SVG.
    if (this.needsRender && !this.editing && this.isHiddenForTypeset()) {
      this.renderPreview();
    }
  };

  // True while the preview-only typeset mirror hides the real editor surface
  // (amark-typeset-active on #editor, see features/typeset/typeset-dom.ts).
  private isHiddenForTypeset(): boolean {
    return this.dom.closest(".amark-typeset-active") !== null;
  }

  private renderPreview(priority = true): void {
    this.needsRender = false;
    this.renderDiagram(this.preview, this.currentSource(), priority);
  }

  // Invalidate the preview without scheduling a re-render (the off-screen
  // path). Bumping the sequence is what actually lets the scheduler drop a
  // still-queued task for this view — otherwise it would render stale
  // source/theme anyway and waste mermaid's serial render time.
  private markPreviewStale(): void {
    this.needsRender = true;
    this.previewRenderSeq += 1;
  }

  private renderDraft(): void {
    this.renderDiagram(this.draftPreview, this.input.value, true);
  }

  private renderDiagram(target: HTMLElement, source: string, priority: boolean): void {
    const isDraft = target === this.draftPreview;
    const seq = isDraft ? ++this.draftRenderSeq : ++this.previewRenderSeq;
    const isCurrent = (): boolean =>
      isDraft ? seq === this.draftRenderSeq : seq === this.previewRenderSeq;

    target.classList.remove("is-pending");
    target.classList.add("is-loading");
    target.classList.remove("is-error");

    scheduleMermaidRender(source, { priority, cancelled: () => !isCurrent() })
      .then(({ svg, bindFunctions }) => {
        if (!isCurrent()) return;
        target.innerHTML = svg;
        target.classList.remove("is-loading");
        // Mermaid's render contract: after the SVG is in the DOM, install the
        // diagram's interactive behaviors (tooltips; click/link handlers where
        // the active securityLevel permits them). A failure here must not
        // discard the already-rendered diagram.
        try {
          bindFunctions?.(target);
        } catch (bindError) {
          console.warn("mermaid bindFunctions failed", bindError);
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        target.classList.remove("is-loading");
        target.classList.add("is-error");
        target.textContent = `Mermaid 渲染失败 / Failed to render: ${errorMessageOf(error)}`;
      });
  }
}

// Plain passthrough view for non-mermaid code blocks: same DOM shape as the
// commonmark preset's toDOM (pre[data-language] > code) with a contentDOM so
// editing behaves exactly like the stock code block.
class PlainCodeBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;

  private node: ProseMirrorNode;

  constructor(initialNode: ProseMirrorNode) {
    this.node = initialNode;
    this.dom = document.createElement("pre");
    this.contentDOM = document.createElement("code");
    this.dom.appendChild(this.contentDOM);
    this.syncLanguage(initialNode);
  }

  update = (updatedNode: ProseMirrorNode): boolean => {
    if (updatedNode.type !== this.node.type) return false;
    // Switched to mermaid: rebuild through the constructor's view dispatch.
    if (isMermaidLanguage(updatedNode.attrs.language)) return false;

    this.node = updatedNode;
    this.syncLanguage(updatedNode);
    return true;
  };

  private syncLanguage(node: ProseMirrorNode): void {
    const language = typeof node.attrs.language === "string" ? node.attrs.language : "";
    if (language) {
      this.dom.dataset.language = language;
    } else {
      delete this.dom.dataset.language;
    }
  }
}

const createCodeBlockView: NodeViewConstructor = (node, view, getPos) =>
  isMermaidLanguage(node.attrs.language)
    ? new MermaidCodeBlockView(node, view, getPos)
    : new PlainCodeBlockView(node);

export const mermaidCodeBlockView = $view(codeBlockSchema.node, () => createCodeBlockView);
