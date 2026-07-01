// export/html.rs - HTML export.
//
// Writes the frontend-rendered, self-contained HTML document to a file chosen
// via the save dialog. The HTML is produced by the frontend (it inlines the
// active theme styles), so this side only handles path selection and writing.

use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::{suggest_filename, AppState};

#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    html: String,
) -> Result<bool, String> {
    let suggested = suggest_filename(state.inner(), window.label(), None);

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(format!("{suggested}.html"))
        .add_filter("HTML", &["html"])
        .save_file(move |p| {
            let _ = tx.send(p);
        });

    let path = match rx.await.map_err(|e| e.to_string())? {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Ok(false),
    };

    tokio::fs::write(path, html)
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
}
