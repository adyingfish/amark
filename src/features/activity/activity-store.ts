// activity-store.ts - Activity/recent changes state management
import type { RecentChangedFile } from "../workspace/workspace-types";

type Listener = () => void;

class ActivityStore {
  private recentChanges: RecentChangedFile[] = [];
  private listeners: Set<Listener> = new Set();

  // ── Getters ─────────────────────────────────────────────────────────────────

  getRecentChanges(): RecentChangedFile[] {
    return this.recentChanges;
  }

  getRecentFilePaths(): string[] {
    return this.recentChanges.map((c) => c.filePath);
  }

  // ── Operations ──────────────────────────────────────────────────────────────

  addChange(filePath: string): void {
    const newEntry: RecentChangedFile = {
      filePath,
      changedAt: Date.now(),
    };
    // Remove duplicates and add to front, keep last 50
    const filtered = this.recentChanges.filter((f) => f.filePath !== filePath);
    this.recentChanges = [newEntry, ...filtered].slice(0, 50);
    this.emit();
  }

  addChanges(filePaths: string[]): void {
    const now = Date.now();
    const newEntries = filePaths.map((filePath) => ({
      filePath,
      changedAt: now,
    }));
    // Remove duplicates from existing
    const existingPaths = new Set(filePaths);
    const filtered = this.recentChanges.filter((f) => !existingPaths.has(f.filePath));
    this.recentChanges = [...newEntries, ...filtered].slice(0, 50);
    this.emit();
  }

  clearChanges(): void {
    this.recentChanges = [];
    this.emit();
  }

  removeChange(filePath: string): void {
    this.recentChanges = this.recentChanges.filter((f) => f.filePath !== filePath);
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

export const activityStore = new ActivityStore();
