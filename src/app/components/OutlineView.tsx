import { type ReactElement, useMemo, useSyncExternalStore } from "react";
import { documentStore } from "../../features/document/document-store";
import {
  extractMarkdownOutline,
  type MarkdownOutlineItem,
} from "../../features/outline/markdown-outline";
import { useI18n } from "../../features/i18n/i18n-context";

const subscribeDocuments = (onChange: () => void) => documentStore.subscribe(onChange);

export interface OutlineViewProps {
  filePath: string | null;
  onHeadingClick: (heading: MarkdownOutlineItem) => void;
}

export function OutlineView({ filePath, onHeadingClick }: OutlineViewProps): ReactElement {
  const { t } = useI18n();
  const markdown = useSyncExternalStore(subscribeDocuments, () =>
    filePath ? (documentStore.getMarkdown(filePath) ?? "") : "",
  );
  const outline = useMemo(() => extractMarkdownOutline(markdown), [markdown]);

  if (!filePath) {
    return <div className="outline-empty">{t("outline.noDocument")}</div>;
  }

  if (outline.length === 0) {
    return <div className="outline-empty">{t("outline.noHeadings")}</div>;
  }

  return (
    <nav className="outline-view" aria-label={t("outline.navigation")}>
      <ul className="outline-list">
        {outline.map((heading) => (
          <li key={`${heading.line}-${heading.headingIndex}`} className="outline-item">
            <button
              type="button"
              className="outline-heading"
              style={{ paddingLeft: `${12 + (heading.level - 1) * 14}px` }}
              title={heading.text}
              onClick={() => onHeadingClick(heading)}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
