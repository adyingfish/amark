import type { Commands, DesktopEvents, WorkspaceEvent } from "../shared/desktop";
export type WorkspaceHandlers = {
  [K in keyof Commands]: (
    args: Commands[K]["args"],
  ) => Commands[K]["returns"] | Promise<Commands[K]["returns"]>;
};
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { watch } from "chokidar";
import { isMarkdown, skipEntry, within, readText, scanDirectory } from "./workspace-files.js";

export class WorkspaceError extends Error {
  readonly code: string;
  readonly kind?: string;
  readonly reason?: string;
  constructor(code: string, details: { reason?: string; name?: string; kind?: string } = {}) {
    super(details.reason ?? code);
    this.code = code;
    Object.assign(this, details);
  }
}

async function operation<T>(code: string, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(code, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

// Two windows can operate on the same directory. Keep the destination
// collision check and the corresponding rename/create in the same turn.
let mutations = Promise.resolve();
function mutate<T>(code: string, action: () => Promise<T>) {
  const result = mutations.then(() => operation(code, action));
  mutations = result.then(
    () => {},
    () => {},
  );
  return result;
}

function cleanName(value: string, markdown: boolean) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new WorkspaceError("NameEmpty");
  if (/[/\\]/.test(name)) throw new WorkspaceError("NameHasSeparator");
  if (name === "." || name === ".." || name.includes("\0")) throw new WorkspaceError("NameInvalid");
  if (
    process.platform === "win32" &&
    (/[<>:"|?*]|[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) ||
      Array.from(name).some((char) => char.charCodeAt(0) < 32))
  ) {
    throw new WorkspaceError("NameInvalid");
  }
  return markdown && !isMarkdown(name) ? name + ".md" : name;
}

function absolute(value: string) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    throw new WorkspaceError("Unexpected", { reason: "Expected an absolute filesystem path" });
  }
  // Device namespaces and alternate data streams are not document paths.
  if (
    process.platform === "win32" &&
    (/^[\\/]{2}[?.][\\/]/.test(value) || value.slice(path.parse(value).root.length).includes(":"))
  ) {
    throw new WorkspaceError("NameInvalid");
  }
  return path.resolve(value);
}

async function canonical(value: string, allowMissing = false) {
  const file = absolute(value);
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling symlink exists even though realpath reports ENOENT.
    const link = await fs.lstat(file).catch((cause) => {
      if (cause.code !== "ENOENT") throw cause;
      return null;
    });
    if (link) throw error;
    return path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  }
}

function createWorkspace(
  emit: (event: WorkspaceEvent, payload: DesktopEvents[WorkspaceEvent]) => void,
) {
  let root: string | null = null;
  const files = new Set<string>();
  let watcher: ReturnType<typeof watch> | null = null;
  let watchGeneration = 0;
  let finishWatchStart: ((ready: boolean) => void) | undefined;
  let showHidden = false;
  let searchWorker: Worker | null = null;
  let searchGeneration = 0;
  let closed = false;

  function isGranted(file: string, forAsset = false) {
    if (closed) return false;
    if (root && within(root, file)) return true;
    for (const granted of files) {
      if (path.relative(granted, file) === "") return true;
      if (forAsset && within(path.dirname(granted), file)) return true;
    }
    return false;
  }

  async function checked(value: string, allowMissing = false, forAsset = false) {
    const requested = absolute(value);
    function assertGranted(file: string) {
      if (!isGranted(file, forAsset)) {
        throw new WorkspaceError("Unexpected", {
          reason: "Path outside the selected workspace or document",
        });
      }
    }
    assertGranted(requested);
    const resolved = await canonical(requested, allowMissing);
    assertGranted(resolved);
    return resolved;
  }

  async function checkedRoot(value: string) {
    const requested = await checked(value);
    if (!root || path.relative(root, requested) !== "") throw new WorkspaceError("NotADirectory");
    return requested;
  }

  async function mutationPath(value: string, allowMissing = false) {
    const file = await checked(value, allowMissing);
    if (path.relative(absolute(value), file)) {
      throw new WorkspaceError("Unexpected", { reason: "The selected entry is a symbolic link" });
    }
    return file;
  }

  async function stopWatch() {
    watchGeneration++;
    const previous = watcher;
    watcher = null;
    finishWatchStart?.(false);
    finishWatchStart = undefined;
    await previous?.close();
  }

  async function startWatch(args: Commands["start_watch_workspace"]["args"]) {
    if (!root || path.relative(root, args.rootPath) !== "")
      throw new WorkspaceError("NotADirectory");
    const generation = watchGeneration + 1;
    await stopWatch();
    const directory = await checkedRoot(args.rootPath);
    if (generation !== watchGeneration) return false;
    showHidden = args.showHidden;
    const network = directory.startsWith("\\\\");
    const current = watch(directory, {
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: network,
      interval: 2000,
      atomic: true,
      ignored(file, stat) {
        const relative = path.relative(directory, file);
        if (!relative) return false;
        const name = path.basename(file);
        if (name === ".git" || skipEntry(name, true)) return true;
        return !!stat && (stat.isSymbolicLink() || (stat.isFile() && !isMarkdown(file)));
      },
    });
    watcher = current;
    return new Promise<boolean>((resolve) => {
      finishWatchStart = resolve;
      current.on("error", (error) => {
        console.error("Workspace watcher:", String(error));
        if (watcher === current && finishWatchStart) void stopWatch();
      });
      current.once("ready", () => {
        if (watcher === current) finishWatchStart = undefined;
        resolve(watcher === current);
      });
      const events: Partial<Record<string, WorkspaceEvent>> = {
        add: "workspace://file-created",
        change: "workspace://file-changed",
        unlink: "workspace://file-removed",
      };
      current.on("all", (event, file) => {
        const channel = events[event];
        if (watcher !== current || !channel || !isMarkdown(file)) return;
        const parts = path.relative(directory, file).split(path.sep);
        if (showHidden || !parts.some((part) => part.startsWith("."))) {
          emit(channel, { path: file, rootPath: directory });
        }
      });
    });
  }

  async function search(args: Commands["search_workspace"]["args"]) {
    const generation = ++searchGeneration;
    const directory = await checkedRoot(args.rootPath);
    if (generation !== searchGeneration) throw new Error("Search interrupted");
    await searchWorker?.terminate();
    if (generation !== searchGeneration) throw new Error("Search interrupted");
    if (closed || root !== directory) throw new WorkspaceError("NotADirectory");
    const searchScript = path
      .join(__dirname, "workspace-search.js")
      .replace(/([/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2");
    const worker = new Worker(searchScript, { workerData: { ...args, rootPath: directory } });
    searchWorker = worker;
    try {
      return await new Promise<Commands["search_workspace"]["returns"]>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", () => reject(new Error("Search interrupted")));
      });
    } finally {
      if (worker === searchWorker) searchWorker = null;
    }
  }

  async function createEntry(parentPath: string, rawName: string, directory: boolean) {
    const name = cleanName(rawName, !directory);
    const parent = await mutationPath(parentPath);
    if (!root || !within(root, parent)) throw new WorkspaceError("NotADirectory");
    const target = path.join(parent, name);
    try {
      if (directory) await fs.mkdir(target);
      else await fs.writeFile(target, "", { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new WorkspaceError("EntryExists", { name, kind: directory ? "any" : "file" });
      throw error;
    }
    return target;
  }

  const commands = {
    scan_workspace: ({ rootPath, showHidden }) =>
      operation("ReadDirFailed", async () => {
        const directory = await checkedRoot(rootPath);
        const files = await scanDirectory(directory, showHidden);
        if (directory !== root || closed) throw new WorkspaceError("NotADirectory");
        return {
          root_path: directory,
          name: path.basename(directory) || "workspace",
          files,
        };
      }),
    search_workspace: search,
    start_watch_workspace: startWatch,
    async stop_watch_workspace({ rootPath }) {
      if (root && path.relative(root, rootPath) === "") {
        root = null;
        files.clear();
        searchGeneration++;
        await Promise.all([stopWatch(), searchWorker?.terminate()]);
      }
      return true;
    },
    set_show_hidden_files(args) {
      showHidden = args.showHidden;
    },
    read_file: ({ path: file }) =>
      operation("ReadFailed", async () => {
        const target = await checked(file);
        return { path: file, content: await readText(target) };
      }),
    save_file_v2: ({ path: file, content }) =>
      mutate("WriteFailed", async () => {
        const target = await mutationPath(file, true);
        await fs.writeFile(target, content, "utf8");
        return true;
      }),
    create_directory: ({ parentPath, name }) =>
      mutate("CreateDirFailed", () => createEntry(parentPath, name, true)),
    create_markdown_file: ({ parentPath, name }) =>
      mutate("CreateFileFailed", () => createEntry(parentPath, name, false)),
    rename_path: ({ path: file, newName }) =>
      mutate("RenameFailed", async () => {
        const source = await mutationPath(file);
        if (!root || !within(root, source) || path.relative(root, source) === "")
          throw new WorkspaceError("CannotLocateParentDir");
        const directory = (await fs.stat(source)).isDirectory();
        const name = cleanName(newName, !directory);
        const target = path.join(path.dirname(source), name);
        if (target === source) return source;
        const existing = await fs.lstat(target).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return null;
        });
        if (existing)
          throw new WorkspaceError("EntryExists", { kind: directory ? "folder" : "file", name });
        await fs.rename(source, target);
        return target;
      }),
    delete_path: ({ path: file }) =>
      mutate("DeleteFailed", async () => {
        if (!isMarkdown(file)) throw new WorkspaceError("NotMarkdownFile");
        const target = await mutationPath(file);
        await fs.unlink(target);
        return true;
      }),
  } satisfies Partial<WorkspaceHandlers>;

  return {
    commands,
    async grantRoot(value: string) {
      const directory = await canonical(value);
      if (!(await fs.stat(directory)).isDirectory()) throw new WorkspaceError("NotADirectory");
      if (root !== directory) {
        const stopping = stopWatch();
        searchGeneration++;
        root = directory;
        files.clear();
        await Promise.all([stopping, searchWorker?.terminate()]);
      }
      return directory;
    },
    async grantFile(value: string) {
      const file = await canonical(value, true);
      files.add(file);
      return file;
    },
    resolveDocument: (file: string) => checked(file),
    resolveAsset: (file: string) => checked(file, false, true),
    async close() {
      closed = true;
      searchGeneration++;
      root = null;
      files.clear();
      await Promise.all([stopWatch(), searchWorker?.terminate()]);
    },
  };
}

export { createWorkspace };
