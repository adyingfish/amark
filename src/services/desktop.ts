import type { SearchContentOverride, WorkspaceSearchResult } from "../features/search/search-types";
import type {
  OpenWorkspaceResult,
  WorkspaceScanResult,
} from "../features/workspace/workspace-types";

type FilePath = { path: string };
type FolderEntry = { parentPath: string; name: string };
type WorkspaceOptions = { rootPath: string; showHidden: boolean };
type FileDialog = { defaultPath?: string; filters: { name: string; extensions: string[] }[] };
type Command<Returns, Args = void> = { args: Args; returns: Returns };

interface Commands {
  authorize_workspace: Command<string | null, FilePath>;
  open_workspace_folder: Command<OpenWorkspaceResult>;
  scan_workspace: Command<WorkspaceScanResult, WorkspaceOptions>;
  start_watch_workspace: Command<boolean, WorkspaceOptions>;
  stop_watch_workspace: Command<boolean, { rootPath: string }>;
  set_show_hidden_files: Command<void, { showHidden: boolean }>;
  read_file: Command<{ path: string; content: string }, FilePath>;
  save_file_v2: Command<boolean, FilePath & { content: string }>;
  create_directory: Command<string, FolderEntry>;
  create_markdown_file: Command<string, FolderEntry>;
  delete_path: Command<boolean, FilePath>;
  rename_path: Command<string, FilePath & { newName: string }>;
  search_workspace: Command<
    WorkspaceSearchResult,
    WorkspaceOptions & {
      query: string;
      caseSensitive: boolean;
      overrides: SearchContentOverride[];
    }
  >;
  dialog_open_file: Command<string | null, FileDialog>;
  dialog_save_file: Command<string | null, FileDialog>;
  home_dir: Command<string>;
  open_external: Command<void, { url: string }>;
  open_path_in_new_window: Command<void, FilePath>;
  take_launch_files: Command<{ path: string; dir: string | null }[]>;
  menu_action: Command<void, { id: string }>;
  export_html: Command<boolean, { html: string; title: string }>;
  export_pdf: Command<boolean, { html: string; title: string }>;
  load_custom_theme: Command<{ name: string; css: string } | null>;
  list_custom_themes: Command<string[]>;
  load_theme_css: Command<string | null, { fileName: string }>;
  window_is_maximized: Command<boolean>;
  window_toggle_maximize: Command<void>;
  window_minimize: Command<void>;
  window_request_close: Command<void>;
  window_cancel_close: Command<void>;
  window_destroy: Command<void>;
}

type CommandArgs<K extends keyof Commands> = Commands[K]["args"] extends void
  ? []
  : [Commands[K]["args"]];
type Reply<T> = { ok: true; value: T } | { ok: false; error: unknown };

type MenuEvent =
  | "menu-open-folder"
  | "menu-open-folder-path"
  | "menu-open"
  | "menu-new"
  | "menu-save"
  | "menu-save-as"
  | "menu-find"
  | "menu-find-workspace"
  | "menu-export-html"
  | "menu-export-pdf"
  | "menu-import-theme"
  | "view-toggle-hidden-files";
type WindowEvent =
  | "window-resized"
  | "window-close-requested"
  | "pdf-export-done"
  | "pdf-export-error";
type WorkspaceEvent =
  | "workspace://file-created"
  | "workspace://file-changed"
  | "workspace://file-removed";
type DesktopEvents = Record<MenuEvent | WindowEvent, void> &
  Record<WorkspaceEvent, FilePath & { rootPath: string }> &
  Record<"set-theme" | "set-custom-css" | "agent-activity", string>;

declare global {
  interface Window {
    amark: {
      invoke<K extends keyof Commands>(
        name: K,
        ...args: CommandArgs<K>
      ): Promise<Reply<Commands[K]["returns"]>>;
      on<K extends keyof DesktopEvents>(
        name: K,
        listener: (payload: DesktopEvents[K]) => void,
      ): () => void;
      assetUrl(path: string): string;
    };
  }
}

/** Unwrap errors in the renderer so structured filesystem errors retain their fields. */
export async function invoke<K extends keyof Commands>(
  name: K,
  ...args: CommandArgs<K>
): Promise<Commands[K]["returns"]> {
  const reply = await window.amark.invoke(name, ...args);
  if (!reply.ok) throw reply.error;
  return reply.value;
}
