// document-controller.ts - Document business logic
import { invoke } from "@/services/desktop";
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
export async function saveDocument(filePath: string): Promise<string | null> {
  const document = documentStore.getDocument(filePath);
  if (!document) return null;

  if (document.isUntitled) {
    return saveDocumentAs(filePath);
  }

  try {
    documentStore.markSaving(filePath);
    await invoke("save_file_v2", {
      path: filePath,
      content: document.markdown,
    });
    documentStore.markSaved(filePath, document.markdown);
    const dirty = documentStore.isDirty(filePath);
    tabsStore.updateTabDirtyState(filePath, dirty);
    return dirty ? null : filePath;
  } catch (error) {
    console.error("Failed to save file:", error);
    documentStore.markError(filePath);
    return null;
  }
}

/**
 * Save the document at `filePath` to a path chosen via the system Save
 * dialog. Used by File ▸ Save As… and as the first-save path for untitled
 * buffers. On success the document/tab are re-keyed to the chosen path and
 * the workspace tree refreshes to reveal the new file.
 */
export async function saveDocumentAs(filePath: string): Promise<string | null> {
  const document = documentStore.getDocument(filePath);
  if (!document) return null;

  const rootPath = workspaceStore.getRootPath();
  const defaultPath = rootPath ? joinPath(rootPath, document.fileName) : document.fileName;

  const chosen = await invoke("dialog_save_file", {
    defaultPath,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
  if (typeof chosen !== "string") return null;

  const savedToSamePath = !document.isUntitled && chosen === filePath;

  try {
    documentStore.markSaving(filePath);
    // Pre-mark so the workspace watcher's create event for this save isn't
    // surfaced as an *external* change.
    markSelfInitiated(chosen);
    await invoke("save_file_v2", { path: chosen, content: document.markdown });

    if (savedToSamePath) {
      documentStore.markSaved(filePath, document.markdown);
    } else {
      const newName = chosen.split(/[/\\]/).pop() ?? document.fileName;
      documentStore.adoptPath(filePath, chosen, document.markdown);
      tabsStore.renameTab(filePath, chosen, newName);
      if (workspaceStore.getActiveFilePath() === filePath) {
        workspaceStore.setActiveFilePath(chosen);
      }
    }

    tabsStore.updateTabDirtyState(chosen, documentStore.isDirty(chosen));
    await refreshWorkspace();
    return documentStore.isDirty(chosen) ? null : chosen;
  } catch (error) {
    console.error("Failed to save file:", error);
    documentStore.markError(filePath);
    return null;
  }
}

/**
 * Save the current active document. A never-saved "untitled" buffer is routed
 * through the Save-As dialog so the user can choose where it lands on disk.
 */
export async function saveActiveDocument(): Promise<boolean> {
  const activePath = workspaceStore.getActiveFilePath();
  if (!activePath) return false;
  return (await saveDocument(activePath)) !== null;
}

/**
 * Save the active document to a path chosen via the system Save dialog. Used
 * by File ▸ Save As… and as the first-save path for untitled buffers.
 */
export async function saveActiveDocumentAs(): Promise<boolean> {
  const activePath = workspaceStore.getActiveFilePath();
  if (!activePath) return false;
  return (await saveDocumentAs(activePath)) !== null;
}

export async function reloadDocumentFromDisk(filePath: string): Promise<boolean> {
  try {
    const result = await invoke("read_file", {
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
