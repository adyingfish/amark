// App.tsx - React application shell for the Phase 2 workspace.
import {
  type FormEvent as ReactFormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ActivityPanel } from "./components/ActivityPanel";
import { ExternalUpdateBanner } from "./components/ExternalUpdateBanner";
import { MenuBar } from "./components/MenuBar";
import { SaveButton } from "./components/SaveButton";
import { StatusBar } from "./components/StatusBar";
import { TabsBar } from "./components/TabsBar";
import { ViewModeSwitch } from "./components/ViewModeSwitch";
import { WindowControls } from "./components/WindowControls";
import { WorkspaceTreeView } from "./components/WorkspaceTreeView";
import type { AgentState } from "./app-utils";
import { t as translateStatic, useI18n } from "../features/i18n/i18n-context";
import { languageStore } from "../features/i18n/language-store";
import {
  deleteFileMessage,
  unsavedChangesCountMessage,
  unsavedChangesMessage,
} from "../features/i18n/translations";
import { createMilkdownAdapter } from "../features/editor/milkdown-adapter";
import type { EditorAdapter } from "../features/editor/editor-adapter";
import { workspaceStore } from "../features/workspace/workspace-store";
import type { WorkspaceFileNode, WorkspaceState } from "../features/workspace/workspace-types";
import {
  createDirectoryInTree,
  createFileInTree,
  deleteFileInTree,
  newUntitledFile,
  openFileFromTree,
  openWorkspaceByPath,
  openWorkspaceFolder,
  renameDirectoryInTree,
  renameFileInTree,
  setupWorkspaceListeners,
  toggleShowHiddenFiles,
} from "../features/workspace/workspace-controller";
import {
  isDescendantPath,
  isPathWithinRoot,
  resolveLocalMarkdownLink,
  rewriteDescendantPath,
} from "../features/workspace/workspace-utils";
import { translateWorkspaceError } from "../features/workspace/workspace-errors";
import { documentStore } from "../features/document/document-store";
import {
  reloadDocumentFromDisk,
  saveActiveDocument,
  saveActiveDocumentAs,
  saveDocument,
  updateDocumentContent,
} from "../features/document/document-controller";
import { tabsStore } from "../features/tabs/tabs-store";
import { activityStore } from "../features/activity/activity-store";
import type { RecentChangedFile } from "../features/workspace/workspace-types";
import { applyTheme, loadSavedTheme } from "../themes/theme-manager";
import { setupKeyboardShortcuts } from "../ui/keyboard-shortcuts";
import { setupSplitDivider, type SplitDividerHandle } from "../ui/split-divider";
import { setupSidebarResizer, type SidebarResizerHandle } from "../ui/sidebar-resizer";
import { setupSyncScroll, type SyncScrollHandle } from "../ui/sync-scroll";
import { confirmDialog, confirmUnsavedChanges, promptInput } from "../ui/dialog";
import {
  findLinkAtPosition,
  isOpenLinkModifier,
  openExternalLink,
} from "../services/external-link";
import type { EditorViewMode } from "../ui/view-mode-switch";

interface LaunchFile {
  path: string;
  dir: string | null;
}

interface ThemeResult {
  name: string;
  css: string;
}

type ToastKind = "success" | "error";

const VIEW_MODE_STORAGE_KEY = "amark-view-mode";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "amark-sidebar-collapsed";
// Preview is read-only, so a short delay here is imperceptible; keeps Milkdown
// from re-rendering on every keystroke while typing in the source view.
const RICH_TEXT_PREVIEW_SYNC_DEBOUNCE_MS = 200;

const subscribeTabs = (onChange: () => void) => tabsStore.subscribe(onChange);
const subscribeDocuments = (onChange: () => void) => documentStore.subscribe(onChange);

function loadSavedViewMode(): EditorViewMode {
  const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  if (saved === "preview") return "wysiwyg";
  if (saved === "source" || saved === "wysiwyg" || saved === "split" || saved === "preview-only") {
    return saved;
  }
  return "wysiwyg";
}

function loadSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function App(): ReactElement {
  const { locale, t } = useI18n();
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => workspaceStore.getState());
  const activeTabPath = useSyncExternalStore(subscribeTabs, () => tabsStore.getActiveTabPath());
  const [recentChanges, setRecentChanges] = useState<RecentChangedFile[]>(() => [
    ...activityStore.getRecentChanges(),
  ]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const [viewMode, setViewMode] = useState<EditorViewMode>(loadSavedViewMode);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; visible: boolean } | null>(
    null,
  );
  const [agentState, setAgentState] = useState<AgentState>("idle");

  const editorRef = useRef<EditorAdapter | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorWrapperRef = useRef<HTMLDivElement | null>(null);
  const sourceViewRef = useRef<HTMLTextAreaElement | null>(null);
  const editorPanesRef = useRef<HTMLDivElement | null>(null);
  const splitDividerRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarResizerRef = useRef<HTMLDivElement | null>(null);
  const splitDividerHandleRef = useRef<SplitDividerHandle | null>(null);
  const syncScrollHandleRef = useRef<SyncScrollHandle | null>(null);
  const sidebarResizerHandleRef = useRef<SidebarResizerHandle | null>(null);
  const activePathRef = useRef<string | null>(workspace.activeFilePath);
  const previousActiveFilePathRef = useRef<string | null>(workspace.activeFilePath);
  const viewModeRef = useRef<EditorViewMode>(viewMode);
  const richTextSyncTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastRemoveTimerRef = useRef<number | null>(null);
  const agentCooldownTimerRef = useRef<number | null>(null);
  const agentIdleTimerRef = useRef<number | null>(null);

  activePathRef.current = workspace.activeFilePath;
  viewModeRef.current = viewMode;

  const activePath = workspace.activeFilePath;
  const activeDocument = useSyncExternalStore(subscribeDocuments, () =>
    activePath ? documentStore.getDocument(activePath) : undefined,
  );
  const hasDocument = activeTabPath !== null;

  const showToast = useCallback((message: string, kind: ToastKind): void => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    if (toastRemoveTimerRef.current !== null) window.clearTimeout(toastRemoveTimerRef.current);

    setToast({ message, kind, visible: true });
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current ? { ...current, visible: false } : null));
      toastRemoveTimerRef.current = window.setTimeout(() => setToast(null), 220);
    }, 3000);
  }, []);

  const markAgentActivity = useCallback((): void => {
    setAgentState("active");

    if (agentCooldownTimerRef.current !== null) window.clearTimeout(agentCooldownTimerRef.current);
    if (agentIdleTimerRef.current !== null) window.clearTimeout(agentIdleTimerRef.current);

    agentCooldownTimerRef.current = window.setTimeout(() => {
      setAgentState("cooldown");
    }, 3000);

    agentIdleTimerRef.current = window.setTimeout(() => {
      setAgentState("idle");
    }, 5000);
  }, []);

  const expandWorkspaceTopLevel = useCallback((): void => {
    const rootPath = workspaceStore.getRootPath();
    if (!rootPath) return;
    setExpandedFolders((current) => {
      const next = new Set(current);
      next.add(rootPath);
      return next;
    });
  }, []);

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    const success = await openWorkspaceFolder();
    if (success) expandWorkspaceTopLevel();
  }, [expandWorkspaceTopLevel]);

  const handleOpenFolderByPath = useCallback(async (): Promise<void> => {
    const path = await promptInput({
      title: t("dialog.openFolderByPath.title"),
      placeholder: String.raw`\\wsl.localhost\Ubuntu-24.04\home\you\project`,
      confirmText: t("dialog.openFolderByPath.confirm"),
    });
    if (!path) return;

    const success = await openWorkspaceByPath(path);
    if (success) {
      expandWorkspaceTopLevel();
    } else {
      showToast(t("toast.openFolderByPath.error"), "error");
    }
  }, [expandWorkspaceTopLevel, showToast, t]);

  const handleOpenFile = useCallback(async (): Promise<void> => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: t("file.dialog.markdown"), extensions: ["md", "markdown", "mdown", "mkd"] },
        { name: t("file.dialog.allFiles"), extensions: ["*"] },
      ],
    });
    if (typeof selected !== "string") return;

    const rootPath = workspaceStore.getRootPath();
    if (rootPath && !isPathWithinRoot(rootPath, selected)) {
      invoke("open_path_in_new_window", { path: selected }).catch((error) => {
        console.error("Failed to open file in a new window:", error);
        showToast(t("toast.openFile.error"), "error");
      });
      return;
    }

    const fileName = selected.split(/[/\\]/).pop() ?? selected;
    await openFileFromTree(selected, fileName);
  }, [showToast, t]);

  const handleViewModeChange = useCallback((mode: EditorViewMode): void => {
    setViewMode((current) => {
      if (current === mode) return current;
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
      return mode;
    });
  }, []);

  const handleToggleSidebar = useCallback((): void => {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const handleSourceInput = useCallback((event: ReactFormEvent<HTMLTextAreaElement>): void => {
    const active = activePathRef.current;
    if (!active) return;
    updateDocumentContent(active, event.currentTarget.value);
  }, []);

  const handleSourceLinkClick = useCallback((event: ReactMouseEvent<HTMLTextAreaElement>): void => {
    const source = sourceViewRef.current;
    if (!source || !isOpenLinkModifier(event.nativeEvent)) return;

    const url = findLinkAtPosition(source.value, source.selectionStart);
    if (!url) return;

    event.preventDefault();
    openExternalLink(url);
  }, []);

  const openLocalMarkdownLink = useCallback(
    (href: string): void => {
      const active = activePathRef.current;
      if (!active || active.startsWith("untitled://")) return;

      const targetPath = resolveLocalMarkdownLink(active, href);
      if (!targetPath) return;

      const rootPath = workspaceStore.getRootPath();
      if (rootPath && isPathWithinRoot(rootPath, targetPath)) {
        const fileName = targetPath.split(/[/\\]/).pop() ?? targetPath;
        openFileFromTree(targetPath, fileName);
        return;
      }

      invoke("open_path_in_new_window", { path: targetPath }).catch((error) => {
        console.error("Failed to open linked file in a new window:", error);
        showToast(t("toast.openFile.error"), "error");
      });
    },
    [showToast, t],
  );

  const handlePreviewLinkClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      const url = anchor?.getAttribute("href");
      if (!url) return;

      if (viewModeRef.current !== "wysiwyg") {
        event.preventDefault();
        event.stopPropagation();
      }

      if (!isOpenLinkModifier(event.nativeEvent)) return;

      event.preventDefault();
      event.stopPropagation();

      if (/^https?:\/\//i.test(url)) {
        openExternalLink(url);
        return;
      }

      openLocalMarkdownLink(url);
    },
    [openLocalMarkdownLink],
  );

  const applyMarkdownToRichText = useCallback((markdown: string): void => {
    const editor = editorRef.current;
    if (editor && editor.getContent() !== markdown) {
      editor.setContent(markdown);
    }
  }, []);

  const applyMarkdownToSourceView = useCallback((markdown: string): void => {
    const source = sourceViewRef.current;
    const mode = viewModeRef.current;
    if ((mode === "source" || mode === "split") && source && source.value !== markdown) {
      source.value = markdown;
    }
  }, []);

  const cancelPendingRichTextSync = useCallback((): void => {
    if (richTextSyncTimerRef.current !== null) {
      window.clearTimeout(richTextSyncTimerRef.current);
      richTextSyncTimerRef.current = null;
    }
  }, []);

  const scheduleRichTextSync = useCallback(
    (markdown: string): void => {
      cancelPendingRichTextSync();
      richTextSyncTimerRef.current = window.setTimeout(() => {
        richTextSyncTimerRef.current = null;
        applyMarkdownToRichText(markdown);
      }, RICH_TEXT_PREVIEW_SYNC_DEBOUNCE_MS);
    },
    [applyMarkdownToRichText, cancelPendingRichTextSync],
  );

  // Immediate, full sync: used for document/mode switches, where any delay
  // would flash stale content. Content-edit-driven syncing of the read-only
  // rich-text preview goes through scheduleRichTextSync instead.
  const syncEditorContent = useCallback((): void => {
    const active = workspaceStore.getActiveFilePath();
    if (!active) return;

    const document = documentStore.getDocument(active);
    if (!document || !document.isLoaded) return;

    cancelPendingRichTextSync();
    if (viewModeRef.current !== "source") {
      applyMarkdownToRichText(document.markdown);
    }
    applyMarkdownToSourceView(document.markdown);
  }, [applyMarkdownToRichText, applyMarkdownToSourceView, cancelPendingRichTextSync]);

  // Reads the active path straight from workspaceStore (not the `workspace`
  // state) so this runs identically whether it's triggered by an active-file
  // switch or by a raw document-store event. Same previousActiveFilePathRef
  // switch check and debounce scheduling as before.
  const syncActiveDocumentFromStores = useCallback((): void => {
    const activeFilePath = workspaceStore.getActiveFilePath();
    const isDocumentSwitch = previousActiveFilePathRef.current !== activeFilePath;
    previousActiveFilePathRef.current = activeFilePath;

    if (isDocumentSwitch) {
      syncEditorContent();
      return;
    }

    // Same document, content changed (typing). Keep the source view caught
    // up immediately, but debounce pushing it into the read-only rich-text
    // preview so fast typing doesn't re-render Milkdown on every keystroke.
    const document = activeFilePath ? documentStore.getDocument(activeFilePath) : undefined;
    if (!document || !document.isLoaded) return;

    applyMarkdownToSourceView(document.markdown);
    if (viewModeRef.current !== "source") {
      scheduleRichTextSync(document.markdown);
    }
  }, [syncEditorContent, applyMarkdownToSourceView, scheduleRichTextSync]);

  const handleTabClick = useCallback((filePath: string): void => {
    tabsStore.activateTab(filePath);
    workspaceStore.setActiveFilePath(filePath);
  }, []);

  const closeTabsNow = useCallback((filePaths: string[]): void => {
    tabsStore.closeTabs(filePaths);
    for (const path of filePaths) {
      documentStore.unloadDocument(path);
    }
  }, []);

  // Ask Save / Discard / Cancel for the dirty paths among `filePaths`. Returns
  // false if the user cancelled (or a save failed/was itself cancelled), in
  // which case the close should not proceed.
  const confirmCloseDirtyPaths = useCallback(
    async (filePaths: string[]): Promise<boolean> => {
      const dirtyPaths = filePaths.filter((path) => documentStore.isDirty(path));
      if (dirtyPaths.length === 0) return true;

      const message =
        dirtyPaths.length === 1
          ? unsavedChangesMessage(
              documentStore.getDocument(dirtyPaths[0])?.fileName ?? dirtyPaths[0],
              locale,
            )
          : unsavedChangesCountMessage(dirtyPaths.length, locale);

      const choice = await confirmUnsavedChanges({
        title: t("dialog.unsavedChanges.title"),
        message,
      });
      if (choice === "cancel") return false;

      if (choice === "save") {
        for (const path of dirtyPaths) {
          if (!(await saveDocument(path))) return false;
        }
      }
      return true;
    },
    [locale, t],
  );

  const handleTabClose = useCallback(
    (filePath: string): void => {
      void (async () => {
        if (await confirmCloseDirtyPaths([filePath])) closeTabsNow([filePath]);
      })();
    },
    [confirmCloseDirtyPaths, closeTabsNow],
  );

  const handleTabsClose = useCallback(
    (filePaths: string[]): void => {
      if (filePaths.length === 0) return;
      void (async () => {
        if (await confirmCloseDirtyPaths(filePaths)) closeTabsNow(filePaths);
      })();
    },
    [confirmCloseDirtyPaths, closeTabsNow],
  );

  const handleToggleFolder = useCallback((folderPath: string): void => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) {
        next.delete(folderPath);
        // Forget descendants' expansion too, so re-expanding this folder
        // later starts fresh instead of resurrecting stale child state.
        for (const path of next) {
          if (isDescendantPath(path, folderPath)) next.delete(path);
        }
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const handleTreeNewFile = useCallback(
    async (parentPath: string): Promise<void> => {
      const name = await promptInput({
        title: t("dialog.newFile.title"),
        placeholder: t("dialog.newFile.placeholder"),
        confirmText: t("dialog.newFile.confirm"),
      });
      if (name === null) return;

      try {
        const newPath = await createFileInTree(parentPath, name);
        setExpandedFolders((current) => {
          const next = new Set(current);
          next.add(parentPath);
          return next;
        });
        const newName = newPath.split(/[/\\]/).pop() ?? name;
        await openFileFromTree(newPath, newName);
      } catch (error) {
        showToast(translateWorkspaceError(error, locale), "error");
      }
    },
    [locale, showToast, t],
  );

  const handleTreeNewFolder = useCallback(
    async (parentPath: string): Promise<void> => {
      const name = await promptInput({
        title: t("dialog.newFolder.title"),
        placeholder: t("dialog.newFolder.placeholder"),
        confirmText: t("dialog.newFolder.confirm"),
      });
      if (name === null) return;

      try {
        const newPath = await createDirectoryInTree(parentPath, name);
        setExpandedFolders((current) => {
          const next = new Set(current);
          next.add(parentPath);
          next.add(newPath);
          return next;
        });
      } catch (error) {
        showToast(translateWorkspaceError(error, locale), "error");
      }
    },
    [locale, showToast, t],
  );

  const handleTreeRename = useCallback(
    async (path: string, name: string): Promise<void> => {
      const newName = await promptInput({
        title: t("dialog.renameFile.title"),
        initialValue: name,
        confirmText: t("dialog.renameFile.confirm"),
      });
      if (newName === null || newName === name) return;

      try {
        await renameFileInTree(path, newName);
      } catch (error) {
        showToast(translateWorkspaceError(error, locale), "error");
      }
    },
    [locale, showToast, t],
  );

  const handleTreeRenameFolder = useCallback(
    async (path: string, name: string): Promise<void> => {
      const newName = await promptInput({
        title: t("dialog.renameFolder.title"),
        initialValue: name,
        confirmText: t("dialog.renameFolder.confirm"),
      });
      if (newName === null || newName === name) return;

      try {
        const newPath = await renameDirectoryInTree(path, newName);
        setExpandedFolders((current) => {
          const updated = new Set<string>();
          for (const folder of current) {
            if (folder === path) {
              updated.add(newPath);
              continue;
            }
            updated.add(rewriteDescendantPath(folder, path, newPath) ?? folder);
          }
          return updated;
        });
      } catch (error) {
        showToast(translateWorkspaceError(error, locale), "error");
      }
    },
    [locale, showToast, t],
  );

  const handleTreeDelete = useCallback(
    async (path: string, name: string): Promise<void> => {
      const confirmed = await confirmDialog({
        title: t("dialog.deleteFile.title"),
        message: deleteFileMessage(name, locale),
        confirmText: t("dialog.deleteFile.confirm"),
        danger: true,
      });
      if (!confirmed) return;

      try {
        await deleteFileInTree(path);
      } catch (error) {
        showToast(translateWorkspaceError(error, locale), "error");
      }
    },
    [locale, showToast, t],
  );

  const handleRecentFileClick = useCallback((filePath: string): void => {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    openFileFromTree(filePath, fileName);
  }, []);

  const buildExportDocument = useCallback(async (): Promise<string | null> => {
    const editor = editorRef.current;
    if (!editor) return null;

    const active = workspaceStore.getActiveFilePath();
    if (!active) return null;

    const document = documentStore.getDocument(active);
    if (document && editor.getContent() !== document.markdown) {
      editor.setContent(document.markdown);
    }

    const bodyHtml = editor.getHTML();
    const title = (active.split(/[/\\]/).pop() || "document").replace(/\.md$/i, "");
    const { buildHtmlDocument } = await import("../features/export/export-document");
    return buildHtmlDocument(bodyHtml, title);
  }, []);

  const handleExport = useCallback(
    async (format: "html" | "pdf"): Promise<void> => {
      const doc = await buildExportDocument();
      if (!doc) return;

      if (format === "html") {
        await invoke("export_html", { html: doc });
        return;
      }

      let handledNatively = false;
      try {
        handledNatively = await invoke<boolean>("export_pdf", { html: doc });
      } catch {
        handledNatively = false;
      }

      if (!handledNatively) {
        const { printHtmlDocument } = await import("../features/export/export-document");
        printHtmlDocument(doc);
      }
    },
    [buildExportDocument],
  );

  const importCustomTheme = useCallback(async (): Promise<void> => {
    try {
      const result = await invoke<ThemeResult | null>("load_custom_theme");
      if (!result) return;
      applyTheme(`custom:${result.name}`, result.css);
      showToast(t("toast.themeImported"), "success");
    } catch (error) {
      console.error("Failed to import custom theme:", error);
      showToast(t("toast.themeImportFailed"), "error");
    }
  }, [showToast, t]);

  const appActionsRef = useRef({
    handleOpenFolder,
    handleOpenFolderByPath,
    handleOpenFile,
    saveActiveDocument,
    saveActiveDocumentAs,
    handleExport,
    importCustomTheme,
    showToast,
  });
  appActionsRef.current = {
    handleOpenFolder,
    handleOpenFolderByPath,
    handleOpenFile,
    saveActiveDocument,
    saveActiveDocumentAs,
    handleExport,
    importCustomTheme,
    showToast,
  };

  useEffect(() => {
    const savedTheme = loadSavedTheme();
    applyTheme(savedTheme);
    if (savedTheme.startsWith("custom:")) {
      const fileName = savedTheme.slice(7);
      invoke<string | null>("load_theme_css", { fileName }).then((css) => {
        if (css) applyTheme(savedTheme, css);
      });
    }
  }, []);

  useEffect(() => {
    const unsubscribeWorkspace = workspaceStore.subscribe(() => {
      setWorkspace({ ...workspaceStore.getState() });
    });
    const unsubscribeActivity = activityStore.subscribe(() => {
      setRecentChanges([...activityStore.getRecentChanges()]);
      markAgentActivity();
    });

    return () => {
      unsubscribeWorkspace();
      unsubscribeActivity();
      cancelPendingRichTextSync();
    };
  }, [markAgentActivity, cancelPendingRichTextSync]);

  useEffect(() => {
    if (activeTabPath !== workspace.activeFilePath) {
      workspaceStore.setActiveFilePath(activeTabPath);
    }
  }, [activeTabPath, workspace.activeFilePath]);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    let disposed = false;
    const editor = createMilkdownAdapter();
    editorRef.current = editor;

    editor.mount(host).then(() => {
      if (disposed) {
        editor.unmount();
        return;
      }
      editor.onChange((markdown) => {
        const active = activePathRef.current;
        if (active) updateDocumentContent(active, markdown);
      });
      editor.setEditable(viewModeRef.current === "wysiwyg");
      syncEditorContent();
      void openLaunchFiles(expandWorkspaceTopLevel);
    });

    return () => {
      disposed = true;
      editor.unmount();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [expandWorkspaceTopLevel, syncEditorContent]);

  useEffect(() => {
    const panes = editorPanesRef.current;
    const divider = splitDividerRef.current;
    if (panes && divider) {
      splitDividerHandleRef.current = setupSplitDivider(panes, divider);
    }

    const source = sourceViewRef.current;
    const rich = editorHostRef.current;
    if (source && rich) {
      syncScrollHandleRef.current = setupSyncScroll(source, rich);
    }

    const sidebar = sidebarRef.current;
    const resizer = sidebarResizerRef.current;
    if (sidebar && resizer) {
      sidebarResizerHandleRef.current = setupSidebarResizer(sidebar, resizer);
    }

    return () => {
      splitDividerHandleRef.current?.destroy();
      syncScrollHandleRef.current?.destroy();
      sidebarResizerHandleRef.current?.destroy();
      splitDividerHandleRef.current = null;
      syncScrollHandleRef.current = null;
      sidebarResizerHandleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cleanupShortcuts = setupKeyboardShortcuts();
    let cleanupWorkspace: (() => void) | null = null;
    let cancelled = false;

    setupWorkspaceListeners().then((cleanup) => {
      if (cancelled) {
        cleanup();
      } else {
        cleanupWorkspace = cleanup;
      }
    });

    return () => {
      cancelled = true;
      cleanupShortcuts();
      cleanupWorkspace?.();
    };
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    let allowClose = false;

    appWindow
      .onCloseRequested(async (event) => {
        if (allowClose) return;

        try {
          const dirtyPaths = documentStore
            .getAllDocuments()
            .filter((doc) => documentStore.isDirty(doc.filePath))
            .map((doc) => doc.filePath);
          if (dirtyPaths.length === 0) return;

          event.preventDefault();

          const currentLocale = languageStore.getLocale();
          const message =
            dirtyPaths.length === 1
              ? unsavedChangesMessage(
                  documentStore.getDocument(dirtyPaths[0])?.fileName ?? dirtyPaths[0],
                  currentLocale,
                )
              : unsavedChangesCountMessage(dirtyPaths.length, currentLocale);
          const choice = await confirmUnsavedChanges({
            title: translateStatic("dialog.unsavedChanges.title"),
            message,
          });
          if (choice === "cancel") return;

          if (choice === "save") {
            for (const path of dirtyPaths) {
              if (!(await saveDocument(path))) return;
            }
          }

          allowClose = true;
          await appWindow.close();
        } catch (error) {
          // Never let an unexpected error here leave the window stuck open —
          // fall back to closing rather than blocking the user from quitting.
          console.error("onCloseRequested handler failed, closing anyway", error);
          allowClose = true;
          await appWindow.destroy();
        }
      })
      .then((cleanup) => {
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

  useEffect(() => {
    const sync = (active: boolean) => {
      editorWrapperRef.current?.classList.toggle("link-modifier-active", active);
    };
    const onKey = (event: KeyboardEvent) => sync(isOpenLinkModifier(event));
    const onBlur = () => sync(false);

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    let cancelled = false;
    const register = async <T,>(event: string, handler: (payload: T) => void) => {
      const unlisten = await listen<T>(event, (e) => handler(e.payload));
      if (cancelled) {
        unlisten();
      } else {
        unlistens.push(unlisten);
      }
    };

    void register("menu-open-folder", () => appActionsRef.current.handleOpenFolder());
    void register("menu-open-folder-path", () => appActionsRef.current.handleOpenFolderByPath());
    void register("menu-open", () => appActionsRef.current.handleOpenFile());
    void register("menu-new", () => newUntitledFile());
    void register("menu-save", () => appActionsRef.current.saveActiveDocument());
    void register("menu-save-as", () => appActionsRef.current.saveActiveDocumentAs());
    void register("menu-export-html", () => appActionsRef.current.handleExport("html"));
    void register("menu-export-pdf", () => appActionsRef.current.handleExport("pdf"));
    void register("menu-import-theme", () => appActionsRef.current.importCustomTheme());
    void register("view-toggle-hidden-files", () => {
      void toggleShowHiddenFiles();
    });
    void register("pdf-export-done", () =>
      appActionsRef.current.showToast(translateStatic("toast.pdfExported"), "success"),
    );
    void register("pdf-export-error", () =>
      appActionsRef.current.showToast(translateStatic("toast.pdfExportFailed"), "error"),
    );
    void register<string>("agent-activity", (state) => {
      if (state === "active" || state === "cooldown" || state === "idle") {
        setAgentState(state);
      }
    });
    void register<string>("set-theme", (themeName) => {
      if (themeName.startsWith("custom:")) {
        const fileName = themeName.slice(7);
        invoke<string | null>("load_theme_css", { fileName }).then((css) => {
          if (css) applyTheme(themeName, css);
        });
      } else {
        applyTheme(themeName);
      }
    });
    void register<string>("set-custom-css", (css) => {
      const themeName = loadSavedTheme();
      if (themeName.startsWith("custom:")) applyTheme(themeName, css);
    });

    return () => {
      cancelled = true;
      for (const unlisten of unlistens) unlisten();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.setEditable(viewMode === "wysiwyg");
    syncEditorContent();

    if (viewMode === "split") {
      requestAnimationFrame(() => syncScrollHandleRef.current?.sync());
    }

    if (!hasDocument) return;
    if (viewMode === "source" || viewMode === "split") {
      sourceViewRef.current?.focus();
    } else if (viewMode === "wysiwyg") {
      editorRef.current?.focus();
    }
  }, [hasDocument, syncEditorContent, viewMode]);

  // Active-file switches go through workspaceStore, which doesn't touch
  // documentStore when the target tab is already loaded, so this stays keyed
  // on workspace.activeFilePath.
  useEffect(() => {
    syncActiveDocumentFromStores();
  }, [workspace.activeFilePath, syncActiveDocumentFromStores]);

  // Document edits (typing, save status, external reloads) don't produce
  // JSX, so consume the store directly here instead of relaying through
  // React state just to re-trigger this effect.
  useEffect(() => {
    return documentStore.subscribe(syncActiveDocumentFromStores);
  }, [syncActiveDocumentFromStores]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (toastRemoveTimerRef.current !== null) window.clearTimeout(toastRemoveTimerRef.current);
      if (agentCooldownTimerRef.current !== null)
        window.clearTimeout(agentCooldownTimerRef.current);
      if (agentIdleTimerRef.current !== null) window.clearTimeout(agentIdleTimerRef.current);
    };
  }, []);

  const rootNode = useMemo<WorkspaceFileNode | null>(() => {
    if (!workspace.rootPath) return null;
    return {
      path: workspace.rootPath,
      name: workspace.name ?? workspace.rootPath,
      kind: "directory",
      children: workspace.files,
    };
  }, [workspace.files, workspace.name, workspace.rootPath]);

  return (
    <div className="app-container">
      <div className="workspace-header" data-tauri-drag-region>
        <span className="workspace-name" data-tauri-drag-region>
          AMark
        </span>
        <MenuBar />
        <span className="workspace-actions-left">
          <Button
            id="btn-toggle-sidebar"
            type="button"
            variant="ghost"
            size="icon"
            title={t("toolbar.toggleSidebar")}
            aria-expanded={!sidebarCollapsed}
            className={cn(sidebarCollapsed && "active")}
            onClick={handleToggleSidebar}
          >
            <PanelLeft className="lucide-icon" size={16} aria-hidden="true" />
          </Button>
          <Button
            id="btn-open-folder"
            type="button"
            variant="ghost"
            size="icon"
            title={t("toolbar.openFolder")}
            onClick={handleOpenFolder}
          >
            <FolderOpen className="lucide-icon" size={16} aria-hidden="true" />
          </Button>
          <SaveButton />
        </span>
        <span className="workspace-actions">
          <ViewModeSwitch mode={viewMode} onChange={handleViewModeChange} />
          <WindowControls />
        </span>
      </div>

      <div className="main-container">
        <aside ref={sidebarRef} className={cn("sidebar", sidebarCollapsed && "collapsed")}>
          <div className="sidebar-header" title={workspace.rootPath ?? ""}>
            {workspace.name ?? t("sidebar.workspace")}
          </div>
          <div className="file-tree-container">
            {rootNode ? (
              <WorkspaceTreeView
                files={[rootNode]}
                activeFilePath={workspace.activeFilePath}
                rootPath={workspace.rootPath}
                expandedFolders={expandedFolders}
                onFileClick={openFileFromTree}
                onToggleFolder={handleToggleFolder}
                onNewFile={handleTreeNewFile}
                onNewFolder={handleTreeNewFolder}
                onRenameFile={handleTreeRename}
                onRenameFolder={handleTreeRenameFolder}
                onDeleteFile={handleTreeDelete}
              />
            ) : (
              <div className="workspace-empty">
                <p>{t("sidebar.openFolderToStart")}</p>
                <Button id="btn-sidebar-open" type="button" onClick={handleOpenFolder}>
                  {t("toolbar.openFolder")}
                </Button>
              </div>
            )}
          </div>
          <ActivityPanel changes={recentChanges} onFileClick={handleRecentFileClick} />
        </aside>
        <div
          ref={sidebarResizerRef}
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          title={t("sidebar.resizer")}
        />
        <div className="editor-area">
          <div className="tabs-bar-container">
            <TabsBar
              onTabClick={handleTabClick}
              onTabClose={handleTabClose}
              onTabsClose={handleTabsClose}
              onNewFile={() => newUntitledFile()}
            />
          </div>
          <div
            ref={editorWrapperRef}
            className={cn("editor-wrapper", `mode-${viewMode}`, !hasDocument && "no-document")}
          >
            <ExternalUpdateBanner document={activeDocument} onReload={reloadDocumentFromDisk} />
            <div ref={editorPanesRef} className="editor-panes">
              <textarea
                ref={sourceViewRef}
                className="source-view"
                spellCheck={false}
                wrap="soft"
                onInput={handleSourceInput}
                onClick={handleSourceLinkClick}
              />
              <div
                ref={splitDividerRef}
                className="split-divider"
                role="separator"
                aria-orientation="vertical"
                title={t("editor.splitDivider")}
              />
              <div
                ref={editorHostRef}
                id="editor"
                className="editor-host"
                onClickCapture={handlePreviewLinkClick}
              />
            </div>
            <div className="empty-state" />
          </div>
        </div>
      </div>

      <StatusBar agentState={agentState} />
      <div className="toast-host" aria-live="polite">
        {toast ? (
          <div className={cn("toast", `toast-${toast.kind}`, toast.visible && "visible")}>
            {toast.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

async function openLaunchFiles(expandWorkspaceTopLevel: () => void): Promise<void> {
  try {
    const files = await invoke<LaunchFile[]>("take_launch_files");
    if (files.length === 0) return;

    const workspaceDir = files[0]?.dir ?? null;
    if (workspaceDir && (await openWorkspaceByPath(workspaceDir))) {
      expandWorkspaceTopLevel();
    }

    for (const file of files) {
      const fileName = file.path.split(/[/\\]/).pop() ?? file.path;
      await openFileFromTree(file.path, fileName);
    }
  } catch (error) {
    console.error("Failed to open launch files:", error);
  }
}
