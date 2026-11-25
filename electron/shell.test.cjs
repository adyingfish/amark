const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const {
  isAppPage,
  launchFilePath,
  registerProtocols,
  rendererURL,
} = require("../dist-electron/protocols.js");
const { readWebKit, readWindowStates, restoreBounds } = require("../dist-electron/preferences.js");

test("file associations accept percent-escaped file URIs and relative command-line paths", () => {
  const file = path.join(os.tmpdir(), "本地 示例.md");
  assert.equal(launchFilePath(pathToFileURL(file).href, os.tmpdir()), file);
  assert.equal(launchFilePath("本地 示例.md", os.tmpdir()), file);
  assert.equal(launchFilePath("file:///" + "%zz", os.tmpdir()), null);
});

test("only built app entry points and explicitly configured local dev servers receive IPC", () => {
  const entry = rendererURL("https://other.example", true);
  assert.equal(isAppPage("amark://app/index.html#heading", entry), true);
  for (const url of [
    "amark-asset://app/index.html",
    "amark://app.example/index.html",
    "amark://app/assets/document.svg",
    "https://app/index.html",
  ]) {
    assert.equal(isAppPage(url, entry), false);
  }
  assert.throws(() => rendererURL("https://other.example", false));
  assert.equal(rendererURL("http://127.0.0.1:1420", false), "http://127.0.0.1:1420/");
});

test("asset links expire with their window and only return approved image files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amark-assets-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "本地图.svg");
  await fs.writeFile(file, "<svg/>");
  const handlers = new Map();
  const ws = {
    async resolveAsset(input) {
      if (path.dirname(input) !== root) throw new Error("Out of scope");
      return input;
    },
  };
  const assets = new Map([["unique-window", ws]]);
  const entry = "amark://app/index.html";
  registerProtocols({
    protocol: { handle: (scheme, cb) => handlers.set(scheme, cb) },
    dist: root,
    assets,
    printJobs: new Map(),
    entry,
  });
  const asset = (name) =>
    handlers.get("amark-asset")(
      new Request("amark-asset://unique-window/" + encodeURIComponent(name)),
    );
  const image = await asset(file);
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "<svg/>");
  assert.equal(image.headers.get("Content-Type"), "image/svg+xml");
  assert.equal(image.headers.get("Access-Control-Allow-Origin"), "amark://app");
  assert.match(image.headers.get("Content-Security-Policy"), /sandbox/);
  assert.equal((await asset(path.join(root, "note.md"))).status, 415);
  assert.equal((await asset(path.join(os.tmpdir(), "out.png"))).status, 404);
  assets.clear();
  assert.equal((await asset(file)).status, 403);
  assert.equal(
    (await handlers.get("amark")(new Request("amark://app/assets/%2e%2e%2fpackage.json"))).status,
    404,
  );
});

test("restores visible window geometry and recenters windows on disconnected displays", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const rect = { x: 30, y: 40, width: 1000, height: 720 };
  assert.deepEqual(restoreBounds(rect, displays), rect);
  assert.deepEqual(restoreBounds({ ...rect, x: -6000 }, displays), { width: 960, height: 720 });
});

test("legacy geometry is converted from physical pixels once and invalid entries are ignored", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amark-window-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, "ai.marswave.amark");
  await fs.mkdir(config);
  await fs.writeFile(
    path.join(config, ".window-state.json"),
    JSON.stringify({
      main: { x: 20, y: 40, width: 1600, height: 1200, maximized: true },
      "main-2": null,
    }),
  );
  const app = { getPath: () => root, commandLine: { hasSwitch: () => false } };
  const converted = { x: 10, y: 20, width: 800, height: 600 };
  const states = readWindowStates(app, () => converted);
  assert.deepEqual(states, { 1: { ...converted, maximized: true, fullscreen: false } });
  await fs.writeFile(path.join(root, "windows.json"), JSON.stringify(states));
  assert.deepEqual(
    readWindowStates(app, () => assert.fail("converted twice")),
    states,
  );
});

test("legacy WebKit import reads AMark preference keys with both SQLite value encodings", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "amark-webkit-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(root, "tauri_localhost_0.localstorage"));
  db.exec("CREATE TABLE ItemTable(key TEXT PRIMARY KEY, value BLOB)");
  const put = db.prepare("INSERT INTO ItemTable VALUES(?,?)");
  put.run("amark-theme", Buffer.from("custom:纸张.css", "utf16le"));
  put.run("amark-language", "zh");
  put.run("other", "unrelated");
  db.close();
  assert.deepEqual(await readWebKit(root), {
    "amark-theme": "custom:纸张.css",
    "amark-language": "zh",
  });
});
