use crate::models::workspace_models::{
    FileContentResult, OpenWorkspaceResult, WorkspaceScanResult,
};
use crate::services::file_watch::{
    get_or_create_show_hidden_flag, start_workspace_watch, stop_workspace_watch, ShowHiddenState,
    WatcherState,
};
use crate::services::workspace_error::WorkspaceError;
use crate::services::workspace_scan::{
    describe_workspace_directory, read_file_content, scan_workspace_directory,
};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// Open a folder dialog and return the selected workspace identity
#[tauri::command]
pub async fn open_workspace_folder(
    app: AppHandle,
    _window: WebviewWindow,
) -> Result<OpenWorkspaceResult, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<tauri_plugin_dialog::FilePath>>();

    app.dialog()
        .file()
        .set_title("Open Workspace Folder")
        .pick_folder(move |p| {
            let _ = tx.send(p);
        });

    let file_path = match rx.await {
        Ok(Some(p)) => p,
        _ => {
            return Ok(OpenWorkspaceResult {
                success: false,
                root_path: None,
                name: None,
                error: None,
            })
        }
    };

    let folder_path = match file_path {
        tauri_plugin_dialog::FilePath::Path(p) => p,
        _ => {
            return Ok(OpenWorkspaceResult {
                success: false,
                root_path: None,
                name: None,
                error: Some("Invalid folder path".to_string()),
            })
        }
    };

    match describe_workspace_directory(&folder_path) {
        Ok((root_path, name)) => Ok(OpenWorkspaceResult {
            success: true,
            root_path: Some(root_path),
            name: Some(name),
            error: None,
        }),
        Err(e) => Ok(OpenWorkspaceResult {
            success: false,
            root_path: None,
            name: None,
            error: Some(e.to_string()),
        }),
    }
}

/// Scan a workspace directory and return the file tree
#[tauri::command]
pub async fn scan_workspace(
    app: AppHandle,
    root_path: String,
    show_hidden: bool,
) -> Result<WorkspaceScanResult, WorkspaceError> {
    let path = PathBuf::from(&root_path);
    // Let the webview load files under this workspace through the asset
    // protocol (local images referenced by documents). Scope grants are
    // additive and idempotent; failure only means those images won't render.
    if let Err(e) = app.asset_protocol_scope().allow_directory(&path, true) {
        eprintln!("Failed to extend asset protocol scope: {e}");
    }
    tauri::async_runtime::spawn_blocking(move || scan_workspace_directory(&path, show_hidden))
        .await
        .map_err(|e| WorkspaceError::Unexpected {
            reason: e.to_string(),
        })?
}

/// Read a file's content
#[tauri::command]
pub async fn read_file(app: AppHandle, path: String) -> Result<FileContentResult, WorkspaceError> {
    let file_path = PathBuf::from(&path);
    // Covers documents opened outside any workspace (file association,
    // standalone open): grant asset-protocol access to the document's
    // directory so its relative-path images can render.
    if let Some(parent) = file_path.parent() {
        if let Err(e) = app.asset_protocol_scope().allow_directory(parent, true) {
            eprintln!("Failed to extend asset protocol scope: {e}");
        }
    }
    let content = read_file_content(&file_path).await?;
    Ok(FileContentResult { path, content })
}

/// Start watching a workspace directory for `window`. `show_hidden` seeds
/// that window's hidden-files flag the watcher consults, so events under a
/// now-visible hidden folder aren't dropped from the very first watch.
#[tauri::command]
pub async fn start_watch_workspace(
    window: WebviewWindow,
    root_path: String,
    show_hidden: bool,
    watchers: State<'_, WatcherState>,
    show_hidden_state: State<'_, ShowHiddenState>,
) -> Result<bool, String> {
    let flag = get_or_create_show_hidden_flag(&show_hidden_state, window.label());
    flag.store(show_hidden, Ordering::Relaxed);
    let path = PathBuf::from(&root_path);
    let watchers = watchers.inner().clone();
    let window_for_watch = window.clone();
    // Registration now walks the workspace tree itself (see file_watch.rs),
    // so it's no longer a cheap call: keep it off the async runtime thread.
    let result = tauri::async_runtime::spawn_blocking(move || {
        start_workspace_watch(window_for_watch, path, &watchers, flag)
    })
    .await
    .map_err(|e| format!("Failed to start workspace watch: {}", e))?;

    match result {
        Ok(_) => Ok(true),
        Err(e) => {
            eprintln!("Failed to start workspace watch: {}", e);
            Ok(false)
        }
    }
}

/// Toggle whether `window`'s workspace watcher reports events for hidden
/// (dotfile) paths, without restarting the watcher or reopening the
/// workspace.
#[tauri::command]
pub async fn set_show_hidden_files(
    window: WebviewWindow,
    show_hidden: bool,
    show_hidden_state: State<'_, ShowHiddenState>,
) -> Result<(), String> {
    let flag = get_or_create_show_hidden_flag(&show_hidden_state, window.label());
    flag.store(show_hidden, Ordering::Relaxed);
    Ok(())
}

/// Stop watching a workspace directory for `window`.
#[tauri::command]
pub async fn stop_watch_workspace(
    window: WebviewWindow,
    _root_path: String,
    watchers: State<'_, WatcherState>,
) -> Result<bool, String> {
    stop_workspace_watch(window.label(), watchers.inner());
    Ok(true)
}

/// Save content to a known file path (no dialog)
#[tauri::command]
pub async fn save_file_v2(path: String, content: String) -> Result<bool, WorkspaceError> {
    let file_path = std::path::PathBuf::from(&path);
    crate::services::workspace_scan::save_file_content(&file_path, &content).await?;
    Ok(true)
}

/// Create a new Markdown file inside `parent_path`, returning its full path.
#[tauri::command]
pub async fn create_markdown_file(
    parent_path: String,
    name: String,
) -> Result<String, WorkspaceError> {
    let parent = PathBuf::from(&parent_path);
    let path = crate::services::workspace_scan::create_markdown_file(&parent, &name)?;
    Ok(path.to_string_lossy().to_string())
}

/// Create a new folder inside `parent_path`, returning its full path.
#[tauri::command]
pub async fn create_directory(parent_path: String, name: String) -> Result<String, WorkspaceError> {
    let parent = PathBuf::from(&parent_path);
    let path = crate::services::workspace_scan::create_directory(&parent, &name)?;
    Ok(path.to_string_lossy().to_string())
}

/// Rename a file or directory, returning its new full path.
#[tauri::command]
pub async fn rename_path(path: String, new_name: String) -> Result<String, WorkspaceError> {
    let file_path = PathBuf::from(&path);
    let new_path = crate::services::workspace_scan::rename_fs_entry(&file_path, &new_name)?;
    Ok(new_path.to_string_lossy().to_string())
}

/// Delete a Markdown file.
#[tauri::command]
pub async fn delete_path(path: String) -> Result<bool, WorkspaceError> {
    let file_path = PathBuf::from(&path);
    crate::services::workspace_scan::delete_markdown_file(&file_path)?;
    Ok(true)
}
