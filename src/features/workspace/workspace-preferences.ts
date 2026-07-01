// workspace-preferences.ts - Persisted workspace view preferences.
//
// Small, ad-hoc localStorage-backed settings (mirrors sidebar-resizer.ts /
// split-divider.ts) since the project has no central settings store yet.

const SHOW_HIDDEN_FILES_KEY = "amark-show-hidden-files";

/** Whether the file tree/watcher should include hidden (dotfile) entries. */
export function getShowHiddenFiles(): boolean {
  return localStorage.getItem(SHOW_HIDDEN_FILES_KEY) === "true";
}

export function setShowHiddenFiles(show: boolean): void {
  localStorage.setItem(SHOW_HIDDEN_FILES_KEY, String(show));
}
