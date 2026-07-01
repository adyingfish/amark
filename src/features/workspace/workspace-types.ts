// workspace-types.ts - Workspace domain types

export interface WorkspaceState {
  rootPath: string | null;
  name: string | null;
  files: WorkspaceFileNode[];
  openTabs: string[];
  activeFilePath: string | null;
  recentChangedFiles: RecentChangedFile[];
  lastOpenedAt: number | null;
}

export interface WorkspaceFileNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  children?: WorkspaceFileNode[];
}

export interface RecentChangedFile {
  filePath: string;
  changedAt: number;
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
