// workspace-errors.ts - Translate the structured WorkspaceError payload the
// Rust backend returns (see src-tauri/src/services/workspace_error.rs) into
// localized toast text.
import { translate, workspaceEntryExistsMessage, type Locale } from "../i18n/translations";

type EntryKind = "file" | "folder" | "any";

type WorkspaceErrorPayload =
  | { code: "NameEmpty" }
  | { code: "NameHasSeparator" }
  | { code: "NameInvalid" }
  | { code: "EntryExists"; kind: EntryKind; name: string }
  | { code: "CannotLocateParentDir" }
  | { code: "NotMarkdownFile" }
  | { code: "NotADirectory" }
  | { code: "CreateFileFailed"; reason: string }
  | { code: "CreateDirFailed"; reason: string }
  | { code: "RenameFailed"; reason: string }
  | { code: "DeleteFailed"; reason: string }
  | { code: "ReadFailed"; reason: string }
  | { code: "WriteFailed"; reason: string }
  | { code: "ReadDirFailed"; reason: string }
  | { code: "Unexpected"; reason: string };

function isWorkspaceErrorPayload(value: unknown): value is WorkspaceErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/**
 * Translate a rejected `invoke()` error from a workspace command into
 * localized text. Falls back to `String(error)` for anything that doesn't
 * match the known `WorkspaceError` shape (e.g. a non-workspace command, or
 * an IPC-level failure).
 */
export function translateWorkspaceError(error: unknown, locale: Locale): string {
  if (!isWorkspaceErrorPayload(error)) return String(error);

  switch (error.code) {
    case "NameEmpty":
      return translate("error.workspace.nameEmpty", locale);
    case "NameHasSeparator":
      return translate("error.workspace.nameHasSeparator", locale);
    case "NameInvalid":
      return translate("error.workspace.nameInvalid", locale);
    case "EntryExists":
      return workspaceEntryExistsMessage(error.kind, error.name, locale);
    case "CannotLocateParentDir":
      return translate("error.workspace.cannotLocateParentDir", locale);
    case "NotMarkdownFile":
      return translate("error.workspace.notMarkdownFile", locale);
    case "NotADirectory":
      return translate("error.workspace.notADirectory", locale);
    case "CreateFileFailed":
      return `${translate("error.workspace.createFileFailed", locale)}: ${error.reason}`;
    case "CreateDirFailed":
      return `${translate("error.workspace.createDirFailed", locale)}: ${error.reason}`;
    case "RenameFailed":
      return `${translate("error.workspace.renameFailed", locale)}: ${error.reason}`;
    case "DeleteFailed":
      return `${translate("error.workspace.deleteFailed", locale)}: ${error.reason}`;
    case "ReadFailed":
      return `${translate("error.workspace.readFailed", locale)}: ${error.reason}`;
    case "WriteFailed":
      return `${translate("error.workspace.writeFailed", locale)}: ${error.reason}`;
    case "ReadDirFailed":
      return `${translate("error.workspace.readDirFailed", locale)}: ${error.reason}`;
    case "Unexpected":
      return `${translate("error.workspace.unexpected", locale)}: ${error.reason}`;
  }
}
