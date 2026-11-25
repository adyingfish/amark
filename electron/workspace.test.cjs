const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: wait } = require("node:timers/promises");
const { createWorkspace } = require("../dist-electron/workspace.js");

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "amark-workspace-"));
  const folder = path.join(temporary, "docs");
  const outside = path.join(temporary, "outside");
  await Promise.all([fs.mkdir(folder), fs.mkdir(outside)]);
  const events = [];
  const workspace = createWorkspace((name, payload) => events.push({ name, path: payload.path }));
  const rootPath = await workspace.grantRoot(folder);
  t.after(async () => {
    await workspace.close();
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const search = (query, options = {}) =>
    workspace.commands.search_workspace({
      rootPath,
      caseSensitive: false,
      showHidden: false,
      overrides: [],
      query,
      ...options,
    });
  return { workspace, commands: workspace.commands, rootPath, outside, events, search };
}

test("file tree, create/rename/delete, collision and translated error fields", async (t) => {
  const { rootPath, commands } = await fixture(t);
  for (const name of [".private", "node_modules", "empty"])
    await commands.create_directory({ parentPath: rootPath, name });
  const file = await commands.create_markdown_file({ parentPath: rootPath, name: "  你好 " });
  await assert.rejects(commands.create_markdown_file({ parentPath: rootPath, name: "你好" }), {
    code: "EntryExists",
    kind: "file",
    name: "你好.md",
  });
  await assert.rejects(commands.create_directory({ parentPath: rootPath, name: ".." }), {
    code: "NameInvalid",
  });
  await assert.rejects(commands.create_markdown_file({ parentPath: rootPath, name: "a/b" }), {
    code: "NameHasSeparator",
  });
  await assert.rejects(commands.create_markdown_file({ parentPath: rootPath, name: " " }), {
    code: "NameEmpty",
  });
  await commands.save_file_v2({ path: file, content: "\ufeff😀 Text\r\n" });
  assert.deepEqual(await commands.read_file({ path: file }), {
    path: file,
    content: "\ufeff😀 Text\r\n",
  });
  const renamed = await commands.rename_path({ path: file, newName: " note.Markdown " });
  await fs.writeFile(path.join(rootPath, "noise.txt"), "");
  const { files } = await commands.scan_workspace({ rootPath, showHidden: false });
  assert.deepEqual(
    files.map((f) => [f.name, f.kind]),
    [
      ["empty", "directory"],
      ["note.Markdown", "file"],
    ],
  );
  assert.deepEqual(files[0].children, []);
  const hidden = await commands.scan_workspace({ rootPath, showHidden: true });
  assert.deepEqual(
    hidden.files.map((f) => f.name),
    [".private", "empty", "note.Markdown"],
  );
  await assert.rejects(commands.delete_path({ path: path.join(rootPath, "noise.txt") }), {
    code: "NotMarkdownFile",
  });
  assert.equal(await commands.delete_path({ path: renamed }), true);
  await assert.rejects(commands.read_file({ path: renamed }), { code: "ReadFailed" });
});

test("window grants, saving a new selected path and junction confinement", async (t) => {
  const { workspace, commands, rootPath, outside } = await fixture(t);
  const other = path.join(outside, "scratch.md");
  await assert.rejects(commands.save_file_v2({ path: other, content: "no" }), {
    code: "Unexpected",
  });
  await assert.rejects(commands.scan_workspace({ rootPath: outside, showHidden: true }));
  const junction = path.join(rootPath, "linked");
  await fs.symlink(outside, junction, process.platform === "win32" ? "junction" : "dir");
  await fs.writeFile(path.join(outside, "secret.md"), "secret");
  await assert.rejects(commands.read_file({ path: path.join(junction, "secret.md") }), {
    code: "Unexpected",
  });
  await assert.rejects(commands.create_markdown_file({ parentPath: junction, name: "no" }), {
    code: "Unexpected",
  });
  await assert.rejects(workspace.resolveAsset(path.join(junction, "secret.md")), {
    code: "Unexpected",
  });
  assert.deepEqual((await commands.scan_workspace({ rootPath, showHidden: true })).files, []);
  await workspace.grantFile(other);
  await commands.save_file_v2({ path: other, content: "ok" });
  assert.equal((await commands.read_file({ path: other })).content, "ok");
  await assert.rejects(commands.read_file({ path: path.join(outside, "secret.md") }), {
    code: "Unexpected",
  });
  await workspace.close();
  await assert.rejects(commands.read_file({ path: other }), { code: "Unexpected" });
});

test("search uses dirty buffers, Unicode columns, UTF-16 offsets and result limits", async (t) => {
  const { rootPath, search } = await fixture(t);
  const file = path.join(rootPath, "notes.md");
  await fs.writeFile(file, "disk");
  const hiddenDirectory = path.join(rootPath, ".private");
  await fs.mkdir(hiddenDirectory);
  await fs.writeFile(path.join(hiddenDirectory, "hidden.md"), "Agent");
  const content = "😀 head\r\n😀 Agent AGENT";
  const result = await search("agent", { overrides: [{ path: file, content }] });
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.matches.map((m) => [
      m.column,
      m.line,
      m.start,
      m.end,
      m.preview_match_start,
      m.preview_match_end,
    ]),
    [
      [3, 2, 12, 17, 3, 8],
      [9, 2, 18, 23, 9, 14],
    ],
  );
  assert.equal((await search("Agent", { showHidden: true })).matches.length, 1);
  assert.equal(
    (await search("agent", { showHidden: true, caseSensitive: true })).matches.length,
    0,
  );
  await fs.writeFile(file, "a".repeat(51));
  const capped = await search("a");
  assert.equal(capped.matches.length, 50);
  assert.equal(capped.truncated, true);
});

async function until(check) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail("Timed out waiting for watcher event");
    await wait(25);
  }
}

test("external writes, atomic replacement, moved trees, hidden and per-window cleanup", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const file = path.join(first.rootPath, "external.md");
  const hiddenFile = path.join(first.rootPath, ".hidden.md");
  await fs.writeFile(file, "old");
  await Promise.all(
    [first, second].map(({ commands, rootPath }) =>
      commands.start_watch_workspace({ rootPath, showHidden: false }),
    ),
  );
  const saw = (kind, filePath) =>
    first.events.some((e) => e.name === "workspace://file-" + kind && e.path === filePath);
  const temporaryFile = path.join(first.rootPath, "save.tmp");
  await fs.writeFile(temporaryFile, "replace");
  await fs.rename(temporaryFile, file);
  await until(() => saw("changed", file));
  assert.equal(saw("removed", file), false);
  const tree = path.join(first.outside, "import");
  await fs.mkdir(tree);
  await fs.writeFile(path.join(tree, "child.md"), "one");
  const imported = path.join(first.rootPath, "import");
  const child = path.join(imported, "child.md");
  await fs.rename(tree, imported);
  await until(() => saw("created", child));
  await fs.writeFile(hiddenFile, "one");
  await fs.mkdir(path.join(first.rootPath, "node_modules"));
  const ignored = path.join(first.rootPath, "node_modules", "generated.md");
  await fs.writeFile(ignored, "skip");
  await wait(300);
  assert.equal(saw("created", hiddenFile), false);
  assert.equal(saw("created", ignored), false);
  await first.commands.set_show_hidden_files({ showHidden: true });
  await fs.writeFile(hiddenFile, "now visible");
  await until(() => saw("changed", hiddenFile));
  await fs.unlink(child);
  await until(() => saw("removed", child));
  assert.deepEqual(second.events, []);
  await first.commands.stop_watch_workspace({ rootPath: first.rootPath });
  first.events.length = 0;
  await fs.writeFile(file, "after close");
  await wait(250);
  assert.deepEqual(first.events, []);
});

test("a delayed request for a previous workspace cannot stop the new watcher", async (t) => {
  const { workspace, commands, rootPath, outside, events } = await fixture(t);
  const previousStart = commands
    .start_watch_workspace({ rootPath, showHidden: false })
    .catch(() => false);
  const next = await workspace.grantRoot(outside);
  assert.equal(await commands.start_watch_workspace({ rootPath: next, showHidden: false }), true);
  await previousStart;
  await assert.rejects(commands.start_watch_workspace({ rootPath, showHidden: false }), {
    code: "NotADirectory",
  });
  await commands.stop_watch_workspace({ rootPath });
  const file = path.join(next, "current.md");
  await fs.writeFile(file, "visible");
  await until(() => events.some((e) => e.path === file));
  await assert.rejects(workspace.resolveAsset(path.join(rootPath, "old.png")), {
    code: "Unexpected",
  });
});
