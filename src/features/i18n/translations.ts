// translations.ts - Flat UI string dictionary for the zh/en language switch.
export type Locale = "zh" | "en";

const dictionary = {
  // Menu bar - top-level menu labels
  "menu.file": { zh: "文件", en: "File" },
  "menu.edit": { zh: "编辑", en: "Edit" },
  "menu.view": { zh: "视图", en: "View" },
  "menu.theme": { zh: "主题", en: "Theme" },

  // File menu
  "menu.file.new": { zh: "新建", en: "New" },
  "menu.file.open": { zh: "打开…", en: "Open…" },
  "menu.file.openFolder": { zh: "打开文件夹…", en: "Open Folder…" },
  "menu.file.openFolderByPath": { zh: "按路径打开文件夹…", en: "Open Folder by Path…" },
  "menu.file.save": { zh: "保存", en: "Save" },
  "menu.file.saveAs": { zh: "另存为…", en: "Save As…" },
  "menu.file.exportPdf": { zh: "导出 PDF…", en: "Export PDF…" },
  "menu.file.exportHtml": { zh: "导出 HTML…", en: "Export HTML…" },
  "menu.file.close": { zh: "关闭", en: "Close" },

  // Edit menu
  "menu.edit.undo": { zh: "撤销", en: "Undo" },
  "menu.edit.redo": { zh: "重做", en: "Redo" },
  "menu.edit.cut": { zh: "剪切", en: "Cut" },
  "menu.edit.copy": { zh: "复制", en: "Copy" },
  "menu.edit.paste": { zh: "粘贴", en: "Paste" },
  "menu.edit.selectAll": { zh: "全选", en: "Select All" },

  // View menu
  "menu.view.zoomIn": { zh: "放大", en: "Zoom In" },
  "menu.view.zoomOut": { zh: "缩小", en: "Zoom Out" },
  "menu.view.actualSize": { zh: "实际大小", en: "Actual Size" },
  "menu.view.fullscreen": { zh: "切换全屏", en: "Toggle Full Screen" },
  "menu.view.showHidden": { zh: "显示隐藏文件夹", en: "Show Hidden Folders" },

  // Theme menu
  "menu.theme.light": { zh: "浅色", en: "Light" },
  "menu.theme.dark": { zh: "深色", en: "Dark" },
  "menu.theme.literary": { zh: "文艺", en: "Literary" },
  "menu.theme.newsprint": { zh: "报纸", en: "Newsprint" },
  "menu.theme.academic": { zh: "学术", en: "Academic" },
  "menu.theme.import": { zh: "导入主题…", en: "Import Theme…" },

  // Workspace header / toolbar
  "toolbar.toggleSidebar": { zh: "切换侧栏", en: "Toggle Sidebar" },
  "toolbar.openFolder": { zh: "打开文件夹", en: "Open Folder" },
  "toolbar.save": { zh: "保存", en: "Save" },

  // Sidebar
  "sidebar.workspace": { zh: "工作区", en: "Workspace" },
  "sidebar.resizer": {
    zh: "拖拽调整侧栏宽度，双击复位",
    en: "Drag to resize sidebar, double-click to reset",
  },
  "sidebar.openFolderToStart": { zh: "打开一个文件夹开始使用", en: "Open a folder to start" },

  // Editor
  "editor.splitDivider": {
    zh: "拖拽调整分屏比例，双击复位",
    en: "Drag to resize split view, double-click to reset",
  },

  // Status bar
  "status.noFileSelected": { zh: "未选择文件", en: "No file selected" },
  "status.noWorkspaceOpen": { zh: "未打开工作区", en: "No workspace open" },
  "status.deletedExternally": { zh: "已在外部删除", en: "Deleted externally" },
  "status.externalUpdate": { zh: "外部已更新", en: "External update" },
  "status.unsaved": { zh: "未保存", en: "Unsaved" },
  "status.saving": { zh: "保存中", en: "Saving" },
  "status.saveError": { zh: "保存失败", en: "Save error" },
  "status.saved": { zh: "已保存", en: "Saved" },

  // Relative time
  "time.now": { zh: "刚刚", en: "now" },

  // View mode switch
  "viewMode.group": { zh: "编辑器视图模式", en: "Editor view mode" },
  "viewMode.source": { zh: "源代码", en: "Source" },
  "viewMode.split": { zh: "分屏", en: "Split" },
  "viewMode.previewOnly": { zh: "仅预览", en: "Preview Only" },
  "viewMode.wysiwyg": { zh: "可视化编辑", en: "WYSIWYG" },

  // Activity panel
  "activity.recentChanges": { zh: "最近变更", en: "Recent Changes" },
  "activity.noChanges": { zh: "暂无外部变更", en: "No external changes yet" },

  // Tabs bar
  "tabs.newFile": { zh: "新建文件", en: "New File" },
  "tabs.showHidden": { zh: "显示隐藏的标签", en: "Show hidden tabs" },
  "tabs.noHidden": { zh: "无隐藏标签", en: "No hidden tabs" },
  "tabs.close": { zh: "关闭", en: "Close" },
  "tabs.closeOthers": { zh: "关闭其他标签页", en: "Close Other Tabs" },
  "tabs.closeAll": { zh: "关闭所有标签页", en: "Close All Tabs" },
  "tabs.closeUnmodified": { zh: "关闭未修改标签页", en: "Close Unmodified Tabs" },

  // Workspace tree
  "tree.noMarkdownFiles": { zh: "未找到 Markdown 文件", en: "No Markdown files found" },
  "tree.newFile": { zh: "新建 Markdown 文件", en: "New Markdown File" },
  "tree.newFolder": { zh: "新建文件夹", en: "New Folder" },
  "tree.rename": { zh: "重命名", en: "Rename" },
  "tree.delete": { zh: "删除", en: "Delete" },

  // Window controls
  "window.minimize": { zh: "最小化", en: "Minimize" },
  "window.maximize": { zh: "最大化", en: "Maximize" },
  "window.restore": { zh: "还原", en: "Restore" },
  "window.close": { zh: "关闭", en: "Close" },

  // External update banner
  "banner.fileDeleted": {
    zh: "此文件已在 AMark 外部被删除。",
    en: "This file was deleted outside AMark.",
  },
  "banner.fileChanged": {
    zh: "此文件已在 AMark 外部被修改。",
    en: "This file changed outside AMark.",
  },
  "banner.reload": { zh: "重新加载", en: "Reload" },

  // Dialogs (default button text)
  "dialog.cancel": { zh: "取消", en: "Cancel" },
  "dialog.confirm": { zh: "确定", en: "OK" },

  // App-level dialogs and toasts
  "dialog.openFolderByPath.title": { zh: "按路径打开工作区", en: "Open Workspace by Path" },
  "dialog.openFolderByPath.confirm": { zh: "打开", en: "Open" },
  "toast.openFolderByPath.error": {
    zh: "无法打开该路径，请检查目录是否存在",
    en: "Could not open that path — please check the directory exists",
  },
  "dialog.newFile.title": { zh: "新建 Markdown 文件", en: "New Markdown File" },
  "dialog.newFile.placeholder": { zh: "未命名.md", en: "Untitled.md" },
  "dialog.newFile.confirm": { zh: "创建", en: "Create" },
  "dialog.newFolder.title": { zh: "新建文件夹", en: "New Folder" },
  "dialog.newFolder.placeholder": { zh: "未命名文件夹", en: "Untitled Folder" },
  "dialog.newFolder.confirm": { zh: "创建", en: "Create" },
  "dialog.renameFile.title": { zh: "重命名文件", en: "Rename File" },
  "dialog.renameFile.confirm": { zh: "重命名", en: "Rename" },
  "dialog.renameFolder.title": { zh: "重命名文件夹", en: "Rename Folder" },
  "dialog.renameFolder.confirm": { zh: "重命名", en: "Rename" },
  "dialog.deleteFile.title": { zh: "删除文件", en: "Delete File" },
  "dialog.deleteFile.confirm": { zh: "删除", en: "Delete" },
  "dialog.unsavedChanges.title": { zh: "有未保存的更改", en: "Unsaved Changes" },
  "dialog.unsavedChanges.save": { zh: "保存", en: "Save" },
  "dialog.unsavedChanges.discard": { zh: "丢弃", en: "Discard" },
  "toast.openFile.error": { zh: "无法打开该文件", en: "Could not open that file" },
  "toast.themeImported": { zh: "主题导入成功", en: "Theme imported" },
  "toast.themeImportFailed": { zh: "主题导入失败", en: "Theme import failed" },
  "toast.pdfExported": { zh: "PDF 导出成功", en: "PDF exported" },
  "toast.pdfExportFailed": { zh: "PDF 导出失败", en: "PDF export failed" },
  "file.dialog.markdown": { zh: "Markdown 文件", en: "Markdown" },
  "file.dialog.allFiles": { zh: "所有文件", en: "All Files" },
} satisfies Record<string, Record<Locale, string>>;

export type TranslationKey = keyof typeof dictionary;

export function translate(key: TranslationKey, locale: Locale): string {
  return dictionary[key][locale];
}

export function deleteFileMessage(name: string, locale: Locale): string {
  return locale === "zh"
    ? `确定要删除“${name}”吗？此操作无法撤销。`
    : `Are you sure you want to delete "${name}"? This action cannot be undone.`;
}

export function unsavedChangesMessage(name: string, locale: Locale): string {
  return locale === "zh"
    ? `“${name}” 有未保存的更改，是否保存？`
    : `"${name}" has unsaved changes. Do you want to save it?`;
}

export function unsavedChangesCountMessage(count: number, locale: Locale): string {
  return locale === "zh"
    ? `有 ${count} 个文件未保存的更改，是否保存？`
    : `There are ${count} files with unsaved changes. Do you want to save them?`;
}
