import type { Commands, DesktopEvents, MenuEvent, Reply } from "../shared/desktop";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  screen,
  session,
  shell,
} from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createWorkspace, WorkspaceError, type WorkspaceHandlers } from "./workspace.js";
import { isAppPage, launchFilePath, registerProtocols, rendererURL } from "./protocols.js";
import {
  readWindowStates,
  saveWindowState,
  restoreBounds,
  loadLegacyPreferences,
} from "./preferences.js";

type Workspace = ReturnType<typeof createWorkspace>;
interface WindowState {
  win: BrowserWindow;
  ws: Workspace;
  label: number;
  launch: Commands["take_launch_files"]["returns"];
  closeListener: boolean;
  approved: boolean;
}
type ShellCommand = Exclude<keyof Commands, keyof Workspace["commands"]>;
type ShellHandlers = {
  [K in ShellCommand]: (
    state: WindowState,
    args: Commands[K]["args"],
  ) => Commands[K]["returns"] | Promise<Commands[K]["returns"]>;
};

const entry = rendererURL(process.env.ELECTRON_RENDERER_URL, app.isPackaged);
const windows = new Map<number, WindowState>();
const assets = new Map<string, Workspace>();
const printJobs = new Map<string, string>();
const earlyFiles: string[] = [];
let windowStates: ReturnType<typeof readWindowStates>;
let legacyPreferences = {};
let initialized = false;
let quitting = false;

protocol.registerSchemesAsPrivileged(
  ["amark", "amark-asset", "amark-print"].map((scheme) => ({
    scheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  })),
);
const themeDirectory = () => path.join(app.getPath("home"), ".amark", "themes");
const markdownFilters = [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] }];
const menuEvents = new Set<MenuEvent>([
  "menu-open",
  "menu-open-folder",
  "menu-open-folder-path",
  "menu-save",
  "menu-save-as",
  "menu-find",
  "menu-find-workspace",
  "menu-export-pdf",
  "menu-export-html",
  "menu-import-theme",
  "view-toggle-hidden-files",
]);
const themes = new Set(["light", "dark", "literary", "reading", "newsprint", "academic"]);
const edits = new Map<string, "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll">([
  ["edit-undo", "undo"],
  ["edit-redo", "redo"],
  ["edit-cut", "cut"],
  ["edit-copy", "copy"],
  ["edit-paste", "paste"],
  ["edit-select-all", "selectAll"],
]);

function emit<K extends keyof DesktopEvents>(
  win: BrowserWindow,
  name: K,
  ...payload: DesktopEvents[K] extends void ? [] : [DesktopEvents[K]]
) {
  if (!win.isDestroyed()) win.webContents.send("amark:event:" + name, ...payload);
}
function lockNavigation(contents: Electron.WebContents) {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
}
function client(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  const owner = windows.get(event.sender.id);
  return owner &&
    event.senderFrame &&
    event.senderFrame === event.sender.mainFrame &&
    isAppPage(event.senderFrame.url, entry)
    ? owner
    : null;
}
function parseFiles(argv: string[], cwd: string) {
  return argv
    .slice(process.defaultApp ? 2 : 1)
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => launchFilePath(arg, cwd))
    .filter((file): file is string => {
      try {
        return file !== null && fs.statSync(file).isFile();
      } catch {
        return false;
      }
    });
}
function newLabel() {
  const labels = new Set(Array.from(windows.values(), (state) => state.label));
  let i = 1;
  while (labels.has(i)) i++;
  return i;
}

async function createWindow(files: string[] = []) {
  const token = randomUUID();
  const label = newLabel();
  const bounds = windowStates[String(label)];
  const win = new BrowserWindow({
    ...restoreBounds(bounds, screen.getAllDisplays()),
    title: "AMark",
    minWidth: 600,
    minHeight: 400,
    frame: false,
    show: false,
    backgroundColor: "#faf9f5",
    icon: path.join(app.getAppPath(), "resources", "icons", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      additionalArguments: [
        "--amark-assets=" + token,
        "--amark-preferences=" + Buffer.from(JSON.stringify(legacyPreferences)).toString("base64"),
      ],
    },
  });
  const id = win.webContents.id;
  const ws = createWorkspace((name, payload) => emit(win, name, payload));
  const state: WindowState = { win, ws, label, launch: [], closeListener: false, approved: false };
  assets.set(token, ws);
  windows.set(id, state);
  lockNavigation(win.webContents);
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) state.closeListener = false;
  });
  win.on("close", (event) => {
    if (state.closeListener && !state.approved && !win.webContents.isCrashed()) {
      event.preventDefault();
      emit(win, "window-close-requested");
      return;
    }
    saveWindowState(app, windowStates, label, win);
  });
  win.on("closed", () => {
    ws.close();
    assets.delete(token);
    windows.delete(id);
  });
  const notifyResize = () => emit(win, "window-resized");
  win.on("resize", notifyResize);
  win.on("maximize", notifyResize);
  win.on("unmaximize", notifyResize);
  win.once("ready-to-show", () => {
    if (bounds?.maximized) win.maximize();
    if (bounds?.fullscreen) win.setFullScreen(true);
    win.show();
  });
  try {
    for (const file of files) {
      try {
        const canonical = await ws.grantFile(file);
        const dir = path.dirname(canonical);
        if (state.launch.length === 0) await ws.grantRoot(dir);
        state.launch.push({ path: canonical, dir });
      } catch (error) {
        console.warn("Could not open launch file", file, String(error));
      }
    }
    await win.loadURL(entry);
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

function openNewWindow(files: string[]) {
  createWindow(files).catch((error) => {
    console.error("Could not open AMark window", error);
    dialog.showErrorBox("AMark", String(error.message));
  });
}
function themeFilename(fileName: string) {
  if (
    typeof fileName !== "string" ||
    /[/\\:]/.test(fileName) ||
    fileName.includes("\0") ||
    !/\.css$/i.test(fileName)
  ) {
    throw new Error("Invalid theme filename");
  }
  return path.join(themeDirectory(), fileName);
}
async function themeCSS(fileName: string) {
  const file = themeFilename(fileName);
  const stat = await fsp.lstat(file).catch(() => null);
  return stat?.isFile() ? fsp.readFile(file, "utf8") : null;
}
async function menuAction(win: BrowserWindow, id: string) {
  if (id === "new") emit(win, "menu-new");
  else if (menuEvents.has(id as MenuEvent)) emit(win, id as MenuEvent);
  else if (edits.has(id)) win.webContents[edits.get(id)!]();
  else if (id === "view-fullscreen") win.setFullScreen(!win.isFullScreen());
  else if (id.startsWith("theme-custom:")) {
    const name = id.slice("theme-custom:".length);
    if ((await themeCSS(name)) !== null) emit(win, "set-theme", "custom:" + name);
  } else if (id.startsWith("theme-") && themes.has(id.slice(6)))
    emit(win, "set-theme", id.slice(6));
}

async function exportDocument(
  state: WindowState,
  format: "html" | "pdf",
  html: string,
  title: string,
) {
  if (typeof html !== "string") throw new Error("Invalid export document");
  const stem =
    typeof title === "string" && title.trim()
      ? path.basename(title).replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")
      : "untitled";
  const { filePath, canceled } = await dialog.showSaveDialog(state.win, {
    defaultPath: stem + "." + format,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (canceled || !filePath) return format === "pdf";
  if (format === "html") {
    await fsp.writeFile(filePath, html);
    return true;
  }
  const job = "amark-print://" + randomUUID() + "/document";
  const print = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    },
  });
  lockNavigation(print.webContents);
  printJobs.set(job, html);
  try {
    await print.loadURL(job);
    await print.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    const bytes = await print.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    await fsp.writeFile(filePath, bytes);
    emit(state.win, "pdf-export-done");
  } catch (error) {
    console.error("PDF export failed", error);
    emit(state.win, "pdf-export-error");
  } finally {
    printJobs.delete(job);
    if (!print.isDestroyed()) print.destroy();
  }
  return true;
}

const commands: ShellHandlers = {
  home_dir: () => app.getPath("home"),
  take_launch_files: (state) => state.launch.splice(0),
  menu_action: (state, { id }) => menuAction(state.win, id),
  window_minimize: ({ win }) => win.minimize(),
  window_toggle_maximize: ({ win }) => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  window_is_maximized: ({ win }) => win.isMaximized(),
  window_request_close: ({ win }) => win.close(),
  window_cancel_close: () => {
    quitting = false;
  },
  window_destroy: (state) => {
    state.approved = true;
    state.win.close();
  },
  async open_workspace_folder({ win, ws }) {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths.length) return { success: false };
    const root = await ws.grantRoot(filePaths[0]);
    return { success: true, root_path: root, name: path.basename(root) || root };
  },
  async authorize_workspace({ win, ws }, { path: input }) {
    if (typeof input !== "string" || !path.isAbsolute(input))
      throw new Error("Invalid folder path");
    // A typed path does not come from the native folder picker. Confirm the
    // path with the OS before granting the renderer read/write access to it.
    const chinese = app.getLocale().startsWith("zh");
    const { response } = await dialog.showMessageBox(win, {
      message: chinese ? "在 AMark 中打开此文件夹？" : "Open this folder in AMark?",
      detail: input,
      buttons: chinese ? ["打开", "取消"] : ["Open", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    return response === 0 ? ws.grantRoot(input) : null;
  },
  async dialog_open_file({ win, ws }, { filters }) {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: filters ?? markdownFilters,
    });
    return result.canceled ? null : ws.grantFile(result.filePaths[0]);
  },
  async dialog_save_file({ win, ws }, { defaultPath, filters }) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: filters ?? markdownFilters,
    });
    return result.canceled ? null : ws.grantFile(result.filePath);
  },
  async open_path_in_new_window({ win, ws }, { path: file }) {
    if (!path.isAbsolute(file) || !(await fsp.stat(file)).isFile()) throw new Error("Invalid file");
    try {
      await ws.resolveDocument(file);
    } catch {
      const chinese = app.getLocale().startsWith("zh");
      const { response } = await dialog.showMessageBox(win, {
        message: chinese
          ? "在新窗口打开工作区外的文件？"
          : "Open this file outside the workspace in a new window?",
        detail: file,
        buttons: chinese ? ["打开", "取消"] : ["Open", "Cancel"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return;
    }
    await createWindow([file]);
  },
  async open_external(_state, { url: value }) {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol)) await shell.openExternal(url.href);
  },
  async list_custom_themes() {
    const entries = await fsp.readdir(themeDirectory(), { withFileTypes: true });
    return entries
      .filter((item) => item.isFile() && /\.css$/i.test(item.name))
      .map((item) => item.name)
      .sort();
  },
  load_theme_css: (_state, { fileName }) => themeCSS(fileName),
  async load_custom_theme({ win }) {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "CSS", extensions: ["css"] }],
    });
    if (result.canceled) return null;
    const name = path.basename(result.filePaths[0]);
    const target = themeFilename(name);
    const css = await fsp.readFile(result.filePaths[0], "utf8");
    if (path.resolve(target) !== path.resolve(result.filePaths[0])) {
      const temp = path.join(themeDirectory(), "." + randomUUID());
      try {
        await fsp.writeFile(temp, css, { flag: "wx" });
        await fsp.rename(temp, target);
      } finally {
        await fsp.rm(temp, { force: true });
      }
    }
    return { name, css };
  },
  export_html: (state, { html, title }) => exportDocument(state, "html", html, title),
  export_pdf: (state, { html, title }) => exportDocument(state, "pdf", html, title),
};

function hasCommand<T extends object>(handlers: T, name: string): name is Extract<keyof T, string> {
  return Object.hasOwn(handlers, name);
}
// Electron deserializes arguments at the IPC boundary. Commands keep their own
// runtime filesystem and permission checks; both sides share the wire types.
function dispatchShell<K extends ShellCommand>(state: WindowState, name: K, args: unknown) {
  return commands[name](state, args as Commands[K]["args"]);
}
function dispatchWorkspace<K extends keyof Workspace["commands"]>(
  ws: Workspace,
  name: K,
  args: unknown,
) {
  const handlers: Pick<WorkspaceHandlers, keyof Workspace["commands"]> = ws.commands;
  return handlers[name](args as Commands[K]["args"]);
}
ipcMain.handle(
  "amark:command",
  async (event, command: string, args: unknown): Promise<Reply<unknown>> => {
    try {
      const state = client(event);
      if (!state || typeof command !== "string" || !args || typeof args !== "object")
        throw new Error("Invalid desktop request");
      let value;
      if (hasCommand(commands, command)) value = await dispatchShell(state, command, args);
      else if (hasCommand(state.ws.commands, command))
        value = await dispatchWorkspace(state.ws, command, args);
      else throw new Error("Unknown desktop command");
      return { ok: true, value };
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return {
          ok: false,
          error: { code: error.code, name: error.name, kind: error.kind, reason: error.reason },
        };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
);
ipcMain.on("amark:close-listener", (event, enabled) => {
  const state = client(event);
  if (state) state.closeListener = enabled === true;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("open-file", (event, file) => {
    event.preventDefault();
    if (initialized) openNewWindow([file]);
    else earlyFiles.push(file);
  });
  app.on("second-instance", (_event, argv, cwd) => {
    const files = parseFiles(argv, cwd);
    if (initialized) openNewWindow(files);
    else earlyFiles.push(...files);
  });
  app.on("before-quit", (event) => {
    if (!windows.size) return;
    event.preventDefault();
    quitting = true;
    for (const { win } of windows.values()) win.close();
  });
  app.on("window-all-closed", () => {
    if (initialized && (process.platform !== "darwin" || quitting)) app.quit();
  });
  app.on("activate", () => {
    if (initialized && !windows.size) openNewWindow([]);
  });
  app
    .whenReady()
    .then(async () => {
      registerProtocols({
        protocol,
        net,
        assets,
        printJobs,
        entry,
        dist: path.join(app.getAppPath(), "out", "renderer"),
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      Menu.setApplicationMenu(
        process.platform === "darwin"
          ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }])
          : null,
      );
      await fsp.mkdir(themeDirectory(), { recursive: true });
      windowStates = readWindowStates(
        app,
        process.platform === "win32" ? (rect) => screen.screenToDipRect(null, rect) : undefined,
      );
      legacyPreferences = await loadLegacyPreferences(app);
      initialized = true;
      openNewWindow([...new Set([...earlyFiles, ...parseFiles(process.argv, process.cwd())])]);
    })
    .catch((error) => {
      dialog.showErrorBox("AMark", String(error));
      app.exit(1);
    });
}
