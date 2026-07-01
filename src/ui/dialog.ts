// dialog.ts - Lightweight modal prompt / confirm dialogs (editor-agnostic UI).
//
// The Tauri webview disables the native window.prompt / window.confirm, so the
// tree's create / rename / delete flows use these small body-anchored modals.
import { t } from "../features/i18n/i18n-context";

interface PromptOptions {
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  // When prefilling a value, select only the basename (text before the final
  // extension dot) so renaming keeps the extension out of the selection.
  selectBasename?: boolean;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmUnsavedOptions {
  title: string;
  message: string;
  saveText?: string;
  discardText?: string;
  cancelText?: string;
}

export type UnsavedChangesChoice = "save" | "discard" | "cancel";

function buildOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "app-dialog-overlay";
  return overlay;
}

/**
 * Prompt for a single line of text. Resolves with the trimmed value, or null
 * when the user cancels (Escape / Cancel / clicking the backdrop).
 */
export function promptInput(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = buildOverlay();

    const dialog = document.createElement("div");
    dialog.className = "app-dialog";

    const titleEl = document.createElement("div");
    titleEl.className = "app-dialog-title";
    titleEl.textContent = options.title;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "app-dialog-input";
    input.value = options.initialValue ?? "";
    if (options.placeholder) input.placeholder = options.placeholder;

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "app-dialog-btn";
    cancelBtn.textContent = t("dialog.cancel");

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "app-dialog-btn primary";
    confirmBtn.textContent = options.confirmText ?? t("dialog.confirm");

    actions.append(cancelBtn, confirmBtn);
    dialog.append(titleEl, input, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let settled = false;
    const close = (value: string | null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    };

    const commit = () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }
      close(value);
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    };

    cancelBtn.onclick = () => close(null);
    confirmBtn.onclick = () => commit();
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener("keydown", onKeydown, true);

    input.focus();
    if (options.initialValue) {
      if (options.selectBasename) {
        const dot = options.initialValue.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : options.initialValue.length);
      } else {
        input.select();
      }
    }
  });
}

/** Confirm dialog. Resolves true on confirm, false on cancel/Escape/backdrop. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = buildOverlay();

    const dialog = document.createElement("div");
    dialog.className = "app-dialog";

    const titleEl = document.createElement("div");
    titleEl.className = "app-dialog-title";
    titleEl.textContent = options.title;

    const messageEl = document.createElement("div");
    messageEl.className = "app-dialog-message";
    messageEl.textContent = options.message;

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "app-dialog-btn";
    cancelBtn.textContent = options.cancelText ?? t("dialog.cancel");

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = `app-dialog-btn ${options.danger ? "danger" : "primary"}`;
    confirmBtn.textContent = options.confirmText ?? t("dialog.confirm");

    actions.append(cancelBtn, confirmBtn);
    dialog.append(titleEl, messageEl, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let settled = false;
    const close = (value: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    };

    cancelBtn.onclick = () => close(false);
    confirmBtn.onclick = () => close(true);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKeydown, true);

    confirmBtn.focus();
  });
}

/**
 * Three-way confirm for closing something with unsaved changes. Resolves
 * "save" / "discard" / "cancel" (Escape, backdrop click, or the Cancel
 * button all resolve "cancel").
 */
export function confirmUnsavedChanges(
  options: ConfirmUnsavedOptions,
): Promise<UnsavedChangesChoice> {
  return new Promise((resolve) => {
    const overlay = buildOverlay();

    const dialog = document.createElement("div");
    dialog.className = "app-dialog";

    const titleEl = document.createElement("div");
    titleEl.className = "app-dialog-title";
    titleEl.textContent = options.title;

    const messageEl = document.createElement("div");
    messageEl.className = "app-dialog-message";
    messageEl.textContent = options.message;

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "app-dialog-btn";
    cancelBtn.textContent = options.cancelText ?? t("dialog.cancel");

    const discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.className = "app-dialog-btn danger";
    discardBtn.textContent = options.discardText ?? t("dialog.unsavedChanges.discard");

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "app-dialog-btn primary";
    saveBtn.textContent = options.saveText ?? t("dialog.unsavedChanges.save");

    actions.append(cancelBtn, discardBtn, saveBtn);
    dialog.append(titleEl, messageEl, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let settled = false;
    const close = (value: UnsavedChangesChoice) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close("cancel");
      } else if (e.key === "Enter") {
        e.preventDefault();
        close("save");
      }
    };

    cancelBtn.onclick = () => close("cancel");
    discardBtn.onclick = () => close("discard");
    saveBtn.onclick = () => close("save");
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close("cancel");
    });
    document.addEventListener("keydown", onKeydown, true);

    saveBtn.focus();
  });
}
