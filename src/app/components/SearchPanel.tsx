import { CaseSensitive, FileText, LoaderCircle, Search } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "../../features/i18n/i18n-context";
import type {
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
  WorkspaceSearchStatus,
} from "../../features/search/search-types";

interface SearchResultGroup {
  filePath: string;
  fileName: string;
  matches: WorkspaceSearchMatch[];
}

export function SearchPanel({
  rootPath,
  query,
  caseSensitive,
  status,
  result,
  focusRequest,
  onQueryChange,
  onCaseSensitiveChange,
  onResultClick,
}: {
  rootPath: string | null;
  query: string;
  caseSensitive: boolean;
  status: WorkspaceSearchStatus;
  result: WorkspaceSearchResult;
  focusRequest: number;
  onQueryChange: (query: string) => void;
  onCaseSensitiveChange: (caseSensitive: boolean) => void;
  onResultClick: (match: WorkspaceSearchMatch) => void;
}): ReactElement {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const groups = useMemo(() => groupResults(result.matches), [result.matches]);

  useEffect(() => {
    if (focusRequest === 0) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [focusRequest]);

  return (
    <div className="search-panel">
      <div className="workspace-search-form" role="search">
        <div className="workspace-search-input-wrap">
          <Search className="lucide-icon" size={15} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("search.workspacePlaceholder")}
            aria-label={t("search.workspacePlaceholder")}
            disabled={!rootPath}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
          {status === "loading" ? (
            <LoaderCircle className="lucide-icon search-spinner" size={14} aria-hidden="true" />
          ) : null}
          <button
            type="button"
            className={cn("workspace-search-option", caseSensitive && "active")}
            title={t("search.matchCase")}
            aria-pressed={caseSensitive}
            disabled={!rootPath}
            onClick={() => onCaseSensitiveChange(!caseSensitive)}
          >
            <CaseSensitive className="lucide-icon" size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="workspace-search-results" aria-live="polite">
        {!rootPath ? (
          <SearchEmpty>{t("search.openWorkspace")}</SearchEmpty>
        ) : query.length === 0 ? (
          <SearchEmpty>{t("search.typeToSearch")}</SearchEmpty>
        ) : status === "loading" && result.matches.length === 0 ? (
          <SearchEmpty>{t("search.searching")}</SearchEmpty>
        ) : status === "error" ? (
          <SearchEmpty>{t("search.error")}</SearchEmpty>
        ) : status !== "loading" && result.matches.length === 0 ? (
          <SearchEmpty>{t("search.noResults")}</SearchEmpty>
        ) : (
          <>
            <div className="workspace-search-summary">
              {t("search.resultCount").replace("{count}", String(result.matches.length))}
              {result.truncated ? ` · ${t("search.resultsTruncated")}` : ""}
            </div>
            {groups.map((group) => (
              <section className="workspace-search-group" key={group.filePath}>
                <div className="workspace-search-file" title={group.filePath}>
                  <FileText className="lucide-icon" size={14} aria-hidden="true" />
                  <span className="workspace-search-file-name">
                    {relativePath(group.filePath, rootPath)}
                  </span>
                  <span className="workspace-search-file-count">{group.matches.length}</span>
                </div>
                {group.matches.map((match) => (
                  <button
                    type="button"
                    className="workspace-search-result"
                    key={`${match.start}-${match.end}`}
                    title={`${group.fileName}:${match.line}:${match.column}`}
                    onClick={() => onResultClick(match)}
                  >
                    <span className="workspace-search-line">{match.line}</span>
                    <span className="workspace-search-preview">
                      {match.preview.slice(0, match.preview_match_start)}
                      <mark>
                        {match.preview.slice(match.preview_match_start, match.preview_match_end)}
                      </mark>
                      {match.preview.slice(match.preview_match_end)}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SearchEmpty({ children }: { children: string }): ReactElement {
  return <div className="workspace-search-empty">{children}</div>;
}

function groupResults(matches: WorkspaceSearchMatch[]): SearchResultGroup[] {
  const groups = new Map<string, SearchResultGroup>();
  for (const match of matches) {
    const group = groups.get(match.file_path) ?? {
      filePath: match.file_path,
      fileName: match.file_name,
      matches: [],
    };
    group.matches.push(match);
    groups.set(match.file_path, group);
  }
  return [...groups.values()];
}

function relativePath(filePath: string, rootPath: string): string {
  const relative = filePath.startsWith(rootPath) ? filePath.slice(rootPath.length) : filePath;
  return relative.replace(/^[/\\]/, "").replace(/\\/g, "/") || filePath;
}
