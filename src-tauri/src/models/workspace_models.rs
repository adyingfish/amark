use serde::{Deserialize, Serialize};

// ── Workspace Models ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFileNode {
    pub path: String,
    pub name: String,
    #[serde(rename = "kind")]
    pub kind: FileNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<WorkspaceFileNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileNodeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceScanResult {
    pub root_path: String,
    pub name: String,
    pub files: Vec<WorkspaceFileNode>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenWorkspaceResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContentResult {
    pub path: String,
    pub content: String,
}
