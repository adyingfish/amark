import { invoke } from "@tauri-apps/api/core";
import { documentStore } from "../document/document-store";
import { getShowHiddenFiles } from "../workspace/workspace-preferences";
import { isPathWithinRoot } from "../workspace/workspace-utils";
import type { SearchContentOverride, WorkspaceSearchResult } from "./search-types";

export async function searchWorkspace(
  rootPath: string,
  query: string,
  caseSensitive: boolean,
): Promise<WorkspaceSearchResult> {
  const overrides: SearchContentOverride[] = documentStore
    .getAllDocuments()
    .filter(
      (document) =>
        !document.isUntitled &&
        !document.isDeleted &&
        documentStore.isDirty(document.filePath) &&
        isPathWithinRoot(rootPath, document.filePath),
    )
    .map((document) => ({ path: document.filePath, content: document.markdown }));

  return invoke<WorkspaceSearchResult>("search_workspace", {
    rootPath,
    query,
    caseSensitive,
    showHidden: getShowHiddenFiles(),
    overrides,
  });
}
