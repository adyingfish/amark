export interface TextMatch {
  start: number;
  end: number;
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

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  truncated: boolean;
}

export interface SearchContentOverride {
  path: string;
  content: string;
}

export type WorkspaceSearchStatus = "idle" | "loading" | "ready" | "error";
