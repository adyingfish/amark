// workspace-store.ts - Workspace state management
import type { WorkspaceState, WorkspaceFileNode, RecentChangedFile } from "./workspace-types";

type Listener = () => void;

class WorkspaceStore {
  private state: WorkspaceState = {
    rootPath: null,
    name: null,
    files: [],
    openTabs: [],
    activeFilePath: null,
    recentChangedFiles: [],
    lastOpenedAt: null,
  };

  private listeners: Set<Listener> = new Set();

  // ── Getters ─────────────────────────────────────────────────────────────────

  getState(): WorkspaceState {
    return this.state;
  }

  getRootPath(): string | null {
    return this.state.rootPath;
  }

  getName(): string | null {
    return this.state.name;
  }

  getFiles(): WorkspaceFileNode[] {
    return this.state.files;
  }

  getActiveFilePath(): string | null {
    return this.state.activeFilePath;
  }

  getRecentChangedFiles(): RecentChangedFile[] {
    return this.state.recentChangedFiles;
  }

  isWorkspaceOpen(): boolean {
    return this.state.rootPath !== null;
  }

  // ── Setters ─────────────────────────────────────────────────────────────────

  setWorkspace(rootPath: string, name: string, files: WorkspaceFileNode[]): void {
    this.state = {
      ...this.state,
      rootPath,
      name,
      files,
      lastOpenedAt: Date.now(),
    };
    this.emit();
  }

  clearWorkspace(): void {
    this.state = {
      rootPath: null,
      name: null,
      files: [],
      openTabs: [],
      activeFilePath: null,
      recentChangedFiles: [],
      lastOpenedAt: null,
    };
    this.emit();
  }

  setFiles(files: WorkspaceFileNode[]): void {
    this.state = { ...this.state, files };
    this.emit();
  }

  setActiveFilePath(filePath: string | null): void {
    this.state = { ...this.state, activeFilePath: filePath };
    this.emit();
  }

  addRecentChangedFile(filePath: string): void {
    const newEntry: RecentChangedFile = {
      filePath,
      changedAt: Date.now(),
    };
    // Remove duplicates and add to front, keep last 20
    const filtered = this.state.recentChangedFiles.filter((f) => f.filePath !== filePath);
    this.state = {
      ...this.state,
      recentChangedFiles: [newEntry, ...filtered].slice(0, 20),
    };
    this.emit();
  }

  clearRecentChangedFiles(): void {
    this.state = { ...this.state, recentChangedFiles: [] };
    this.emit();
  }

  setRecentChangedFiles(recentChangedFiles: RecentChangedFile[]): void {
    this.state = { ...this.state, recentChangedFiles };
    this.emit();
  }

  // ── Tab integration (sync with tabs store) ─────────────────────────────────

  setOpenTabs(openTabs: string[]): void {
    this.state = { ...this.state, openTabs };
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

export const workspaceStore = new WorkspaceStore();
