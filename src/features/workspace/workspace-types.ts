export type {
  WorkspaceFileNode,
  WorkspaceScanResult,
  OpenWorkspaceResult,
} from "../../../shared/desktop";
import type { WorkspaceFileNode } from "../../../shared/desktop";
// workspace-types.ts - Workspace domain types

export interface WorkspaceState {
  rootPath: string | null;
  name: string | null;
  files: WorkspaceFileNode[];
  activeFilePath: string | null;
  lastOpenedAt: number | null;
}

export interface RecentChangedFile {
  filePath: string;
  changedAt: number;
}
