// file_watch.rs - Workspace file watching service
use notify::{Config, Event, EventKind, PollWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Workspace watcher state. Held as a trait object so a network path can fall
/// back from the native `RecommendedWatcher` to a polling watcher.
pub struct WorkspaceWatcher {
    pub _watcher: Box<dyn Watcher + Send>,
}

pub type WatcherState = Arc<Mutex<HashMap<String, WorkspaceWatcher>>>;

/// Whether hidden files/folders (dotfiles) should be watched, kept in sync
/// with the frontend's "show hidden folders" preference so events from
/// inside a now-visible hidden folder aren't silently dropped. Shared (not
/// per-watcher) since the app only watches one workspace at a time.
pub type ShowHiddenState = Arc<AtomicBool>;

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

/// Check if a file should be watched (not hidden unless `show_hidden`, not in
/// node_modules, etc.)
fn should_watch_path(path: &PathBuf, show_hidden: bool) -> bool {
    // Skip hidden files/directories, unless the caller wants them shown.
    if !show_hidden
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
    {
        return false;
    }

    // Skip common non-source directories
    let path_str = path.to_string_lossy();
    let skip_patterns = ["/node_modules/", "/target/", "/dist/", "/.git/", "/build/"];
    for pattern in &skip_patterns {
        if path_str.contains(pattern) {
            return false;
        }
    }

    true
}

/// A network / UNC path (e.g. a WSL `\\wsl.localhost\…` share) does not deliver
/// native filesystem notifications, so `ReadDirectoryChangesW` (the recommended
/// watcher on Windows) silently sees nothing. Detect those paths so we can fall
/// back to a polling watcher.
fn is_network_path(root_path: &PathBuf) -> bool {
    let s = root_path.to_string_lossy();
    s.starts_with(r"\\") || s.contains("wsl.localhost") || s.contains("wsl$")
}

/// Start watching a workspace directory. `show_hidden` is read live (via the
/// shared atomic) on every event, so toggling it later doesn't require
/// restarting the watcher.
pub fn start_workspace_watch(
    app: AppHandle,
    root_path: PathBuf,
    watchers: &WatcherState,
    show_hidden_state: ShowHiddenState,
) -> Result<(), String> {
    let window_label = "main".to_string(); // Default window label

    // Stop any existing watcher for this window
    stop_workspace_watch(&window_label, watchers);

    // Create watcher. Network paths can't deliver native events, so poll instead.
    let app_clone = app.clone();
    let handler = move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let show_hidden = show_hidden_state.load(Ordering::Relaxed);
            handle_watch_event(&app_clone, event, show_hidden);
        }
    };
    let mut _watcher: Box<dyn Watcher + Send> = if is_network_path(&root_path) {
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

    // Watch the root path recursively
    if let Err(e) = _watcher.watch(&root_path, RecursiveMode::Recursive) {
        return Err(format!("Failed to watch directory: {}", e));
    }

    // Store the watcher
    {
        let mut guard = watchers.lock().unwrap();
        guard.insert(window_label, WorkspaceWatcher { _watcher });
    }

    Ok(())
}

/// Stop watching a workspace
pub fn stop_workspace_watch(window_label: &str, watchers: &WatcherState) {
    let mut guard = watchers.lock().unwrap();
    guard.remove(window_label);
}

/// Handle a file watch event
fn handle_watch_event(app: &AppHandle, event: Event, show_hidden: bool) {
    // Only care about Markdown files
    let paths: Vec<PathBuf> = event
        .paths
        .into_iter()
        .filter(|p| should_watch_path(p, show_hidden) && (is_markdown_file(p) || p.is_dir()))
        .collect();

    if paths.is_empty() {
        return;
    }

    match event.kind {
        EventKind::Modify(_) => {
            for path in paths {
                if is_markdown_file(&path) {
                    let _ = app.emit(
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
                    let _ = app.emit(
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
                    let _ = app.emit(
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
