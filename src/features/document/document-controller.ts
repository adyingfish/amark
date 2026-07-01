// document-controller.ts - Document business logic
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { documentStore } from "./document-store";
import { tabsStore } from "../tabs/tabs-store";
import { workspaceStore } from "../workspace/workspace-store";
import { markSelfInitiated, refreshWorkspace } from "../workspace/workspace-controller";

const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"];

/** Join a directory and file name using the directory's own path separator. */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/**
 * Save the document at `filePath`. A never-saved "untitled" buffer is routed
 * through the Save-As dialog so the user can choose where it lands on disk.
 */
export async function saveDocument(filePath: string): Promise<boolean> {
  const document = documentStore.getDocument(filePath);
  if (!document) return false;

  if (document.isUntitled) {
    return saveDocumentAs(filePath);
  }

  try {
    documentStore.markSaving(filePath);
    await invoke("save_file_v2", {
      path: filePath,
      content: document.markdown,
    });
    documentStore.markSaved(filePath);
    tabsStore.updateTabDirtyState(filePath, false);
    return true;
  } catch (error) {
    console.error("Failed to save file:", error);
    documentStore.markError(filePath);
    return false;
  }
}

/**
 * Save the document at `filePath` to a path chosen via the system Save
 * dialog. Used by File ▸ Save As… and as the first-save path for untitled
 * buffers. On success the document/tab are re-keyed to the chosen path and
 * the workspace tree refreshes to reveal the new file.
 */
export async function saveDocumentAs(filePath: string): Promise<boolean> {
  const document = documentStore.getDocument(filePath);
  if (!document) return false;

  const rootPath = workspaceStore.getRootPath();
  const defaultPath = rootPath ? joinPath(rootPath, document.fileName) : document.fileName;

  const chosen = await save({
    defaultPath,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (typeof chosen !== "string") return false;

  const savedToSamePath = !document.isUntitled && chosen === filePath;

  try {
    documentStore.markSaving(filePath);
    // Pre-mark so the workspace watcher's create event for this save isn't
    // surfaced as an *external* change.
    markSelfInitiated(chosen);
    await invoke("save_file_v2", { path: chosen, content: document.markdown });

    if (savedToSamePath) {
      documentStore.markSaved(filePath);
      tabsStore.updateTabDirtyState(filePath, false);
    } else {
      const newName = chosen.split(/[/\\]/).pop() ?? document.fileName;
      documentStore.adoptPath(filePath, chosen);
      tabsStore.renameTab(filePath, chosen, newName);
      if (workspaceStore.getActiveFilePath() === filePath) {
        workspaceStore.setActiveFilePath(chosen);
      }
    }

    await refreshWorkspace();
    return true;
  } catch (error) {
    console.error("Failed to save file:", error);
    documentStore.markError(filePath);
    return false;
  }
}

/**
 * Save the current active document. A never-saved "untitled" buffer is routed
 * through the Save-As dialog so the user can choose where it lands on disk.
 */
export async function saveActiveDocument(): Promise<boolean> {
  const activePath = workspaceStore.getActiveFilePath();
  if (!activePath) return false;
  return saveDocument(activePath);
}

/**
 * Save the active document to a path chosen via the system Save dialog. Used
 * by File ▸ Save As… and as the first-save path for untitled buffers.
 */
export async function saveActiveDocumentAs(): Promise<boolean> {
  const activePath = workspaceStore.getActiveFilePath();
  if (!activePath) return false;
  return saveDocumentAs(activePath);
}

export async function reloadDocumentFromDisk(filePath: string): Promise<boolean> {
  try {
    const result = await invoke<{ path: string; content: string }>("read_file", {
      path: filePath,
    });

    documentStore.applyExternalContent(result.path, result.content);
    tabsStore.updateTabDirtyState(result.path, false);
    return true;
  } catch (error) {
    console.error("Failed to reload file:", error);
    documentStore.markError(filePath);
    return false;
  }
}

/**
 * Update document content from editor
 */
export function updateDocumentContent(filePath: string, markdown: string): void {
  documentStore.updateContent(filePath, markdown);

  const isDirty = documentStore.isDirty(filePath);
  tabsStore.updateTabDirtyState(filePath, isDirty);
}

/**
 * Get active document content for editor
 */
export function getActiveDocumentContent(): string {
  const activePath = workspaceStore.getActiveFilePath();
  if (!activePath) return "";

  return documentStore.getMarkdown(activePath) || "";
}
