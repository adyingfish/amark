import { invoke } from "@/services/desktop";
import { Copy as CopyIcon, Minus, Square, X } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "../../features/i18n/i18n-context";
import type { AgentState } from "../app-utils";

export function WindowControls({ agentState }: { agentState: AgentState }): ReactElement {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    const sync = async () => {
      const isMaximized = await invoke("window_is_maximized");
      if (!disposed) setMaximized(isMaximized);
    };

    void sync();
    const unlisten = window.amark.on("window-resized", sync);

    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  const maximizeTitle = maximized ? t("window.restore") : t("window.maximize");

  return (
    <div className="window-controls">
      <span
        id="agent-dot"
        className={cn("agent-dot", agentState !== "idle" && agentState)}
        title="Agent Activity"
      />
      <button
        type="button"
        className="window-control window-control-minimize"
        title={t("window.minimize")}
        aria-label={t("window.minimize")}
        onClick={() => void invoke("window_minimize")}
      >
        <Minus className="lucide-icon" size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-control window-control-maximize"
        title={maximizeTitle}
        aria-label={maximizeTitle}
        onClick={() => void invoke("window_toggle_maximize")}
      >
        {maximized ? (
          <CopyIcon className="lucide-icon" size={14} aria-hidden="true" />
        ) : (
          <Square className="lucide-icon" size={12} aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        title={t("window.close")}
        aria-label={t("window.close")}
        onClick={() => void invoke("window_request_close")}
      >
        <X className="lucide-icon" size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
