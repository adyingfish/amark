// SaveButton.tsx - Save toolbar button; subscribes only to the active
// document's dirty state instead of re-rendering with the whole app shell.
import { type ReactElement, useSyncExternalStore } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { documentStore } from "../../features/document/document-store";
import { saveActiveDocument } from "../../features/document/document-controller";
import { useI18n } from "../../features/i18n/i18n-context";
import { workspaceStore } from "../../features/workspace/workspace-store";

const subscribeWorkspace = (onChange: () => void) => workspaceStore.subscribe(onChange);
const subscribeDocuments = (onChange: () => void) => documentStore.subscribe(onChange);

export function SaveButton(): ReactElement {
  const { t } = useI18n();
  const activePath = useSyncExternalStore(subscribeWorkspace, () =>
    workspaceStore.getActiveFilePath(),
  );
  const isDirty = useSyncExternalStore(subscribeDocuments, () =>
    activePath ? documentStore.isDirty(activePath) : false,
  );

  return (
    <Button
      id="btn-save"
      type="button"
      variant="ghost"
      size="icon"
      title={t("toolbar.save")}
      disabled={!activePath || !isDirty}
      onClick={() => void saveActiveDocument()}
    >
      <Save className="lucide-icon" size={16} aria-hidden="true" />
    </Button>
  );
}
