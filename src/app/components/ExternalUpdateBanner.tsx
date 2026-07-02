// ExternalUpdateBanner.tsx - Subscribes to the active document itself so typing
// (which re-emits document records) doesn't force the app shell to re-render.
import { type ReactElement, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { documentStore } from "../../features/document/document-store";
import { useI18n } from "../../features/i18n/i18n-context";

const subscribeDocuments = (onChange: () => void) => documentStore.subscribe(onChange);

export function ExternalUpdateBanner({
  filePath,
  onReload,
}: {
  filePath: string | null;
  onReload: (filePath: string) => void;
}): ReactElement {
  const { t } = useI18n();
  const document = useSyncExternalStore(subscribeDocuments, () =>
    filePath ? documentStore.getDocument(filePath) : undefined,
  );

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
