import { invoke } from "../services/desktop";

/** Native close requests are held until the editor finishes saving or the user discards edits. */
export function setupWindowClose(confirmClose: () => Promise<boolean>): () => void {
  let confirming = false;
  return window.amark.on("window-close-requested", async () => {
    if (confirming) return;
    confirming = true;
    try {
      const approved = await confirmClose();
      await invoke(approved ? "window_destroy" : "window_cancel_close");
    } catch (error) {
      console.error("Failed to complete window close:", error);
      await invoke("window_cancel_close");
    } finally {
      confirming = false;
    }
  });
}
