// tabs-store.ts - Tabs state management
import type { TabState, TabInfo } from "./tabs-types";

type Listener = () => void;

class TabsStore {
  private state: TabState = {
    openTabs: [],
    activeTabPath: null,
  };

  private listeners: Set<Listener> = new Set();

  // ── Getters ─────────────────────────────────────────────────────────────────

  getState(): TabState {
    return this.state;
  }

  getOpenTabs(): TabInfo[] {
    return this.state.openTabs;
  }

  getActiveTabPath(): string | null {
    return this.state.activeTabPath;
  }

  getActiveTab(): TabInfo | undefined {
    if (!this.state.activeTabPath) return undefined;
    return this.state.openTabs.find((t) => t.filePath === this.state.activeTabPath);
  }

  isOpen(filePath: string): boolean {
    return this.state.openTabs.some((t) => t.filePath === filePath);
  }

  getTabIndex(filePath: string): number {
    return this.state.openTabs.findIndex((t) => t.filePath === filePath);
  }

  // ── Tab operations ──────────────────────────────────────────────────────────

  openTab(filePath: string, fileName: string, isDirty: boolean = false): void {
    const existingIndex = this.getTabIndex(filePath);

    if (existingIndex >= 0) {
      // Tab already exists, just activate it
      this.activateTab(filePath);
      return;
    }

    // Add new tab and activate it
    const newTab: TabInfo = {
      filePath,
      fileName,
      isDirty,
      isActive: true,
    };

    // Deactivate current active tab
    const updatedTabs = this.state.openTabs.map((t) => ({
      ...t,
      isActive: false,
    }));

    this.state = {
      openTabs: [...updatedTabs, newTab],
      activeTabPath: filePath,
    };
    this.emit();
  }

  activateTab(filePath: string): void {
    if (!this.isOpen(filePath)) return;

    this.state = {
      openTabs: this.state.openTabs.map((t) => ({
        ...t,
        isActive: t.filePath === filePath,
      })),
      activeTabPath: filePath,
    };
    this.emit();
  }

  closeTab(filePath: string): void {
    const index = this.getTabIndex(filePath);
    if (index < 0) return;

    const wasActive = this.state.openTabs[index].isActive;
    const newTabs = this.state.openTabs.filter((t) => t.filePath !== filePath);

    let newActivePath = this.state.activeTabPath;

    if (wasActive && newTabs.length > 0) {
      // Activate the tab to the left, or the first tab if closing the first one
      const newActiveIndex = Math.max(0, index - 1);
      newActivePath = newTabs[newActiveIndex].filePath;
      newTabs[newActiveIndex] = { ...newTabs[newActiveIndex], isActive: true };
    } else if (newTabs.length === 0) {
      newActivePath = null;
    }

    this.state = {
      openTabs: newTabs,
      activeTabPath: newActivePath,
    };
    this.emit();
  }

  // Close a set of tabs in one shot, recomputing the active tab once. If the
  // active tab is among those closed, activate the nearest survivor (preferring
  // the left, matching single-tab close behaviour).
  closeTabs(filePaths: string[]): void {
    const closing = new Set(filePaths);
    if (closing.size === 0) return;

    const oldTabs = this.state.openTabs;
    const remaining = oldTabs.filter((t) => !closing.has(t.filePath));
    if (remaining.length === oldTabs.length) return;

    let newActivePath = this.state.activeTabPath;
    if (newActivePath !== null && closing.has(newActivePath)) {
      newActivePath = null;
      if (remaining.length > 0) {
        const oldIndex = oldTabs.findIndex((t) => t.filePath === this.state.activeTabPath);
        for (let i = oldIndex - 1; i >= 0; i--) {
          if (!closing.has(oldTabs[i].filePath)) {
            newActivePath = oldTabs[i].filePath;
            break;
          }
        }
        if (newActivePath === null) {
          for (let i = oldIndex + 1; i < oldTabs.length; i++) {
            if (!closing.has(oldTabs[i].filePath)) {
              newActivePath = oldTabs[i].filePath;
              break;
            }
          }
        }
      }
    }

    this.state = {
      openTabs: remaining.map((t) => ({ ...t, isActive: t.filePath === newActivePath })),
      activeTabPath: newActivePath,
    };
    this.emit();
  }

  reorderTab(fromIndex: number, toIndex: number): void {
    const tabs = this.state.openTabs;
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;

    const newTabs = [...tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);

    this.state = { ...this.state, openTabs: newTabs };
    this.emit();
  }

  updateTabDirtyState(filePath: string, isDirty: boolean): void {
    const index = this.getTabIndex(filePath);
    if (index < 0) return;
    if (this.state.openTabs[index].isDirty === isDirty) return;

    const newTabs = [...this.state.openTabs];
    newTabs[index] = { ...newTabs[index], isDirty };

    this.state = { ...this.state, openTabs: newTabs };
    this.emit();
  }

  closeAllTabs(): void {
    this.state = { openTabs: [], activeTabPath: null };
    this.emit();
  }

  // Move an open tab to a new path/name in place (e.g. after a file rename),
  // preserving its position, dirty state and whether it was the active tab.
  renameTab(oldPath: string, newPath: string, newName: string): void {
    const index = this.getTabIndex(oldPath);
    if (index < 0) return;

    const newTabs = [...this.state.openTabs];
    newTabs[index] = { ...newTabs[index], filePath: newPath, fileName: newName };

    this.state = {
      openTabs: newTabs,
      activeTabPath: this.state.activeTabPath === oldPath ? newPath : this.state.activeTabPath,
    };
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

export const tabsStore = new TabsStore();
