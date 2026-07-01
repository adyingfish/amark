import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { DocumentRecord } from "../../features/document/document-types";
import { useI18n } from "../../features/i18n/i18n-context";

export function ExternalUpdateBanner({
  document,
  onReload,
}: {
  document: DocumentRecord | undefined;
  onReload: (filePath: string) => void;
}): ReactElement {
  const { t } = useI18n();

  if (!document || !document.hasPendingExternalUpdate) {
    return <div className="external-update-banner" />;
  }

  const message = document.isDeleted ? t("banner.fileDeleted") : t("banner.fileChanged");

  return (
    <div className={cn("external-update-banner visible", document.isDeleted && "danger")}>
      <span>{message}</span>
      {!document.isDeleted ? (
        <button type="button" className="banner-action" onClick={() => onReload(document.filePath)}>
          {t("banner.reload")}
        </button>
      ) : null}
    </div>
  );
}
