const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const identifier = "ai.marswave.amark";
const keys = [
  "amark-theme",
  "amark-language",
  "amark-view-mode",
  "amark-sidebar-width",
  "amark-sidebar-collapsed",
  "amark-split-ratio",
  "amark-show-hidden-files",
];

function jsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function validRect(rect) {
  return (
    rect &&
    ["x", "y", "width", "height"].every(
      (key) => Number.isInteger(rect[key]) && Math.abs(rect[key]) < 0x7fffffff,
    ) &&
    rect.width > 0 &&
    rect.height > 0
  );
}
function readWindowStates(app, toDip = (rect) => rect) {
  const saved = jsonFile(path.join(app.getPath("userData"), "windows.json"));
  if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
  if (app.commandLine.hasSwitch("user-data-dir")) return {};
  const old = jsonFile(path.join(app.getPath("appData"), identifier, ".window-state.json")) ?? {};
  return Object.fromEntries(
    Object.entries(old)
      .filter(([key, rect]) => /^main(?:-\d+)?$/.test(key) && validRect(rect))
      .map(([key, rect]) => [
        key.split("-")[1] ?? "1",
        {
          ...toDip(rect),
          maximized: rect.maximized === true,
          fullscreen: rect.fullscreen === true,
        },
      ]),
  );
}
function restoreBounds(saved, displays) {
  const fallback = { width: 960, height: 720 };
  if (!validRect(saved)) return fallback;
  const { x, y, width, height } = saved;
  if (
    width < 600 ||
    height < 400 ||
    width > displays.reduce((sum, d) => sum + d.workArea.width, 0) ||
    height > displays.reduce((sum, d) => sum + d.workArea.height, 0)
  )
    return fallback;
  const visible = displays.some(
    ({ workArea }) =>
      x + width > workArea.x + 60 &&
      x < workArea.x + workArea.width - 60 &&
      y >= workArea.y - 10 &&
      y < workArea.y + workArea.height - 32,
  );
  return visible ? { x, y, width, height } : fallback;
}
function saveWindowState(app, states, label, win) {
  states[label] = {
    ...win.getNormalBounds(),
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
  };
  const target = path.join(app.getPath("userData"), "windows.json");
  try {
    fs.writeFileSync(target + ".tmp", JSON.stringify(states));
    fs.renameSync(target + ".tmp", target);
  } catch (error) {
    console.warn("Could not persist window state", error.message);
  }
}

// Chromium itself decodes WebView2's LevelDB (including deleted/overwritten
// values). Work exclusively on a copy of the application's local storage.
async function readWebView2(app, source) {
  const { BrowserWindow, session } = require("electron");
  const staging = path.join(app.getPath("userData"), "legacy-preferences-import");
  const copied = path.join(staging, "Local Storage", "leveldb");
  await fsp.mkdir(copied, { recursive: true });
  for (const name of await fsp.readdir(source)) {
    if (/^(?:CURRENT|MANIFEST-\d+|\d+\.(?:ldb|sst|log))$/.test(name)) {
      await fsp.copyFile(path.join(source, name), path.join(copied, name));
    }
  }
  const isolated = session.fromPath(staging);
  const reader = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolated,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  try {
    const blank = () =>
      new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
    isolated.protocol.handle("http", blank);
    isolated.protocol.handle("https", blank);
    for (const origin of ["http://tauri.localhost", "https://tauri.localhost"]) {
      await reader.loadURL(origin);
      const items = await reader.webContents.executeJavaScript(
        "Object.fromEntries(" +
          JSON.stringify(keys) +
          ".map(k => [k,localStorage.getItem(k)]).filter(([,v]) => v !== null))",
      );
      if (Object.keys(items).length) return items;
    }
    return {};
  } finally {
    reader.destroy();
    isolated.protocol.unhandle("http");
    isolated.protocol.unhandle("https");
    await isolated.clearStorageData({ storages: ["localstorage"] });
  }
}

async function readWebKit(directory) {
  // WebKitGTK and WKWebView store origin data in SQLite. Both hashed origin
  // directories and the older tauri_localhost_0.localstorage layout exist.
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const result = await readWebKit(file);
      if (Object.keys(result).length) return result;
    } else if (
      entry.isFile() &&
      (/tauri.*localhost.*\.localstorage$/i.test(entry.name) ||
        entry.name.toLowerCase() === "localstorage.sqlite3")
    ) {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const query = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
        const settings = {};
        for (const key of keys) {
          const value = query.get(key)?.value;
          if (typeof value === "string") settings[key] = value;
          else if (value instanceof Uint8Array)
            settings[key] = Buffer.from(value).toString("utf16le");
        }
        if (Object.keys(settings).length) return settings;
      } finally {
        db.close();
      }
    }
  }
  return {};
}

async function loadLegacyPreferences(app) {
  if (app.commandLine.hasSwitch("user-data-dir")) return {};
  const userData = app.getPath("userData");
  const file = path.join(userData, "legacy-preferences.json");
  const imported = jsonFile(file);
  if (imported) return knownSettings(imported);
  try {
    let settings = {};
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
      const source = path.join(
        process.env.LOCALAPPDATA,
        identifier,
        "EBWebView",
        "Default",
        "Local Storage",
        "leveldb",
      );
      if (fs.existsSync(path.join(source, "CURRENT"))) settings = await readWebView2(app, source);
    } else if (process.platform === "darwin") {
      settings = await readWebKit(
        path.join(app.getPath("home"), "Library", "WebKit", identifier, "WebsiteData"),
      );
    } else if (process.platform === "linux") {
      settings = await readWebKit(
        path.join(
          process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share"),
          identifier,
        ),
      );
    }
    settings = knownSettings(settings);
    await fsp.writeFile(file, JSON.stringify(settings), { flag: "wx" });
    return settings;
  } catch (error) {
    console.warn("Could not import previous AMark preferences:", error.message);
    return {};
  }
}

function knownSettings(settings) {
  return Object.fromEntries(
    keys
      .filter((key) => typeof settings[key] === "string" && settings[key].length <= 512)
      .map((key) => [key, settings[key]]),
  );
}

module.exports = {
  readWindowStates,
  restoreBounds,
  saveWindowState,
  loadLegacyPreferences,
  readWebKit,
};
