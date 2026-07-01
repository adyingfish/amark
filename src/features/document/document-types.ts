// document-types.ts - Document domain types

export interface DocumentRecord {
  filePath: string;
  fileName: string;
  markdown: string;
  lastSavedMarkdown: string;
  saveStatus: "saved" | "dirty" | "saving" | "error";
  lastExternalUpdateAt: number | null;
  hasPendingExternalUpdate: boolean;
  isDeleted: boolean;
  isLoaded: boolean;
  // A new buffer that has never been written to disk (filePath is a synthetic
  // `untitled://…` id). It saves through a Save-As dialog on first save.
  isUntitled: boolean;
}
