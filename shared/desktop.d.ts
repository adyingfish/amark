export interface WorkspaceFileNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  children?: WorkspaceFileNode[];
}

export interface WorkspaceScanResult {
  root_path: string;
  name: string;
  files: WorkspaceFileNode[];
}

export interface OpenWorkspaceResult {
  success: boolean;
  root_path?: string;
  name?: string;
  error?: string;
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  truncated: boolean;
}

export interface WorkspaceSearchMatch {
  file_path: string;
  file_name: string;
  line: number;
  column: number;
  start: number;
  end: number;
  preview: string;
  preview_match_start: number;
  preview_match_end: number;
}

export interface SearchContentOverride {
  path: string;
  content: string;
}

type FilePath = { path: string };
type FolderEntry = { parentPath: string; name: string };
type WorkspaceOptions = { rootPath: string; showHidden: boolean };
type FileDialog = { defaultPath?: string; filters: { name: string; extensions: string[] }[] };
type Command<Returns, Args = void> = { args: Args; returns: Returns };

export interface Commands {
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

export type CommandArgs<K extends keyof Commands> = Commands[K]["args"] extends void
  ? []
  : [Commands[K]["args"]];
export type Reply<T> = { ok: true; value: T } | { ok: false; error: unknown };

export type MenuEvent =
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
export type WorkspaceEvent =
  | "workspace://file-created"
  | "workspace://file-changed"
  | "workspace://file-removed";
export type DesktopEvents = Record<MenuEvent | WindowEvent, void> &
  Record<WorkspaceEvent, FilePath & { rootPath: string }> &
  Record<"set-theme" | "set-custom-css" | "agent-activity", string>;

export interface DesktopBridge {
  invoke<K extends keyof Commands>(
    name: K,
    ...args: CommandArgs<K>
  ): Promise<Reply<Commands[K]["returns"]>>;
  on<K extends keyof DesktopEvents>(
    name: K,
    listener: (payload: DesktopEvents[K]) => void,
  ): () => void;
  assetUrl(path: string): string;
}
