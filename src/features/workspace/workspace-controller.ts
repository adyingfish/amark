// workspace-controller.ts - Workspace business logic
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { workspaceStore } from "./workspace-store";
import { documentStore } from "../document/document-store";
import { tabsStore } from "../tabs/tabs-store";
import { activityStore } from "../activity/activity-store";
import { findFileNode, flattenFileTree, rewriteDescendantPath } from "./workspace-utils";
import { getShowHiddenFiles, setShowHiddenFiles } from "./workspace-preferences";
import type { OpenWorkspaceResult, WorkspaceScanResult } from "./workspace-types";

// ── Open workspace ───────────────────────────────────────────────────────────

export async function openWorkspaceFolder(): Promise<boolean> {
  try {
    const result = await invoke<OpenWorkspaceResult>("open_workspace_folder");

    if (!result.success || !result.root_path) {
      // A backend error here (e.g. a path that failed to scan) was previously
      // swallowed silently; surface it so failures are diagnosable.
      if (result.error) {
        console.error("Open workspace failed:", result.error);
      }
      return false;
    }

    return await openWorkspaceByPath(result.root_path);
  } catch (error) {
    console.error("Failed to open workspace:", error);
    return false;
  }
}

/**
 * Open a known folder as the workspace without going through the picker dialog.
 * Used when the folder is already determined — e.g. the directory of a file the
 * app was launched with (file association / "Open with…"). Mirrors
 * openWorkspaceFolder's reset-and-scan, so callers that open a file afterwards
 * must do so after this resolves (it clears tabs/documents).
 */
export async function openWorkspaceByPath(rootPath: string): Promise<boolean> {
  try {
    // Scan the workspace
    const scanResult = await invoke<WorkspaceScanResult>("scan_workspace", {
      rootPath,
      showHidden: getShowHiddenFiles(),
    });

    // Update workspace store
    workspaceStore.setWorkspace(scanResult.root_path, scanResult.name, scanResult.files);

    // Clear previous state
    documentStore.clearAll();
    tabsStore.closeAllTabs();
    activityStore.clearChanges();

    // Start watching the workspace (use the canonical path the scan returned)
    await invoke("start_watch_workspace", {
      rootPath: scanResult.root_path,
      showHidden: getShowHiddenFiles(),
    });

    return true;
  } catch (error) {
    console.error("Failed to open workspace by path:", error);
    return false;
  }
}

export async function refreshWorkspace(): Promise<boolean> {
  const rootPath = workspaceStore.getRootPath();
  if (!rootPath) return false;

  try {
    const scanResult = await invoke<WorkspaceScanResult>("scan_workspace", {
      rootPath,
      showHidden: getShowHiddenFiles(),
    });

    workspaceStore.setFiles(scanResult.files);
    return true;
  } catch (error) {
    console.error("Failed to refresh workspace:", error);
    return false;
  }
}

/**
 * Flip the "show hidden folders" preference: persist it, tell the live
 * workspace watcher (no restart needed), and re-scan the tree if a workspace
 * is open. Returns the new value.
 */
export async function toggleShowHiddenFiles(): Promise<boolean> {
  const next = !getShowHiddenFiles();
  setShowHiddenFiles(next);

  await invoke("set_show_hidden_files", { showHidden: next }).catch((error) => {
    console.error("Failed to update show-hidden-files setting:", error);
  });

  if (workspaceStore.getRootPath()) {
    await refreshWorkspace();
  }

  return next;
}

export function closeWorkspace(): void {
  const rootPath = workspaceStore.getRootPath();
  if (rootPath) {
    invoke("stop_watch_workspace", { rootPath }).catch((error) => {
      console.error("Failed to stop workspace watcher:", error);
    });
  }
  workspaceStore.clearWorkspace();
  documentStore.clearAll();
  tabsStore.closeAllTabs();
  activityStore.clearChanges();
}

// ── Self-initiated file mutations ──────────────────────────────────────────────

// Paths the user just created/renamed/deleted through the tree UI. The recursive
// workspace watcher echoes these as create/remove events; we already refresh the
// tree and adjust tabs ourselves, so they must not surface as *external* changes
// in the Recent Changes / activity panels.
const selfInitiatedPaths = new Map<string, number>();
const SELF_INITIATED_TTL_MS = 3000;

export function markSelfInitiated(path: string): void {
  selfInitiatedPaths.set(path, Date.now());
}

function takeSelfInitiated(path: string): boolean {
  const ts = selfInitiatedPaths.get(path);
  if (ts === undefined) return false;
  selfInitiatedPaths.delete(path);
  return Date.now() - ts <= SELF_INITIATED_TTL_MS;
}

// ── File operations ──────────────────────────────────────────────────────────

export async function openFileFromTree(filePath: string, fileName: string): Promise<void> {
  // Check if already open
  if (tabsStore.isOpen(filePath)) {
    tabsStore.activateTab(filePath);
    workspaceStore.setActiveFilePath(filePath);
    return;
  }

  try {
    const result = await invoke<{ path: string; content: string }>("read_file", {
      path: filePath,
    });

    // Load document
    documentStore.loadDocument(result.path, result.content);

    // Open tab
    tabsStore.openTab(filePath, fileName);

    // Set as active
    workspaceStore.setActiveFilePath(filePath);
  } catch (error) {
    console.error("Failed to open file:", error);
  }
}

// ── New untitled buffer ────────────────────────────────────────────────────────

/**
 * Open a blank, unsaved "Untitled" document as a new tab. It lives only in
 * memory (under a synthetic `untitled://` path) until its first save, which
 * goes through a Save-As dialog (see saveActiveDocumentAs). The name is
 * disambiguated against any untitled tabs already open.
 */
export function newUntitledFile(): void {
  let name = "Untitled.md";
  let path = `untitled://${name}`;
  for (let n = 2; tabsStore.isOpen(path); n++) {
    name = `Untitled-${n}.md`;
    path = `untitled://${name}`;
  }

  documentStore.createUntitledDocument(path);
  tabsStore.openTab(path, name, true);
  workspaceStore.setActiveFilePath(path);
}

// ── Tree-driven create / rename / delete ───────────────────────────────────────

/**
 * Create a new empty Markdown file inside `parentPath`. Returns the created
 * file's full path. Throws (with the backend's message) on failure, e.g. a name
 * collision, so the caller can surface it to the user.
 */
export async function createFileInTree(parentPath: string, name: string): Promise<string> {
  const newPath = await invoke<string>("create_markdown_file", { parentPath, name });
  markSelfInitiated(newPath);
  await refreshWorkspace();
  return newPath;
}

/**
 * Create an empty folder inside `parentPath`. Returns the created folder's
 * full path. Throws (with the backend's message) on failure, e.g. a name
 * collision.
 */
export async function createDirectoryInTree(parentPath: string, name: string): Promise<string> {
  const newPath = await invoke<string>("create_directory", { parentPath, name });
  await refreshWorkspace();
  return newPath;
}

/**
 * Rename a Markdown file in place, moving any open tab/document to the new path.
 * Returns the new full path. Throws (with the backend's message) on failure.
 */
export async function renameFileInTree(path: string, newName: string): Promise<string> {
  markSelfInitiated(path);
  const newPath = await invoke<string>("rename_path", { path, newName });
  if (newPath === path) return newPath;

  markSelfInitiated(newPath);

  if (tabsStore.isOpen(path)) {
    const fileName = newPath.split(/[/\\]/).pop() ?? newName;
    const wasActive = workspaceStore.getActiveFilePath() === path;
    documentStore.renamePath(path, newPath);
    tabsStore.renameTab(path, newPath, fileName);
    if (wasActive) {
      workspaceStore.setActiveFilePath(newPath);
    }
  }

  await refreshWorkspace();
  return newPath;
}

/**
 * Rename a folder in place, moving any open tabs/documents nested inside it
 * to their new paths and keeping Recent Changes pointing at files that still
 * exist. Returns the new full path. Throws (with the backend's message) on
 * failure. The workspace root is never passed here — the tree UI excludes it.
 */
export async function renameDirectoryInTree(path: string, newName: string): Promise<string> {
  // Snapshot the Markdown files nested under this folder before the rename,
  // so both their old and new paths can be marked self-initiated below (the
  // recursive watcher reports each nested file as its own create/remove pair).
  const dirNode = findFileNode(workspaceStore.getFiles(), path);
  const nestedFiles = dirNode ? flattenFileTree([dirNode]) : [];

  markSelfInitiated(path);
  const newPath = await invoke<string>("rename_path", { path, newName });
  if (newPath === path) return newPath;
  markSelfInitiated(newPath);

  for (const file of nestedFiles) {
    const newFilePath = rewriteDescendantPath(file.path, path, newPath);
    if (newFilePath === null) continue;
    markSelfInitiated(file.path);
    markSelfInitiated(newFilePath);
  }

  // Move any open tabs/documents that lived under the old folder path.
  for (const tab of tabsStore.getOpenTabs()) {
    const newTabPath = rewriteDescendantPath(tab.filePath, path, newPath);
    if (newTabPath === null) continue;

    const fileName = newTabPath.split(/[/\\]/).pop() ?? tab.fileName;
    const wasActive = workspaceStore.getActiveFilePath() === tab.filePath;
    documentStore.renamePath(tab.filePath, newTabPath);
    tabsStore.renameTab(tab.filePath, newTabPath, fileName);
    if (wasActive) {
      workspaceStore.setActiveFilePath(newTabPath);
    }
  }

  const recentChangedFiles = workspaceStore.getRecentChangedFiles().map((f) => {
    const newFilePath = rewriteDescendantPath(f.filePath, path, newPath);
    return newFilePath === null ? f : { ...f, filePath: newFilePath };
  });
  workspaceStore.setRecentChangedFiles(recentChangedFiles);

  await refreshWorkspace();
  return newPath;
}

/**
 * Delete a Markdown file, closing its tab/document if open. Throws (with the
 * backend's message) on failure.
 */
export async function deleteFileInTree(path: string): Promise<void> {
  markSelfInitiated(path);
  await invoke<boolean>("delete_path", { path });

  if (tabsStore.isOpen(path)) {
    tabsStore.closeTab(path);
    documentStore.unloadDocument(path);
  }

  await refreshWorkspace();
}

// ── Event listeners ──────────────────────────────────────────────────────────

export async function setupWorkspaceListeners(): Promise<() => void> {
  const unlistens: (() => void)[] = [];

  // File changed event
  const unlistenChanged = await listen<{ path: string }>("workspace://file-changed", (e) => {
    handleWorkspaceFileChanged(e.payload.path);
  });
  unlistens.push(unlistenChanged);

  // File created event
  const unlistenCreated = await listen<{ path: string }>("workspace://file-created", (e) => {
    // Refresh the file tree to show new file
    refreshWorkspace();

    // Skip surfacing user-initiated creations (via the tree UI) as external changes.
    if (takeSelfInitiated(e.payload.path)) return;

    activityStore.addChange(e.payload.path);
    workspaceStore.addRecentChangedFile(e.payload.path);
  });
  unlistens.push(unlistenCreated);

  // File removed event
  const unlistenRemoved = await listen<{ path: string }>("workspace://file-removed", (e) => {
    const filePath = e.payload.path;

    // Refresh the file tree
    refreshWorkspace();

    // Skip surfacing user-initiated deletions/renames (via the tree UI) as external
    // changes; the tree-driven controller has already adjusted any open tab.
    if (takeSelfInitiated(filePath)) return;

    activityStore.addChange(filePath);
    workspaceStore.addRecentChangedFile(filePath);

    if (tabsStore.isOpen(filePath)) {
      if (documentStore.isDirty(filePath)) {
        documentStore.markDeleted(filePath);
      } else {
        tabsStore.closeTab(filePath);
        documentStore.unloadDocument(filePath);
      }
    }
  });
  unlistens.push(unlistenRemoved);

  // Return cleanup function
  return () => {
    for (const unlisten of unlistens) {
      unlisten();
    }
  };
}

async function handleWorkspaceFileChanged(filePath: string): Promise<void> {
  if (!documentStore.hasDocument(filePath)) {
    activityStore.addChange(filePath);
    workspaceStore.addRecentChangedFile(filePath);
    return;
  }

  try {
    const result = await invoke<{ path: string; content: string }>("read_file", {
      path: filePath,
    });
    const document = documentStore.getDocument(filePath);
    if (!document) return;

    const contentMatchesEditor = result.content === document.markdown;
    const contentMatchesSaved = result.content === document.lastSavedMarkdown;
    if (contentMatchesEditor && contentMatchesSaved) {
      return;
    }

    activityStore.addChange(filePath);
    workspaceStore.addRecentChangedFile(filePath);

    const isActive = workspaceStore.getActiveFilePath() === filePath;
    if (isActive && !documentStore.isDirty(filePath)) {
      documentStore.applyExternalContent(filePath, result.content);
      tabsStore.updateTabDirtyState(filePath, false);
      return;
    }

    documentStore.markExternalUpdate(filePath);
  } catch (error) {
    console.error("Failed to handle workspace file change:", error);
    documentStore.markExternalUpdate(filePath);
  }
}
