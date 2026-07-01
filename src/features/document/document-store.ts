// document-store.ts - Document state management
import type { DocumentRecord } from "./document-types";

type Listener = () => void;

class DocumentStore {
  private documents: Map<string, DocumentRecord> = new Map();
  private listeners: Set<Listener> = new Set();

  // ── Getters ─────────────────────────────────────────────────────────────────

  getDocument(filePath: string): DocumentRecord | undefined {
    return this.documents.get(filePath);
  }

  getAllDocuments(): DocumentRecord[] {
    return Array.from(this.documents.values());
  }

  hasDocument(filePath: string): boolean {
    return this.documents.has(filePath);
  }

  getMarkdown(filePath: string): string | undefined {
    return this.documents.get(filePath)?.markdown;
  }

  isDirty(filePath: string): boolean {
    const doc = this.documents.get(filePath);
    if (!doc) return false;
    // A never-saved buffer always counts as having unsaved changes.
    if (doc.isUntitled) return true;
    return doc.markdown !== doc.lastSavedMarkdown;
  }

  // ── Document lifecycle ──────────────────────────────────────────────────────

  createDocument(filePath: string, content: string = ""): DocumentRecord {
    const fileName = filePath.split(/[/\\]/).pop() || "untitled";
    const record: DocumentRecord = {
      filePath,
      fileName,
      markdown: content,
      lastSavedMarkdown: content,
      saveStatus: "saved",
      lastExternalUpdateAt: null,
      hasPendingExternalUpdate: false,
      isDeleted: false,
      isLoaded: true,
      isUntitled: false,
    };
    this.documents.set(filePath, record);
    this.emit();
    return record;
  }

  /**
   * Create a blank, never-saved buffer under a synthetic `untitled://` path.
   * It reads as having unsaved changes until promoted to a real file via
   * {@link adoptPath} (i.e. saved through a Save-As dialog).
   */
  createUntitledDocument(filePath: string): DocumentRecord {
    const fileName = filePath.split(/[/\\]/).pop() || "Untitled.md";
    const record: DocumentRecord = {
      filePath,
      fileName,
      markdown: "",
      lastSavedMarkdown: "",
      saveStatus: "dirty",
      lastExternalUpdateAt: null,
      hasPendingExternalUpdate: false,
      isDeleted: false,
      isLoaded: true,
      isUntitled: true,
    };
    this.documents.set(filePath, record);
    this.emit();
    return record;
  }

  loadDocument(filePath: string, content: string): DocumentRecord {
    const existing = this.documents.get(filePath);
    if (existing) {
      // Update existing document
      const updated: DocumentRecord = {
        ...existing,
        markdown: content,
        lastSavedMarkdown: content,
        saveStatus: "saved",
        hasPendingExternalUpdate: false,
        isDeleted: false,
        isLoaded: true,
      };
      this.documents.set(filePath, updated);
    } else {
      // Create new document (emit once below, not twice)
      const fileName = filePath.split(/[/\\]/).pop() || "untitled";
      this.documents.set(filePath, {
        filePath,
        fileName,
        markdown: content,
        lastSavedMarkdown: content,
        saveStatus: "saved",
        lastExternalUpdateAt: null,
        hasPendingExternalUpdate: false,
        isDeleted: false,
        isLoaded: true,
        isUntitled: false,
      });
    }
    this.emit();
    return this.documents.get(filePath)!;
  }

  unloadDocument(filePath: string): void {
    this.documents.delete(filePath);
    this.emit();
  }

  // ── Content updates ─────────────────────────────────────────────────────────

  updateContent(filePath: string, markdown: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;

    const isDirty = markdown !== doc.lastSavedMarkdown;
    const updated: DocumentRecord = {
      ...doc,
      markdown,
      saveStatus: isDirty ? "dirty" : "saved",
    };
    this.documents.set(filePath, updated);
    this.emit();
  }

  markSaving(filePath: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;
    this.documents.set(filePath, { ...doc, saveStatus: "saving" });
    this.emit();
  }

  markSaved(filePath: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;
    this.documents.set(filePath, {
      ...doc,
      lastSavedMarkdown: doc.markdown,
      saveStatus: "saved",
      hasPendingExternalUpdate: false,
      isDeleted: false,
    });
    this.emit();
  }

  markError(filePath: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;
    this.documents.set(filePath, { ...doc, saveStatus: "error" });
    this.emit();
  }

  markExternalUpdate(filePath: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;
    this.documents.set(filePath, {
      ...doc,
      lastExternalUpdateAt: Date.now(),
      hasPendingExternalUpdate: true,
    });
    this.emit();
  }

  applyExternalContent(filePath: string, content: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;

    this.documents.set(filePath, {
      ...doc,
      markdown: content,
      lastSavedMarkdown: content,
      saveStatus: "saved",
      lastExternalUpdateAt: Date.now(),
      hasPendingExternalUpdate: false,
      isDeleted: false,
      isLoaded: true,
    });
    this.emit();
  }

  clearExternalUpdate(filePath: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;

    this.documents.set(filePath, {
      ...doc,
      hasPendingExternalUpdate: false,
      isDeleted: false,
    });
    this.emit();
  }

  markDeleted(filePath: string): void {
    const doc = this.documents.get(filePath);
    if (!doc) return;

    this.documents.set(filePath, {
      ...doc,
      saveStatus: "error",
      lastExternalUpdateAt: Date.now(),
      hasPendingExternalUpdate: true,
      isDeleted: true,
    });
    this.emit();
  }

  // Re-key a loaded document under a new path (e.g. after a file rename),
  // preserving its content and dirty state.
  renamePath(oldPath: string, newPath: string): void {
    const doc = this.documents.get(oldPath);
    if (!doc) return;

    const fileName = newPath.split(/[/\\]/).pop() || doc.fileName;
    this.documents.delete(oldPath);
    this.documents.set(newPath, { ...doc, filePath: newPath, fileName });
    this.emit();
  }

  /**
   * Re-key a document to `newPath` and mark it as freshly saved there. Used by
   * Save-As (and an untitled buffer's first save), where the current in-memory
   * content has just been written to `newPath` on disk.
   */
  adoptPath(oldPath: string, newPath: string): void {
    const doc = this.documents.get(oldPath);
    if (!doc) return;

    const fileName = newPath.split(/[/\\]/).pop() || doc.fileName;
    this.documents.delete(oldPath);
    this.documents.set(newPath, {
      ...doc,
      filePath: newPath,
      fileName,
      lastSavedMarkdown: doc.markdown,
      saveStatus: "saved",
      hasPendingExternalUpdate: false,
      isDeleted: false,
      isUntitled: false,
    });
    this.emit();
  }

  // ── Bulk operations ─────────────────────────────────────────────────────────

  clearAll(): void {
    this.documents.clear();
    this.emit();
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const documentStore = new DocumentStore();
