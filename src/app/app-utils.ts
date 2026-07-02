import type { CSSProperties } from "react";
import type { DocumentRecord } from "../features/document/document-types";
import { type Locale, translate } from "../features/i18n/translations";

export type AgentState = "idle" | "active" | "cooldown";

export function formatRelativeTime(timestamp: number, locale: Locale): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return translate("time.now", locale);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

export function formatDisplayPath(
  filePath: string,
  rootPath: string | null,
  workspaceName: string | null,
): string {
  if (rootPath && filePath.startsWith(rootPath)) {
    const rootName = workspaceName ?? basename(rootPath);
    const relative = filePath.slice(rootPath.length).replace(/^[/\\]/, "");
    const display = relative ? `${rootName}/${relative}` : rootName;
    return display.replace(/\\/g, "/");
  }
  return filePath.replace(/\\/g, "/");
}

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function formatSaveStatusForDocument(document: DocumentRecord, locale: Locale): string {
  if (document.isDeleted) return translate("status.deletedExternally", locale);
  if (document.hasPendingExternalUpdate) return translate("status.externalUpdate", locale);
  switch (document.saveStatus) {
    case "dirty":
      return translate("status.unsaved", locale);
    case "saving":
      return translate("status.saving", locale);
    case "error":
      return translate("status.saveError", locale);
    case "saved":
      return translate("status.saved", locale);
  }
}

export function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}

export function clampMenuPosition(x: number, y: number): CSSProperties {
  return {
    top: Math.max(0, Math.min(y, window.innerHeight - 32)),
    left: Math.max(0, Math.min(x, window.innerWidth - 180)),
  };
}
