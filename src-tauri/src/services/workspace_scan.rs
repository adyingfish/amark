use crate::models::workspace_models::{FileNodeKind, WorkspaceFileNode, WorkspaceScanResult};
use crate::services::workspace_error::{EntryKind, WorkspaceError};
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
pub fn describe_workspace_directory(root_path: &Path) -> Result<(String, String), WorkspaceError> {
    let root_path = normalize_workspace_root(root_path);
    if !root_path.is_dir() {
        return Err(WorkspaceError::NotADirectory);
    }

    std::fs::read_dir(&root_path).map_err(|e| WorkspaceError::ReadDirFailed {
        reason: e.to_string(),
    })?;
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
) -> Result<WorkspaceScanResult, WorkspaceError> {
    let root_path = normalize_workspace_root(root_path);
    let name = workspace_name(&root_path);

    let files = scan_directory_recursive(&root_path, show_hidden)?;

    Ok(WorkspaceScanResult {
        root_path: root_path.to_string_lossy().to_string(),
        name,
        files,
    })
}

fn scan_directory_recursive(
    current_path: &Path,
    show_hidden: bool,
) -> Result<Vec<WorkspaceFileNode>, WorkspaceError> {
    let mut entries: Vec<WorkspaceFileNode> = Vec::new();

    let dir_entries =
        std::fs::read_dir(current_path).map_err(|e| WorkspaceError::ReadDirFailed {
            reason: e.to_string(),
        })?;

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
            match scan_directory_recursive(&path, show_hidden) {
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
fn sanitize_entry_name(name: &str) -> Result<&str, WorkspaceError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(WorkspaceError::NameEmpty);
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(WorkspaceError::NameHasSeparator);
    }
    if matches!(trimmed, "." | "..") {
        return Err(WorkspaceError::NameInvalid);
    }
    Ok(trimmed)
}

/// Normalize a user-supplied file name into a safe Markdown file name.
///
/// Rejects empty names and path separators (no traversal / nested creation),
/// and appends a `.md` extension when the name has no Markdown extension yet.
fn sanitize_markdown_name(name: &str) -> Result<String, WorkspaceError> {
    let trimmed = sanitize_entry_name(name)?;
    if is_markdown_file(Path::new(trimmed)) {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{}.md", trimmed))
    }
}

/// Create an empty Markdown file `name` inside `parent`, returning its full path.
pub fn create_markdown_file(
    parent: &Path,
    name: &str,
) -> Result<std::path::PathBuf, WorkspaceError> {
    let file_name = sanitize_markdown_name(name)?;
    let target = parent.join(&file_name);
    if target.exists() {
        return Err(WorkspaceError::EntryExists {
            kind: EntryKind::File,
            name: file_name,
        });
    }
    std::fs::write(&target, "").map_err(|e| WorkspaceError::CreateFileFailed {
        reason: e.to_string(),
    })?;
    Ok(target)
}

/// Create an empty folder named `name` inside `parent`, returning its full path.
pub fn create_directory(parent: &Path, name: &str) -> Result<std::path::PathBuf, WorkspaceError> {
    let dir_name = sanitize_entry_name(name)?;
    let target = parent.join(dir_name);
    if target.exists() {
        return Err(WorkspaceError::EntryExists {
            kind: EntryKind::Any,
            name: dir_name.to_string(),
        });
    }
    std::fs::create_dir(&target).map_err(|e| WorkspaceError::CreateDirFailed {
        reason: e.to_string(),
    })?;
    Ok(target)
}

/// Rename a file or directory to `new_name` (kept in the same parent
/// directory). Files are kept under the Markdown-name rules (`.md` is
/// appended when missing); directories only get the generic name validation
/// since they have no extension convention to enforce.
pub fn rename_fs_entry(path: &Path, new_name: &str) -> Result<std::path::PathBuf, WorkspaceError> {
    let is_dir = path.is_dir();
    let entry_name = if is_dir {
        sanitize_entry_name(new_name)?.to_string()
    } else {
        sanitize_markdown_name(new_name)?
    };
    let parent = path.parent().ok_or(WorkspaceError::CannotLocateParentDir)?;
    let target = parent.join(&entry_name);
    if target == path {
        return Ok(target);
    }
    if target.exists() {
        let kind = if is_dir {
            EntryKind::Folder
        } else {
            EntryKind::File
        };
        return Err(WorkspaceError::EntryExists {
            kind,
            name: entry_name,
        });
    }
    std::fs::rename(path, &target).map_err(|e| WorkspaceError::RenameFailed {
        reason: e.to_string(),
    })?;
    Ok(target)
}

/// Delete a Markdown file.
pub fn delete_markdown_file(path: &Path) -> Result<(), WorkspaceError> {
    if !is_markdown_file(path) {
        return Err(WorkspaceError::NotMarkdownFile);
    }
    std::fs::remove_file(path).map_err(|e| WorkspaceError::DeleteFailed {
        reason: e.to_string(),
    })
}

/// Read a file's content
pub async fn read_file_content(path: &Path) -> Result<String, WorkspaceError> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| WorkspaceError::ReadFailed {
            reason: e.to_string(),
        })
}

/// Save content to a file
pub async fn save_file_content(path: &Path, content: &str) -> Result<(), WorkspaceError> {
    tokio::fs::write(path, content)
        .await
        .map_err(|e| WorkspaceError::WriteFailed {
            reason: e.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_name_uses_final_path_component() {
        assert_eq!(workspace_name(Path::new("/home/user/my-notes")), "my-notes");
    }

    // `file_name()` returns `None` for `/`, `.`, `..` and similar roots —
    // must not panic or surface an empty name to the UI.
    #[test]
    fn workspace_name_falls_back_when_no_file_name_component() {
        assert_eq!(workspace_name(Path::new("/")), "workspace");
    }

    #[test]
    fn should_skip_entry_hides_dotfiles_unless_shown() {
        assert!(should_skip_entry(".git", false));
        assert!(!should_skip_entry(".git", true));
    }

    // Generated-noise directories are always excluded, independent of the
    // show-hidden preference.
    #[test]
    fn should_skip_entry_always_excludes_generated_dirs() {
        for name in ["node_modules", "target", "dist", "build"] {
            assert!(should_skip_entry(name, false));
            assert!(should_skip_entry(name, true));
        }
    }

    #[test]
    fn should_skip_entry_keeps_normal_names() {
        assert!(!should_skip_entry("notes.md", false));
        assert!(!should_skip_entry("notes.md", true));
    }

    #[test]
    fn is_markdown_file_accepts_known_extensions_case_insensitively() {
        for ext in ["md", "markdown", "mdown", "mkd", "MD", "Markdown"] {
            assert!(is_markdown_file(Path::new(&format!("note.{}", ext))));
        }
    }

    #[test]
    fn is_markdown_file_rejects_other_or_missing_extensions() {
        assert!(!is_markdown_file(Path::new("note.txt")));
        assert!(!is_markdown_file(Path::new("README")));
    }

    #[test]
    fn sanitize_entry_name_trims_surrounding_whitespace() {
        assert_eq!(sanitize_entry_name("  notes  ").unwrap(), "notes");
    }

    #[test]
    fn sanitize_entry_name_rejects_empty_or_whitespace_only() {
        assert!(matches!(
            sanitize_entry_name("   "),
            Err(WorkspaceError::NameEmpty)
        ));
    }

    #[test]
    fn sanitize_entry_name_rejects_path_separators() {
        assert!(matches!(
            sanitize_entry_name("a/b"),
            Err(WorkspaceError::NameHasSeparator)
        ));
        assert!(matches!(
            sanitize_entry_name("a\\b"),
            Err(WorkspaceError::NameHasSeparator)
        ));
    }

    #[test]
    fn sanitize_entry_name_rejects_dot_and_dotdot() {
        assert!(matches!(
            sanitize_entry_name("."),
            Err(WorkspaceError::NameInvalid)
        ));
        assert!(matches!(
            sanitize_entry_name(".."),
            Err(WorkspaceError::NameInvalid)
        ));
    }

    #[test]
    fn sanitize_markdown_name_appends_md_when_missing() {
        assert_eq!(sanitize_markdown_name("notes").unwrap(), "notes.md");
    }

    #[test]
    fn sanitize_markdown_name_keeps_existing_markdown_extension() {
        assert_eq!(
            sanitize_markdown_name("notes.markdown").unwrap(),
            "notes.markdown"
        );
    }

    #[test]
    fn sanitize_markdown_name_propagates_name_validation_errors() {
        assert!(matches!(
            sanitize_markdown_name(""),
            Err(WorkspaceError::NameEmpty)
        ));
        assert!(matches!(
            sanitize_markdown_name("a/b"),
            Err(WorkspaceError::NameHasSeparator)
        ));
    }
}
