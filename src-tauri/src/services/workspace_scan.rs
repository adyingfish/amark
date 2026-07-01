use crate::models::workspace_models::{FileNodeKind, WorkspaceFileNode, WorkspaceScanResult};
use std::path::{Path, PathBuf};

/// On Windows, `std::fs::canonicalize` returns a verbatim (`\\?\…`) path. For a
/// UNC location such as a WSL share that becomes `\\?\UNC\wsl.localhost\…`,
/// whose prefix breaks the file watcher and leaks into the UI. Strip the
/// verbatim prefix back to a plain path. No-op on non-Windows / non-verbatim
/// paths.
fn simplify_verbatim(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(s) = path.to_str() {
            if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
                return PathBuf::from(format!(r"\\{}", rest));
            }
            if let Some(rest) = s.strip_prefix(r"\\?\") {
                return PathBuf::from(rest);
            }
        }
    }
    path
}

fn normalize_workspace_root(root_path: &Path) -> PathBuf {
    // `canonicalize` resolves relative paths and symlinks, but it can fail
    // outright on some network filesystems (notably WSL `\\wsl$\…` / 9P shares,
    // which don't support the final-path query it relies on). Treat it as a
    // best-effort normalization: on failure, fall back to the path as given.
    // A genuinely bad path is still caught below by `read_dir`.
    match root_path.canonicalize() {
        Ok(p) => simplify_verbatim(p),
        Err(_) => root_path.to_path_buf(),
    }
}

fn workspace_name(root_path: &Path) -> String {
    root_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("workspace")
        .to_string()
}

/// Return canonical workspace identity without recursively building the file
/// tree. Used by the folder picker path before the frontend performs the real
/// scan with the current view preferences.
pub fn describe_workspace_directory(root_path: &Path) -> Result<(String, String), String> {
    let root_path = normalize_workspace_root(root_path);
    if !root_path.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }

    std::fs::read_dir(&root_path).map_err(|e| format!("Failed to read directory: {}", e))?;
    Ok((
        root_path.to_string_lossy().to_string(),
        workspace_name(&root_path),
    ))
}

/// Scan a directory for Markdown files and build a file tree. `show_hidden`
/// controls whether dotfile entries (`.git`, `.env`, …) are included; the
/// generated-noise blacklist (`node_modules`, `target`, …) is always skipped.
pub fn scan_workspace_directory(
    root_path: &Path,
    show_hidden: bool,
) -> Result<WorkspaceScanResult, String> {
    let root_path = normalize_workspace_root(root_path);
    let name = workspace_name(&root_path);

    let files = scan_directory_recursive(&root_path, &root_path, show_hidden)?;

    Ok(WorkspaceScanResult {
        root_path: root_path.to_string_lossy().to_string(),
        name,
        files,
    })
}

fn scan_directory_recursive(
    current_path: &Path,
    root_path: &Path,
    show_hidden: bool,
) -> Result<Vec<WorkspaceFileNode>, String> {
    let mut entries: Vec<WorkspaceFileNode> = Vec::new();

    let dir_entries =
        std::fs::read_dir(current_path).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in dir_entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/directories (unless shown) and large generated folders.
        if should_skip_entry(&name, show_hidden) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            // Recursively scan subdirectory
            match scan_directory_recursive(&path, root_path, show_hidden) {
                Ok(children) if !children.is_empty() => {
                    entries.push(WorkspaceFileNode {
                        path: path.to_string_lossy().to_string(),
                        name,
                        kind: FileNodeKind::Directory,
                        children: Some(children),
                    });
                }
                Ok(_) => {
                    // Empty directory - include it anyway for completeness
                    entries.push(WorkspaceFileNode {
                        path: path.to_string_lossy().to_string(),
                        name,
                        kind: FileNodeKind::Directory,
                        children: Some(vec![]),
                    });
                }
                Err(_) => continue,
            }
        } else if metadata.is_file() {
            // Only include Markdown files
            if is_markdown_file(&path) {
                entries.push(WorkspaceFileNode {
                    path: path.to_string_lossy().to_string(),
                    name,
                    kind: FileNodeKind::File,
                    children: None,
                });
            }
        }
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| match (&a.kind, &b.kind) {
        (FileNodeKind::Directory, FileNodeKind::File) => std::cmp::Ordering::Less,
        (FileNodeKind::File, FileNodeKind::Directory) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

fn should_skip_entry(name: &str, show_hidden: bool) -> bool {
    (!show_hidden && name.starts_with('.'))
        || matches!(name, "node_modules" | "target" | "dist" | "build")
}

fn is_markdown_file(path: &Path) -> bool {
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

/// Validate a user-supplied name for any filesystem entry: non-empty, no path
/// separators (no traversal / nested creation) and not `.`/`..`.
fn sanitize_entry_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("名称不能包含路径分隔符".to_string());
    }
    if matches!(trimmed, "." | "..") {
        return Err("名称无效".to_string());
    }
    Ok(trimmed)
}

/// Normalize a user-supplied file name into a safe Markdown file name.
///
/// Rejects empty names and path separators (no traversal / nested creation),
/// and appends a `.md` extension when the name has no Markdown extension yet.
fn sanitize_markdown_name(name: &str) -> Result<String, String> {
    let trimmed = sanitize_entry_name(name)?;
    if is_markdown_file(Path::new(trimmed)) {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{}.md", trimmed))
    }
}

/// Create an empty Markdown file `name` inside `parent`, returning its full path.
pub fn create_markdown_file(parent: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    let file_name = sanitize_markdown_name(name)?;
    let target = parent.join(&file_name);
    if target.exists() {
        return Err(format!("已存在同名文件：{}", file_name));
    }
    std::fs::write(&target, "").map_err(|e| format!("Failed to create file: {}", e))?;
    Ok(target)
}

/// Create an empty folder named `name` inside `parent`, returning its full path.
pub fn create_directory(parent: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    let dir_name = sanitize_entry_name(name)?;
    let target = parent.join(dir_name);
    if target.exists() {
        return Err(format!("已存在同名文件或文件夹：{}", dir_name));
    }
    std::fs::create_dir(&target).map_err(|e| format!("Failed to create folder: {}", e))?;
    Ok(target)
}

/// Rename a file or directory to `new_name` (kept in the same parent
/// directory). Files are kept under the Markdown-name rules (`.md` is
/// appended when missing); directories only get the generic name validation
/// since they have no extension convention to enforce.
pub fn rename_fs_entry(path: &Path, new_name: &str) -> Result<std::path::PathBuf, String> {
    let is_dir = path.is_dir();
    let entry_name = if is_dir {
        sanitize_entry_name(new_name)?.to_string()
    } else {
        sanitize_markdown_name(new_name)?
    };
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位所在目录".to_string())?;
    let target = parent.join(&entry_name);
    if target == path {
        return Ok(target);
    }
    if target.exists() {
        let label = if is_dir { "文件夹" } else { "文件" };
        return Err(format!("已存在同名{}：{}", label, entry_name));
    }
    std::fs::rename(path, &target).map_err(|e| format!("Failed to rename: {}", e))?;
    Ok(target)
}

/// Delete a Markdown file.
pub fn delete_markdown_file(path: &Path) -> Result<(), String> {
    if !is_markdown_file(path) {
        return Err("只能删除 Markdown 文件".to_string());
    }
    std::fs::remove_file(path).map_err(|e| format!("Failed to delete file: {}", e))
}

/// Read a file's content
pub async fn read_file_content(path: &Path) -> Result<String, String> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// Save content to a file
pub async fn save_file_content(path: &Path, content: &str) -> Result<(), String> {
    tokio::fs::write(path, content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}
