// StatusBar.tsx - Bottom status bar; subscribes only to the workspace/document
// slices it needs instead of re-rendering with the whole app shell.
import { type ReactElement, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { documentStore } from "../../features/document/document-store";
import { useI18n } from "../../features/i18n/i18n-context";
import { workspaceStore } from "../../features/workspace/workspace-store";
import { type AgentState, formatDisplayPath, formatSaveStatusForDocument } from "../app-utils";

const subscribeWorkspace = (onChange: () => void) => workspaceStore.subscribe(onChange);
const subscribeDocuments = (onChange: () => void) => documentStore.subscribe(onChange);

export function StatusBar({ agentState }: { agentState: AgentState }): ReactElement {
  const { t, locale } = useI18n();
  const activePath = useSyncExternalStore(subscribeWorkspace, () =>
    workspaceStore.getActiveFilePath(),
  );
  const rootPath = useSyncExternalStore(subscribeWorkspace, () => workspaceStore.getRootPath());
  const workspaceName = useSyncExternalStore(subscribeWorkspace, () => workspaceStore.getName());
  const activeDocument = useSyncExternalStore(subscribeDocuments, () =>
    activePath ? documentStore.getDocument(activePath) : undefined,
  );

  const statusLeft = activePath
    ? formatDisplayPath(activePath, rootPath, workspaceName)
    : rootPath
      ? t("status.noFileSelected")
      : t("status.noWorkspaceOpen");
  const statusRight = activeDocument ? formatSaveStatusForDocument(activeDocument, locale) : "";

  return (
    <div className="status-bar">
      <span className="status-left">{statusLeft}</span>
      <span className="status-right">
        <span className="document-status">{statusRight}</span>
        <span
          id="agent-dot"
          className={cn("agent-dot", agentState !== "idle" && agentState)}
          title="Agent Activity"
        />
      </span>
    </div>
  );
}
