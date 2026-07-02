// file_watch.rs - Workspace file watching service
use notify::{Config, Event, EventKind, PollWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, WebviewWindow};

/// Workspace watcher state. Held as a trait object so a network path can fall
/// back from the native `RecommendedWatcher` to a polling watcher. Wrapped in
/// `Arc<Mutex<..>>` (rather than owned outright) so the background thread in
/// `start_workspace_watch` that registers watches for newly discovered
/// directories can share it.
pub struct WorkspaceWatcher {
    pub _watcher: Arc<Mutex<Box<dyn Watcher + Send>>>,
}

pub type WatcherState = Arc<Mutex<HashMap<String, WorkspaceWatcher>>>;

/// Whether hidden files/folders (dotfiles) should be watched for one
/// window's workspace, kept in sync with that window's "show hidden
/// folders" preference so events from inside a now-visible hidden folder
/// aren't silently dropped. One flag per window (each window can watch a
/// different workspace with its own preference).
pub type ShowHiddenFlag = Arc<AtomicBool>;

/// App-wide registry of each window's `ShowHiddenFlag`, keyed by window
/// label and populated lazily via `get_or_create_show_hidden_flag`.
pub type ShowHiddenState = Arc<Mutex<HashMap<String, ShowHiddenFlag>>>;

/// Get — or lazily create, defaulting to `false` — the `ShowHiddenFlag` for
/// `window_label`. Shared by the `start_watch_workspace` and
/// `set_show_hidden_files` commands so both read/write the same per-window
/// flag regardless of call order.
pub fn get_or_create_show_hidden_flag(state: &ShowHiddenState, window_label: &str) -> ShowHiddenFlag {
    state
        .lock()
        .unwrap()
        .entry(window_label.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

/// File change event payload for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileChangedEvent {
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileCreatedEvent {
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileRemovedEvent {
    pub path: String,
}

/// Check if a path is a Markdown file
fn is_markdown_file(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext_lower = ext.to_lowercase();
            ext_lower == "md"
                || ext_lower == "markdown"
                || ext_lower == "mdown"
                || ext_lower == "mkd"
        })
        .unwrap_or(false)
}

/// Check if a file should be watched (not hidden unless `show_hidden`).
/// Generated-noise directories are excluded structurally, at watch
/// registration time (see `WATCH_EXCLUDED_DIRS`), so events from inside them
/// never reach this filter in the first place.
fn should_watch_path(path: &PathBuf, show_hidden: bool) -> bool {
    if !show_hidden
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
    {
        return false;
    }

    true
}

/// A network / UNC path (e.g. a WSL `\\wsl.localhost\…` share) does not deliver
/// native filesystem notifications, so `ReadDirectoryChangesW` (the recommended
/// watcher on Windows) silently sees nothing. Detect those paths so we can fall
/// back to a polling watcher.
fn is_network_path(root_path: &Path) -> bool {
    let s = root_path.to_string_lossy();
    s.starts_with(r"\\") || s.contains("wsl.localhost") || s.contains("wsl$")
}

/// Directory names that are never watched: large generated-artifact folders
/// whose contents are irrelevant to a Markdown workspace. `node_modules` in
/// particular can hold tens of thousands of subdirectories — enough to
/// exhaust inotify's `max_user_watches`, or, on the `PollWatcher` fallback,
/// to make every 2-second poll tick re-stat the entire tree. Checked by
/// directory *name*, and applied before a directory is ever registered with
/// the watcher, rather than filtering events after the fact.
const WATCH_EXCLUDED_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", ".git"];

fn is_excluded_dir(name: &str) -> bool {
    WATCH_EXCLUDED_DIRS.contains(&name)
}

/// Recursively register a non-recursive watch on `dir` and every
/// non-excluded subdirectory beneath it. Used both for the initial workspace
/// walk and, from `start_workspace_watch`'s registrar thread, when a
/// directory appears that may already have pre-existing children (e.g. one
/// moved in from outside the workspace).
fn watch_dir_tree(watcher: &mut dyn Watcher, dir: &Path) {
    if watcher.watch(dir, RecursiveMode::NonRecursive).is_err() {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let name = entry.file_name();
        if is_excluded_dir(&name.to_string_lossy()) {
            continue;
        }
        watch_dir_tree(watcher, &entry.path());
    }
}

/// Spawn the background thread that registers watches for directories
/// discovered after the initial walk (created, or moved/renamed in from
/// outside an already-watched location). This must run on its own thread
/// rather than inline in the notify event handler: both the inotify and
/// poll backends invoke the event handler from the very thread that must
/// also process a `watch()` call, so calling `watch()` synchronously from
/// inside the callback would deadlock.
///
/// Holds only a `Weak` handle so it never keeps `watcher` alive on its own:
/// once the last strong `Arc` is dropped (`stop_workspace_watch`), the
/// watcher — and the channel sender its event handler owns — is dropped
/// too, closing the channel and ending this thread on its next receive.
fn spawn_new_dir_registrar(
    watcher: &Arc<Mutex<Box<dyn Watcher + Send>>>,
    new_dir_rx: std::sync::mpsc::Receiver<PathBuf>,
) {
    let weak_watcher = Arc::downgrade(watcher);
    let _ = thread::Builder::new()
        .name("amark-watch-register".to_string())
        .spawn(move || {
            for path in new_dir_rx {
                let Some(watcher) = weak_watcher.upgrade() else {
                    break;
                };
                let mut guard = match watcher.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                watch_dir_tree(&mut **guard, &path);
            }
        });
}

/// Start watching a workspace directory for `window`. `show_hidden_flag` is
/// read live (via the shared atomic) on every event, so toggling it later
/// doesn't require restarting the watcher.
pub fn start_workspace_watch(
    window: WebviewWindow,
    root_path: PathBuf,
    watchers: &WatcherState,
    show_hidden_flag: ShowHiddenFlag,
) -> Result<(), String> {
    let window_label = window.label().to_string();

    // Stop any existing watcher for this window
    stop_workspace_watch(&window_label, watchers);

    // Newly discovered directories (created, or moved/renamed in from
    // outside an already-watched location) are registered from a dedicated
    // thread below, never from inside `handler` itself: both the inotify and
    // poll backends invoke the event handler from the very thread that must
    // also process a `watch()` call, so calling `watch()` synchronously from
    // inside the callback would deadlock.
    let (new_dir_tx, new_dir_rx) = std::sync::mpsc::channel::<PathBuf>();

    let window_clone = window.clone();
    let handler = move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        let show_hidden = show_hidden_flag.load(Ordering::Relaxed);

        for path in &event.paths {
            if !path.is_dir() {
                continue;
            }
            let excluded = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(is_excluded_dir)
                .unwrap_or(false);
            if !excluded {
                let _ = new_dir_tx.send(path.clone());
            }
        }

        handle_watch_event(&window_clone, event, show_hidden);
    };

    // Create watcher. Network paths can't deliver native events, so poll instead.
    let mut watcher: Box<dyn Watcher + Send> = if is_network_path(&root_path) {
        match PollWatcher::new(
            handler,
            Config::default().with_poll_interval(Duration::from_secs(2)),
        ) {
            Ok(w) => Box::new(w),
            Err(e) => return Err(format!("Failed to create poll watcher: {}", e)),
        }
    } else {
        match notify::recommended_watcher(handler) {
            Ok(w) => Box::new(w),
            Err(e) => return Err(format!("Failed to create watcher: {}", e)),
        }
    };

    // Walk the tree ourselves and register one non-recursive watch per
    // directory, skipping generated-noise subtrees entirely (see
    // `WATCH_EXCLUDED_DIRS`) instead of watching everything recursively from
    // the root and filtering events after the fact.
    watch_dir_tree(&mut *watcher, &root_path);

    let watcher = Arc::new(Mutex::new(watcher));
    spawn_new_dir_registrar(&watcher, new_dir_rx);

    // Store the watcher
    {
        let mut guard = watchers.lock().unwrap();
        guard.insert(window_label, WorkspaceWatcher { _watcher: watcher });
    }

    Ok(())
}

/// Stop watching a workspace
pub fn stop_workspace_watch(window_label: &str, watchers: &WatcherState) {
    let mut guard = watchers.lock().unwrap();
    guard.remove(window_label);
}

/// Handle a file watch event. Emits are targeted at `window`'s label via
/// `emit_to` — a plain `emit()` would broadcast to every window regardless
/// of which `WebviewWindow` instance it's called on, so callers must also
/// listen with a window-scoped listener (e.g. `Window::listen`, not the
/// global `listen()`) for this targeting to actually take effect.
fn handle_watch_event(window: &WebviewWindow, event: Event, show_hidden: bool) {
    // Only care about Markdown files
    let paths: Vec<PathBuf> = event
        .paths
        .into_iter()
        .filter(|p| should_watch_path(p, show_hidden) && (is_markdown_file(p) || p.is_dir()))
        .collect();

    if paths.is_empty() {
        return;
    }

    let label = window.label();

    match event.kind {
        EventKind::Modify(_) => {
            for path in paths {
                if is_markdown_file(&path) {
                    let _ = window.emit_to(
                        label,
                        "workspace://file-changed",
                        FileChangedEvent {
                            path: path.to_string_lossy().to_string(),
                        },
                    );
                }
            }
        }
        EventKind::Create(_) => {
            for path in paths {
                if is_markdown_file(&path) {
                    let _ = window.emit_to(
                        label,
                        "workspace://file-created",
                        FileCreatedEvent {
                            path: path.to_string_lossy().to_string(),
                        },
                    );
                }
            }
        }
        EventKind::Remove(_) => {
            for path in paths {
                if is_markdown_file(&path) {
                    let _ = window.emit_to(
                        label,
                        "workspace://file-removed",
                        FileRemovedEvent {
                            path: path.to_string_lossy().to_string(),
                        },
                    );
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    /// Each window must get its own flag (identity, not just equal value),
    /// and repeat lookups for the same label must return that same flag
    /// rather than silently resetting it.
    #[test]
    fn show_hidden_flag_is_per_window_and_idempotent() {
        let state: ShowHiddenState = Arc::new(Mutex::new(HashMap::new()));
        let a1 = get_or_create_show_hidden_flag(&state, "main");
        let a2 = get_or_create_show_hidden_flag(&state, "main");
        assert!(Arc::ptr_eq(&a1, &a2));

        let b1 = get_or_create_show_hidden_flag(&state, "main-2");
        a1.store(true, Ordering::Relaxed);
        assert!(!b1.load(Ordering::Relaxed));
    }

    fn unique_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "amark-file-watch-test-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Excluded directories (node_modules, etc.) must never receive a watch:
    /// changes inside them should produce no events, while changes in a
    /// sibling directory that *is* watched must still be reported.
    #[test]
    fn excluded_dirs_are_never_watched() {
        let root = unique_temp_dir("excluded");
        std::fs::create_dir_all(root.join("sub1")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/inner")).unwrap();

        let (tx, rx) = mpsc::channel::<PathBuf>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                for p in event.paths {
                    let _ = tx.send(p);
                }
            }
        })
        .unwrap();

        watch_dir_tree(&mut watcher, &root);

        // A file inside the excluded subtree must not surface an event.
        std::fs::write(root.join("node_modules/inner/file.txt"), "x").unwrap();
        assert!(
            rx.recv_timeout(Duration::from_millis(500)).is_err(),
            "expected no event for a path inside an excluded directory"
        );

        // A file inside a legitimate, non-recursively-watched subdirectory
        // must still surface an event.
        std::fs::write(root.join("sub1/file.md"), "x").unwrap();
        let seen = rx.recv_timeout(Duration::from_secs(5));
        assert_eq!(seen, Ok(root.join("sub1/file.md")));

        drop(watcher);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A directory created after the initial walk must have its own
    /// (possibly pre-existing) contents watched too, via the registrar
    /// thread spawned by `spawn_new_dir_registrar` — this exercises the
    /// exact call path that would deadlock if `watch()` were invoked
    /// synchronously from inside the notify callback instead.
    #[test]
    fn new_directory_is_watched_via_registrar_thread() {
        let root = unique_temp_dir("new-dir");

        let (event_tx, event_rx) = mpsc::channel::<PathBuf>();
        let (new_dir_tx, new_dir_rx) = mpsc::channel::<PathBuf>();
        let handler = move |res: notify::Result<Event>| {
            let Ok(event) = res else { return };
            for path in &event.paths {
                if !path.is_dir() {
                    continue;
                }
                let excluded = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(is_excluded_dir)
                    .unwrap_or(false);
                if !excluded {
                    let _ = new_dir_tx.send(path.clone());
                }
            }
            for p in event.paths {
                let _ = event_tx.send(p);
            }
        };

        let mut watcher: Box<dyn Watcher + Send> =
            Box::new(notify::recommended_watcher(handler).unwrap());
        watch_dir_tree(&mut *watcher, &root);
        let watcher = Arc::new(Mutex::new(watcher));
        spawn_new_dir_registrar(&watcher, new_dir_rx);

        // Create a brand-new subdirectory with a file already inside it
        // (simulating a directory moved in from elsewhere), then wait for
        // the registrar thread to pick up the Create event and register it,
        // before writing a *second* file that only a dynamically-added
        // watch would catch.
        let sub2 = root.join("sub2");
        std::fs::create_dir_all(&sub2).unwrap();
        std::fs::write(sub2.join("existing.md"), "x").unwrap();
        std::thread::sleep(Duration::from_millis(500));
        std::fs::write(sub2.join("later.md"), "y").unwrap();

        let target = sub2.join("later.md");
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw_later = false;
        while Instant::now() < deadline {
            match event_rx.recv_timeout(Duration::from_millis(200)) {
                Ok(p) if p == target => {
                    saw_later = true;
                    break;
                }
                _ => {}
            }
        }
        assert!(
            saw_later,
            "expected an event for a file created inside a directory that appeared after the initial walk"
        );

        drop(watcher);
        let _ = std::fs::remove_dir_all(&root);
    }
}
