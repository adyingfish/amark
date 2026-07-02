use serde::Serialize;

/// The kind of filesystem entry involved in a name-collision error. `Any` is
/// used where the target name could collide with either a file or a folder
/// and the code doesn't distinguish (e.g. creating a new folder).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
    Any,
}

/// Structured, translatable error for workspace file/folder operations. The
/// frontend maps `code` (and any accompanying data) to a localized message
/// instead of displaying Rust-side text directly.
#[derive(Debug, Serialize)]
#[serde(tag = "code")]
pub enum WorkspaceError {
    NameEmpty,
    NameHasSeparator,
    NameInvalid,
    EntryExists { kind: EntryKind, name: String },
    CannotLocateParentDir,
    NotMarkdownFile,
    NotADirectory,
    CreateFileFailed { reason: String },
    CreateDirFailed { reason: String },
    RenameFailed { reason: String },
    DeleteFailed { reason: String },
    ReadFailed { reason: String },
    WriteFailed { reason: String },
    ReadDirFailed { reason: String },
    Unexpected { reason: String },
}

impl std::fmt::Display for WorkspaceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The frontend (workspace-errors.ts) pattern-matches on this exact JSON
    // shape — a `code` string alongside the variant's own fields — rather
    // than a nested payload. Pin it so a serde attribute change can't
    // silently break that contract.
    #[test]
    fn serializes_unit_variant_as_bare_code() {
        let json = serde_json::to_value(WorkspaceError::NameEmpty).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "NameEmpty" }));
    }

    #[test]
    fn serializes_struct_variant_with_flattened_fields() {
        let json = serde_json::to_value(WorkspaceError::EntryExists {
            kind: EntryKind::Folder,
            name: "草稿".to_string(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "EntryExists", "kind": "folder", "name": "草稿" })
        );
    }

    #[test]
    fn serializes_reason_variant() {
        let json = serde_json::to_value(WorkspaceError::CreateFileFailed {
            reason: "permission denied".to_string(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "CreateFileFailed", "reason": "permission denied" })
        );
    }
}
