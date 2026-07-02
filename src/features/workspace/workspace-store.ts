// workspace-store.ts - Workspace state management
import type { WorkspaceState, WorkspaceFileNode } from "./workspace-types";

type Listener = () => void;

class WorkspaceStore {
  private state: WorkspaceState = {
    rootPath: null,
    name: null,
    files: [],
    activeFilePath: null,
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
      activeFilePath: null,
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
