use crate::models::search_models::{SearchContentOverride, WorkspaceSearchResult};
use crate::services::workspace_search::search_workspace_directory;
use std::path::PathBuf;

#[tauri::command]
pub async fn search_workspace(
    root_path: String,
    query: String,
    case_sensitive: bool,
    show_hidden: bool,
    overrides: Vec<SearchContentOverride>,
) -> Result<WorkspaceSearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        search_workspace_directory(
            &PathBuf::from(root_path),
            &query,
            case_sensitive,
            show_hidden,
            overrides,
        )
    })
    .await
    .map_err(|error| format!("Search task failed: {error}"))
}
