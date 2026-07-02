use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

// ── Modules ──────────────────────────────────────────────────────────────────

mod commands;
mod export;
mod models;
mod services;

// ── State ────────────────────────────────────────────────────────────────────

#[derive(Default)]
struct WindowState {
    file_path: Option<PathBuf>,
}

pub(crate) type AppState = Arc<Mutex<HashMap<String, WindowState>>>;
type WorkspaceWatcherState = services::file_watch::WatcherState;
type ShowHiddenState = services::file_watch::ShowHiddenState;

/// File paths the app was launched with (file association / "Open with…"),
/// queued for the frontend to open and preview once it is ready. The frontend
/// pulls — and clears — them via `take_launch_files`, so a window reload can't
/// reopen them and there is no timer racing the webview's startup.
pub(crate) type LaunchFiles = Arc<Mutex<Vec<String>>>;

fn themes_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".amark")
        .join("themes")
}

fn ensure_themes_dir() {
    let _ = std::fs::create_dir_all(themes_dir());
}

// ── Window management ────────────────────────────────────────────────────────

fn next_window_label(app: &AppHandle) -> String {
    let windows = app.webview_windows();
    for i in 1..=200u32 {
        let label = if i == 1 {
            "main".to_string()
        } else {
            format!("main-{i}")
        };
        if !windows.contains_key(&label) {
            return label;
        }
    }
    format!(
        "main-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
    )
}

fn create_new_window(app: &AppHandle, states: &AppState) -> tauri::Result<WebviewWindow> {
    let label = next_window_label(app);
    // Mirror the "main" window defined in tauri.conf.json: native decorations
    // are disabled app-wide in favor of the custom HTML title bar (which carries
    // the close button and drag region). A programmatic window does NOT inherit
    // that config, so set it explicitly — otherwise the new window gets a native
    // frame stacked on top of the custom one.
    let window =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("AMark")
            .inner_size(960.0, 720.0)
            .min_inner_size(600.0, 400.0)
            .decorations(false)
            .center()
            .build()?;

    {
        let mut guard = states.lock().unwrap();
        guard.insert(label.clone(), WindowState::default());
    }

    Ok(window)
}

// ── Shared types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct ThemeResult {
    name: String,
    css: String,
}

/// A file the app was launched with, plus the directory that should be opened
/// as its workspace tree. `dir` is the file's parent (already canonical, like
/// `path`), or `None` for a filesystem-root file with no parent.
#[derive(Serialize, Clone)]
struct LaunchFile {
    path: String,
    dir: Option<String>,
}

// ── Commands ─────────────────────────────────────────────────────────────────

pub(crate) fn suggest_filename(
    states: &AppState,
    window_label: &str,
    content: Option<&str>,
) -> String {
    let guard = states.lock().unwrap();
    if let Some(s) = guard.get(window_label) {
        if let Some(p) = &s.file_path {
            if let Some(stem) = p.file_stem() {
                return stem.to_string_lossy().into_owned();
            }
        }
    }
    if let Some(text) = content {
        if let Some(line) = text.lines().next() {
            let title = line.trim_start_matches('#').trim();
            if !title.is_empty() {
                let clean: String = title
                    .chars()
                    .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
                    .take(60)
                    .collect();
                if !clean.is_empty() {
                    return clean;
                }
            }
        }
    }
    "untitled".to_string()
}

#[tauri::command]
async fn load_custom_theme(app: AppHandle) -> Result<Option<ThemeResult>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("CSS", &["css"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });

    let src_path = match rx.await.map_err(|e| e.to_string())? {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Ok(None),
    };

    let file_name = src_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let dest_path = themes_dir().join(&file_name);

    tokio::fs::copy(&src_path, &dest_path)
        .await
        .map_err(|e| e.to_string())?;

    let css = tokio::fs::read_to_string(&dest_path)
        .await
        .map_err(|e| e.to_string())?;

    Ok(Some(ThemeResult {
        name: file_name,
        css,
    }))
}

#[tauri::command]
async fn load_theme_css(file_name: String) -> Result<Option<String>, String> {
    match tokio::fs::read_to_string(themes_dir().join(&file_name)).await {
        Ok(css) => Ok(Some(css)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a Markdown file — reached via a relative link that resolves outside
/// the current workspace — in a brand new window. Queues the path on the same
/// `LaunchFiles` startup queue `take_launch_files` drains, so the new window
/// opens the file's folder as its workspace and previews it, exactly like a
/// fresh "Open with…" launch.
#[tauri::command]
async fn open_path_in_new_window(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    launch_files: tauri::State<'_, LaunchFiles>,
    path: String,
) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    let metadata = tokio::fs::metadata(&file_path)
        .await
        .map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err(format!("Not a file: {path}"));
    }
    let canonical = tokio::fs::canonicalize(&file_path)
        .await
        .map_err(|e| e.to_string())?;

    launch_files
        .lock()
        .unwrap()
        .push(canonical.to_string_lossy().into_owned());

    create_new_window(&app, state.inner())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Return — and clear — the files the app was launched with, each paired with
/// the directory to open as its workspace tree. The frontend calls this once
/// during startup to open and preview launch files; draining the queue ensures
/// a window reload won't reopen them.
///
/// Paths are canonical (queued that way in `setup`) so they line up with the
/// canonical paths `scan_workspace` produces — that keeps the previewed tab,
/// the active-file highlight in the tree, and the tab opened by clicking the
/// tree node all keyed on the same string.
#[tauri::command]
fn take_launch_files(state: tauri::State<'_, LaunchFiles>) -> Vec<LaunchFile> {
    std::mem::take(&mut *state.lock().unwrap())
        .into_iter()
        .map(|path| {
            let dir = Path::new(&path)
                .parent()
                .map(|d| d.to_string_lossy().into_owned())
                .filter(|d| !d.is_empty());
            LaunchFile { path, dir }
        })
        .collect()
}

// ── Menu ─────────────────────────────────────────────────────────────────────

/// Execute a menu action by id. Shared by the HTML menu bar and keyboard
/// shortcuts in the frontend, both of which call the `menu_action` command.
/// The native menu has been removed; this keeps all action logic in Rust so
/// behavior (zoom, fullscreen, new window, custom themes) stays consistent.
///
/// Actions target `window` — the webview that dispatched the command — rather
/// than whichever window happens to report focus. On a fresh launch with no
/// document open the window may not yet be reported as focused, so a
/// focus-based lookup would silently drop events (e.g. theme switching).
fn run_menu_action(_app: &AppHandle, _app_state: &AppState, window: &WebviewWindow, id: &str) {
    match id {
        "new" => {
            // In the Phase 2 workspace flow, File ▸ New opens a blank, unsaved
            // "Untitled" document as a tab in the current window (handled by the
            // frontend) rather than spawning a separate window.
            let _ = window.emit("menu-new", ());
        }
        // These are forwarded as-is to the dispatching window
        "menu-open"
        | "menu-open-folder"
        | "menu-open-folder-path"
        | "menu-save"
        | "menu-save-as"
        | "menu-export-pdf"
        | "menu-export-html"
        | "menu-import-theme"
        | "view-toggle-hidden-files" => {
            let _ = window.emit(id, ());
        }
        "view-zoom-in" => {
            let _ = window.eval("document.documentElement.style.zoom = (parseFloat(document.documentElement.style.zoom || '1') + 0.1).toFixed(1)");
        }
        "view-zoom-out" => {
            let _ = window.eval("document.documentElement.style.zoom = Math.max(0.5, (parseFloat(document.documentElement.style.zoom || '1') - 0.1)).toFixed(1)");
        }
        "view-zoom-reset" => {
            let _ = window.eval("document.documentElement.style.zoom = '1'");
        }
        "view-fullscreen" => {
            let is_fullscreen = window.is_fullscreen().unwrap_or(false);
            let _ = window.set_fullscreen(!is_fullscreen);
        }
        "theme-light" => {
            let _ = window.emit("set-theme", "light");
        }
        "theme-dark" => {
            let _ = window.emit("set-theme", "dark");
        }
        "theme-literary" => {
            let _ = window.emit("set-theme", "literary");
        }
        "theme-newsprint" => {
            let _ = window.emit("set-theme", "newsprint");
        }
        "theme-academic" => {
            let _ = window.emit("set-theme", "academic");
        }
        id if id.starts_with("theme-custom:") => {
            let file_name = id["theme-custom:".len()..].to_string();
            let window_clone = window.clone();
            tauri::async_runtime::spawn(async move {
                let path = themes_dir().join(&file_name);
                if let Ok(css) = tokio::fs::read_to_string(&path).await {
                    let _ = window_clone.emit("set-theme", format!("custom:{file_name}"));
                    let _ = window_clone.emit("set-custom-css", css);
                }
            });
        }
        _ => {}
    }
}

#[tauri::command]
fn menu_action(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    id: String,
) {
    run_menu_action(&app, state.inner(), &window, &id);
}

/// List the custom theme CSS file names available in the themes directory.
/// Used by the frontend Theme menu to populate user-imported themes.
#[tauri::command]
fn list_custom_themes() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(themes_dir()) else {
        return vec![];
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".css"))
        .collect();
    names.sort();
    names
}

// ── App entry point ──────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state: AppState = Arc::new(Mutex::new(HashMap::new()));
    let watcher_state: WorkspaceWatcherState = Arc::new(Mutex::new(HashMap::new()));
    let launch_files: LaunchFiles = Arc::new(Mutex::new(Vec::new()));
    let show_hidden_state: ShowHiddenState = Arc::new(std::sync::atomic::AtomicBool::new(false));

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state.clone())
        .manage(watcher_state.clone())
        .manage(launch_files.clone())
        .manage(show_hidden_state.clone())
        .setup(move |_app| {
            ensure_themes_dir();

            // Initialize state for the default "main" window
            {
                let mut guard = app_state.lock().unwrap();
                guard.insert("main".to_string(), WindowState::default());
            }

            // The application menu is now an HTML menu bar in the custom title
            // bar; it dispatches actions via the `menu_action` command.

            // Files passed on launch (file association / "Open with…"). Queue
            // them so the frontend can pull and preview them via
            // `take_launch_files` once the webview is ready, instead of
            // starting blank. Only existing regular files are kept, and paths
            // are canonicalized so they match what `scan_workspace` yields for
            // the file's folder (see `take_launch_files`).
            let cli_files: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .map(PathBuf::from)
                .filter(|p| p.is_file())
                .map(|p| p.canonicalize().unwrap_or(p))
                .map(|p| p.to_string_lossy().into_owned())
                .collect();

            if !cli_files.is_empty() {
                *launch_files.lock().unwrap() = cli_files;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<AppState>() {
                    let mut guard = state.lock().unwrap();
                    guard.remove(window.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            export::html::export_html,
            export::pdf::export_pdf,
            load_custom_theme,
            load_theme_css,
            open_external,
            open_path_in_new_window,
            take_launch_files,
            menu_action,
            list_custom_themes,
            commands::workspace_commands::open_workspace_folder,
            commands::workspace_commands::scan_workspace,
            commands::workspace_commands::read_file,
            commands::workspace_commands::save_file_v2,
            commands::workspace_commands::create_markdown_file,
            commands::workspace_commands::create_directory,
            commands::workspace_commands::rename_path,
            commands::workspace_commands::delete_path,
            commands::workspace_commands::start_watch_workspace,
            commands::workspace_commands::stop_watch_workspace,
            commands::workspace_commands::set_show_hidden_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AMark")
}
