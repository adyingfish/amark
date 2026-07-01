import type { ReactElement } from "react";
import { useI18n } from "../../features/i18n/i18n-context";
import type { RecentChangedFile } from "../../features/workspace/workspace-types";
import { formatRelativeTime } from "../app-utils";

export function ActivityPanel({
  changes,
  onFileClick,
}: {
  changes: RecentChangedFile[];
  onFileClick: (filePath: string) => void;
}): ReactElement {
  const { locale, t } = useI18n();
  const visibleChanges = changes.slice(0, 8);
  return (
    <div className="activity-panel">
      <div className="activity-panel-header">{t("activity.recentChanges")}</div>
      {visibleChanges.length === 0 ? (
        <div className="activity-empty">{t("activity.noChanges")}</div>
      ) : (
        <div className="activity-list">
          {visibleChanges.map((change) => (
            <button
              key={change.filePath}
              type="button"
              className="activity-item"
              title={change.filePath}
              onClick={() => onFileClick(change.filePath)}
            >
              <span className="activity-file-name">
                {change.filePath.split(/[/\\]/).pop() || change.filePath}
              </span>
              <span className="activity-time">{formatRelativeTime(change.changedAt, locale)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
