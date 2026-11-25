import type { DesktopBridge } from "../shared/desktop";
import { contextBridge, ipcRenderer } from "electron";

// Sandboxed preloads cannot load local modules. Every command is dispatched
// through an explicit handler in the main process. Never expose ipcRenderer.
const token = process.argv.find((arg) => arg.startsWith("--amark-assets="))?.split("=")[1];
if (process.isMainFrame && token) {
  const encoded = process.argv
    .find((arg) => arg.startsWith("--amark-preferences="))
    ?.slice("--amark-preferences=".length);
  try {
    if (encoded && !localStorage.getItem("amark-imported-preferences")) {
      const legacy = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      for (const [key, value] of Object.entries(legacy)) {
        if (typeof value === "string" && localStorage.getItem(key) === null)
          localStorage.setItem(key, value);
      }
      if (Object.keys(legacy).length) localStorage.setItem("amark-imported-preferences", "true");
    }
  } catch (error) {
    console.warn(
      "Could not restore previous AMark preferences",
      error instanceof Error ? error.message : String(error),
    );
  }
  contextBridge.exposeInMainWorld("amark", {
    invoke(name, ...args) {
      return ipcRenderer.invoke("amark:command", name, args[0] ?? {});
    },
    on(name, callback) {
      const channel = "amark:event:" + name;
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: Parameters<typeof callback>[0],
      ) => callback(payload);
      ipcRenderer.on(channel, listener);
      if (name === "window-close-requested") ipcRenderer.send("amark:close-listener", true);
      return () => {
        ipcRenderer.removeListener(channel, listener);
        if (name === "window-close-requested") {
          ipcRenderer.send("amark:close-listener", ipcRenderer.listenerCount(channel) > 0);
        }
      };
    },
    assetUrl(file) {
      return "amark-asset://" + token + "/" + encodeURIComponent(file);
    },
  } satisfies DesktopBridge);
}
