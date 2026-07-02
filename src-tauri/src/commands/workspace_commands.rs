use crate::models::workspace_models::{
    FileContentResult, OpenWorkspaceResult, WorkspaceScanResult,
};
use crate::services::file_watch::{
    start_workspace_watch, stop_workspace_watch, ShowHiddenState, WatcherState,
};
use crate::services::workspace_scan::{
    describe_workspace_directory, read_file_content, scan_workspace_directory,
};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State, WebviewWindow};
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
            error: Some(e),
        }),
    }
}

/// Scan a workspace directory and return the file tree
#[tauri::command]
pub async fn scan_workspace(
    root_path: String,
    show_hidden: bool,
) -> Result<WorkspaceScanResult, String> {
    let path = PathBuf::from(&root_path);
    tauri::async_runtime::spawn_blocking(move || scan_workspace_directory(&path, show_hidden))
        .await
        .map_err(|e| format!("Failed to scan workspace: {}", e))?
}

/// Read a file's content
#[tauri::command]
pub async fn read_file(path: String) -> Result<FileContentResult, String> {
    let file_path = PathBuf::from(&path);
    let content = read_file_content(&file_path).await?;
    Ok(FileContentResult { path, content })
}

/// Start watching a workspace directory. `show_hidden` seeds the shared
/// hidden-files flag the watcher consults, so events under a now-visible
/// hidden folder aren't dropped from the very first watch.
#[tauri::command]
pub async fn start_watch_workspace(
    app: AppHandle,
    root_path: String,
    show_hidden: bool,
    watchers: State<'_, WatcherState>,
    show_hidden_state: State<'_, ShowHiddenState>,
) -> Result<bool, String> {
    show_hidden_state.store(show_hidden, Ordering::Relaxed);
    let path = PathBuf::from(&root_path);
    match start_workspace_watch(
        app,
        path,
        watchers.inner(),
        show_hidden_state.inner().clone(),
    ) {
        Ok(_) => Ok(true),
        Err(e) => {
            eprintln!("Failed to start workspace watch: {}", e);
            Ok(false)
        }
    }
}

/// Toggle whether the workspace watcher reports events for hidden
/// (dotfile) paths, without restarting the watcher or reopening the
/// workspace.
#[tauri::command]
pub async fn set_show_hidden_files(
    show_hidden: bool,
    show_hidden_state: State<'_, ShowHiddenState>,
) -> Result<(), String> {
    show_hidden_state.store(show_hidden, Ordering::Relaxed);
    Ok(())
}

/// Stop watching a workspace directory
#[tauri::command]
pub async fn stop_watch_workspace(
    _root_path: String,
    watchers: State<'_, WatcherState>,
) -> Result<bool, String> {
    // For simplicity, stop the main window's watcher
    stop_workspace_watch("main", watchers.inner());
    Ok(true)
}

/// Save content to a known file path (no dialog)
#[tauri::command]
pub async fn save_file_v2(path: String, content: String) -> Result<bool, String> {
    let file_path = std::path::PathBuf::from(&path);
    crate::services::workspace_scan::save_file_content(&file_path, &content).await?;
    Ok(true)
}

/// Create a new Markdown file inside `parent_path`, returning its full path.
#[tauri::command]
pub async fn create_markdown_file(parent_path: String, name: String) -> Result<String, String> {
    let parent = PathBuf::from(&parent_path);
    let path = crate::services::workspace_scan::create_markdown_file(&parent, &name)?;
    Ok(path.to_string_lossy().to_string())
}

/// Create a new folder inside `parent_path`, returning its full path.
#[tauri::command]
pub async fn create_directory(parent_path: String, name: String) -> Result<String, String> {
    let parent = PathBuf::from(&parent_path);
    let path = crate::services::workspace_scan::create_directory(&parent, &name)?;
    Ok(path.to_string_lossy().to_string())
}

/// Rename a file or directory, returning its new full path.
#[tauri::command]
pub async fn rename_path(path: String, new_name: String) -> Result<String, String> {
    let file_path = PathBuf::from(&path);
    let new_path = crate::services::workspace_scan::rename_fs_entry(&file_path, &new_name)?;
    Ok(new_path.to_string_lossy().to_string())
}

/// Delete a Markdown file.
#[tauri::command]
pub async fn delete_path(path: String) -> Result<bool, String> {
    let file_path = PathBuf::from(&path);
    crate::services::workspace_scan::delete_markdown_file(&file_path)?;
    Ok(true)
}
