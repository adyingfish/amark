import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy as CopyIcon, Minus, Square, X } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { useI18n } from "../../features/i18n/i18n-context";

export function WindowControls(): ReactElement {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let disposed = false;
    const sync = async () => {
      const isMaximized = await appWindow.isMaximized();
      if (!disposed) setMaximized(isMaximized);
    };

    void sync();
    appWindow.onResized(sync).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const maximizeTitle = maximized ? t("window.restore") : t("window.maximize");

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control window-control-minimize"
        title={t("window.minimize")}
        aria-label={t("window.minimize")}
        onClick={() => void appWindow.minimize()}
      >
        <Minus className="lucide-icon" size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-control window-control-maximize"
        title={maximizeTitle}
        aria-label={maximizeTitle}
        onClick={() => void appWindow.toggleMaximize()}
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
        onClick={() => void appWindow.close()}
      >
        <X className="lucide-icon" size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
