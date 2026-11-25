export type {
  WorkspaceSearchResult,
  WorkspaceSearchMatch,
  SearchContentOverride,
} from "../../../shared/desktop";
export interface TextMatch {
  start: number;
  end: number;
}

export type WorkspaceSearchStatus = "idle" | "loading" | "ready" | "error";
