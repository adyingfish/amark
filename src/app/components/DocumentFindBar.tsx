import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "../../features/i18n/i18n-context";

export function DocumentFindBar({
  open,
  focusRequest,
  query,
  caseSensitive,
  matchCount,
  activeIndex,
  onQueryChange,
  onCaseSensitiveChange,
  onPrevious,
  onNext,
  onClose,
}: {
  open: boolean;
  focusRequest: number;
  query: string;
  caseSensitive: boolean;
  matchCount: number;
  activeIndex: number;
  onQueryChange: (query: string) => void;
  onCaseSensitiveChange: (caseSensitive: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}): ReactElement | null {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [focusRequest, open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
    }
  };

  return (
    <div className="document-find-bar" role="search" aria-label={t("search.currentDocument")}>
      <input
        ref={inputRef}
        value={query}
        placeholder={t("search.findPlaceholder")}
        aria-label={t("search.findPlaceholder")}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="document-find-count" aria-live="polite">
        {query.length === 0
          ? "—"
          : matchCount === 0
            ? t("search.noResultsShort")
            : `${activeIndex + 1} / ${matchCount}`}
      </span>
      <button
        type="button"
        className={cn("document-find-action", caseSensitive && "active")}
        title={t("search.matchCase")}
        aria-pressed={caseSensitive}
        onClick={() => onCaseSensitiveChange(!caseSensitive)}
      >
        <CaseSensitive className="lucide-icon" size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="document-find-action"
        title={t("search.previous")}
        disabled={matchCount === 0}
        onClick={onPrevious}
      >
        <ChevronUp className="lucide-icon" size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="document-find-action"
        title={t("search.next")}
        disabled={matchCount === 0}
        onClick={onNext}
      >
        <ChevronDown className="lucide-icon" size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="document-find-action"
        title={t("search.close")}
        onClick={onClose}
      >
        <X className="lucide-icon" size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
