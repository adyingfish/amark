// editor-adapter.ts - Editor adapter interface

export interface EditorAdapter {
  /**
   * Initialize the editor in the given container
   */
  mount(container: HTMLElement): Promise<void>;

  /**
   * Destroy the editor instance
   */
  unmount(): void;

  /**
   * Set the markdown content
   */
  setContent(markdown: string): void;

  /**
   * Get the current markdown content
   */
  getContent(): string;

  /**
   * Get the current HTML content
   */
  getHTML(): string;

  /**
   * Focus the editor
   */
  focus(): void;

  /**
   * Toggle whether the rendered view accepts edits. Used to drive the read-only
   * preview (仅预览) while reusing the same rich surface as the editable view.
   */
  setEditable(editable: boolean): void;

  /**
   * Set up content change callback
   */
  onChange(callback: (markdown: string) => void): void;
}

/**
 * Create an editor adapter instance
 * This function will be implemented by the specific editor (Milkdown, Tiptap, etc.)
 */
export type EditorAdapterFactory = (options: EditorOptions) => EditorAdapter;

export interface EditorOptions {
  placeholder?: string;
  autofocus?: boolean;
}
