// export/pdf.rs - PDF export.
//
// On Windows we drive WebView2's `PrintToPdf` to produce a PDF file with no
// print dialog. The content is rendered in a hidden, offscreen webview that
// loads a self-contained HTML document (the same one used for HTML export), so
// only the document — not the app chrome — ends up in the PDF.
//
// On every other platform native export is unsupported: the command returns
// `Ok(false)`, which tells the frontend to fall back to the browser print
// dialog (`window.print()`).

use tauri::{AppHandle, WebviewWindow};

use crate::AppState;

/// Export the given standalone HTML document as a PDF.
///
/// Returns `true` when handled natively (Windows), `false` to signal the
/// frontend to fall back to the browser print dialog.
#[tauri::command]
pub async fn export_pdf(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    html: String,
) -> Result<bool, String> {
    let states = state.inner().clone();
    run(app, window, states, html).await
}

#[cfg(windows)]
async fn run(
    app: AppHandle,
    window: WebviewWindow,
    states: AppState,
    html: String,
) -> Result<bool, String> {
    windows_impl::export_pdf(app, window, states, html).await
}

#[cfg(not(windows))]
async fn run(
    _app: AppHandle,
    _window: WebviewWindow,
    _states: AppState,
    _html: String,
) -> Result<bool, String> {
    // Not supported natively here; the frontend falls back to window.print().
    Ok(false)
}

#[cfg(windows)]
mod windows_impl {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use tauri::{
        webview::PageLoadEvent, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow,
        WebviewWindowBuilder,
    };
    use tauri_plugin_dialog::DialogExt;

    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING, PCWSTR};

    use crate::{suggest_filename, AppState};

    pub async fn export_pdf(
        app: AppHandle,
        window: WebviewWindow,
        states: AppState,
        html: String,
    ) -> Result<bool, String> {
        // 1. Ask the user where to save the PDF.
        let suggested = suggest_filename(&states, window.label(), None);
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog()
            .file()
            .set_file_name(format!("{suggested}.pdf"))
            .add_filter("PDF", &["pdf"])
            .save_file(move |p| {
                let _ = tx.send(p);
            });

        let out_path: PathBuf = match rx.await.map_err(|e| e.to_string())? {
            Some(p) => p.into_path().map_err(|e| e.to_string())?,
            // User cancelled — treated as handled so the frontend does not also
            // pop the print dialog.
            None => return Ok(true),
        };

        // 2. Write the document to a temp HTML file the hidden webview can load.
        let tmp_path = std::env::temp_dir().join(format!(
            "amark-export-{}-{}.html",
            std::process::id(),
            unique_id()
        ));
        tokio::fs::write(&tmp_path, html)
            .await
            .map_err(|e| e.to_string())?;
        let file_url = tauri::Url::from_file_path(&tmp_path)
            .map_err(|_| "failed to build file URL for temp document".to_string())?;

        // 3. Open a hidden webview; print once the page finishes loading.
        let label = format!("amark-pdf-export-{}", unique_id());
        let printed = Arc::new(AtomicBool::new(false));

        let out_path_str = out_path.to_string_lossy().into_owned();
        let tmp_for_cb = tmp_path.clone();
        let label_for_cb = label.clone();
        let app_for_cb = app.clone();
        let src_label = window.label().to_string();

        let build_result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(file_url))
            .title("AMark PDF Export")
            .visible(false)
            .on_page_load(move |webview, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                // on_page_load can fire more than once; print only the first time.
                if printed.swap(true, Ordering::SeqCst) {
                    return;
                }

                let out_path_str = out_path_str.clone();
                let tmp_for_cb = tmp_for_cb.clone();
                let label_for_cb = label_for_cb.clone();
                let app_for_cb = app_for_cb.clone();
                let src_label = src_label.clone();

                let result = webview.with_webview(move |platform_webview| {
                    let print = || -> windows::core::Result<()> {
                        let controller = platform_webview.controller();
                        let core = unsafe { controller.CoreWebView2()? };
                        let core7: ICoreWebView2_7 = core.cast()?;

                        let path_h = HSTRING::from(out_path_str.as_str());

                        // Cleanup runs when PrintToPdf finishes (success or not):
                        // delete the temp file, close the hidden window, and tell
                        // the source window the result.
                        let handler = PrintToPdfCompletedHandler::create(Box::new(
                            move |error_code, is_successful| {
                                let _ = std::fs::remove_file(&tmp_for_cb);
                                if let Some(w) = app_for_cb.get_webview_window(&label_for_cb) {
                                    let _ = w.close();
                                }
                                let ok = error_code.is_ok() && is_successful;
                                if let Some(src) = app_for_cb.get_webview_window(&src_label) {
                                    let event = if ok {
                                        "pdf-export-done"
                                    } else {
                                        "pdf-export-error"
                                    };
                                    let _ = src.emit(event, ());
                                }
                                Ok(())
                            },
                        ));

                        unsafe {
                            core7.PrintToPdf(PCWSTR(path_h.as_ptr()), None, &handler)?;
                        }
                        Ok(())
                    };

                    if let Err(e) = print() {
                        eprintln!("PrintToPdf failed: {e}");
                    }
                });

                if let Err(e) = result {
                    eprintln!("with_webview failed during PDF export: {e}");
                }
            })
            .build();

        match build_result {
            Ok(_) => Ok(true),
            Err(e) => {
                let _ = std::fs::remove_file(&tmp_path);
                Err(e.to_string())
            }
        }
    }

    /// A cheap process-local unique suffix for temp file / window names.
    fn unique_id() -> u128 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    }
}
