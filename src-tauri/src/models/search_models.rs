use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct SearchContentOverride {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct WorkspaceSearchMatch {
    pub file_path: String,
    pub file_name: String,
    pub line: usize,
    pub column: usize,
    /// Absolute JavaScript UTF-16 offsets in the Markdown source.
    pub start: usize,
    pub end: usize,
    pub preview: String,
    pub preview_match_start: usize,
    pub preview_match_end: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct WorkspaceSearchResult {
    pub matches: Vec<WorkspaceSearchMatch>,
    pub truncated: bool,
}
