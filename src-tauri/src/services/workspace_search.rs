use crate::models::search_models::{
    SearchContentOverride, WorkspaceSearchMatch, WorkspaceSearchResult,
};
use crate::services::workspace_scan::{
    is_markdown_file, normalize_workspace_root, should_skip_entry,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MAX_MATCHES_PER_FILE: usize = 50;
const MAX_TOTAL_MATCHES: usize = 500;
const PREVIEW_CONTEXT_CHARS: usize = 50;

pub fn search_workspace_directory(
    root_path: &Path,
    query: &str,
    case_sensitive: bool,
    show_hidden: bool,
    overrides: Vec<SearchContentOverride>,
) -> WorkspaceSearchResult {
    if query.is_empty() {
        return WorkspaceSearchResult {
            matches: vec![],
            truncated: false,
        };
    }

    let root = normalize_workspace_root(root_path);
    let overrides = validated_overrides(&root, overrides);
    let mut result = WorkspaceSearchResult {
        matches: Vec::new(),
        truncated: false,
    };
    search_directory_recursive(
        &root,
        query,
        case_sensitive,
        show_hidden,
        &overrides,
        &mut result,
    );
    result
}

fn validated_overrides(
    root: &Path,
    overrides: Vec<SearchContentOverride>,
) -> HashMap<PathBuf, String> {
    overrides
        .into_iter()
        .filter_map(|item| {
            let path = PathBuf::from(item.path);
            (path.starts_with(root) && is_markdown_file(&path)).then_some((path, item.content))
        })
        .collect()
}

fn search_directory_recursive(
    directory: &Path,
    query: &str,
    case_sensitive: bool,
    show_hidden: bool,
    overrides: &HashMap<PathBuf, String>,
    result: &mut WorkspaceSearchResult,
) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    for entry in entries {
        if result.matches.len() >= MAX_TOTAL_MATCHES {
            result.truncated = true;
            return;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_entry(&name, show_hidden) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            search_directory_recursive(
                &path,
                query,
                case_sensitive,
                show_hidden,
                overrides,
                result,
            );
        } else if metadata.is_file() && is_markdown_file(&path) {
            let content = overrides
                .get(&path)
                .cloned()
                .or_else(|| std::fs::read_to_string(&path).ok());
            if let Some(content) = content {
                search_file(&path, &content, query, case_sensitive, result);
            }
        }
    }
}

fn search_file(
    path: &Path,
    content: &str,
    query: &str,
    case_sensitive: bool,
    result: &mut WorkspaceSearchResult,
) {
    let mut file_matches = 0;
    let mut line_start_byte = 0;

    for (line_index, raw_line) in content.split_inclusive('\n').enumerate() {
        let without_newline = raw_line.strip_suffix('\n').unwrap_or(raw_line);
        let line = without_newline
            .strip_suffix('\r')
            .unwrap_or(without_newline);

        for (match_start, match_end) in literal_ranges(line, query, case_sensitive) {
            if file_matches >= MAX_MATCHES_PER_FILE || result.matches.len() >= MAX_TOTAL_MATCHES {
                result.truncated = true;
                return;
            }

            let absolute_start_byte = line_start_byte + match_start;
            let absolute_end_byte = line_start_byte + match_end;
            let (preview, preview_match_start, preview_match_end) =
                build_preview(line, match_start, match_end);
            result.matches.push(WorkspaceSearchMatch {
                file_path: path.to_string_lossy().to_string(),
                file_name: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_string(),
                line: line_index + 1,
                column: line[..match_start].chars().count() + 1,
                start: content[..absolute_start_byte].encode_utf16().count(),
                end: content[..absolute_end_byte].encode_utf16().count(),
                preview,
                preview_match_start,
                preview_match_end,
            });
            file_matches += 1;
        }

        line_start_byte += raw_line.len();
    }
}

fn literal_ranges(text: &str, query: &str, case_sensitive: bool) -> Vec<(usize, usize)> {
    let text_boundaries = char_boundaries(text);
    let query_chars = query.chars().count();
    if query_chars == 0 || query_chars + 1 > text_boundaries.len() {
        return vec![];
    }

    let normalized_query = if case_sensitive {
        String::new()
    } else {
        query.to_lowercase()
    };
    let mut ranges = Vec::new();
    let mut index = 0;
    while index + query_chars < text_boundaries.len() {
        let start = text_boundaries[index];
        let end = text_boundaries[index + query_chars];
        let candidate = &text[start..end];
        let is_match = if case_sensitive {
            candidate == query
        } else {
            candidate.to_lowercase() == normalized_query
        };
        if is_match {
            ranges.push((start, end));
            index += query_chars;
        } else {
            index += 1;
        }
    }
    ranges
}

fn char_boundaries(text: &str) -> Vec<usize> {
    text.char_indices()
        .map(|(index, _)| index)
        .chain(std::iter::once(text.len()))
        .collect()
}

fn build_preview(line: &str, match_start: usize, match_end: usize) -> (String, usize, usize) {
    let chars: Vec<char> = line.chars().collect();
    let start_char = line[..match_start].chars().count();
    let end_char = line[..match_end].chars().count();
    let window_start = start_char.saturating_sub(PREVIEW_CONTEXT_CHARS);
    let window_end = (end_char + PREVIEW_CONTEXT_CHARS).min(chars.len());
    let has_prefix = window_start > 0;
    let has_suffix = window_end < chars.len();

    let mut preview = String::new();
    if has_prefix {
        preview.push('…');
    }
    preview.extend(chars[window_start..window_end].iter());
    if has_suffix {
        preview.push('…');
    }

    let prefix_utf16 = usize::from(has_prefix);
    let before_match: String = chars[window_start..start_char].iter().collect();
    let matched: String = chars[start_char..end_char].iter().collect();
    let preview_match_start = prefix_utf16 + before_match.encode_utf16().count();
    let preview_match_end = preview_match_start + matched.encode_utf16().count();
    (preview, preview_match_start, preview_match_end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("amark-search-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn literal_ranges_supports_unicode_and_case_options() {
        assert_eq!(
            literal_ranges("😀Agent agent", "agent", false),
            vec![(4, 9), (10, 15)]
        );
        assert_eq!(literal_ranges("Agent agent", "Agent", true), vec![(0, 5)]);
        assert_eq!(
            literal_ranges("搜索功能搜索", "搜索", false),
            vec![(0, 6), (12, 18)]
        );
    }

    #[test]
    fn searches_markdown_and_reports_utf16_offsets() {
        let root = temp_workspace();
        fs::write(root.join("notes.md"), "😀 Agent\nsecond Agent line").unwrap();
        fs::write(root.join("ignored.txt"), "Agent").unwrap();

        let result = search_workspace_directory(&root, "Agent", true, false, vec![]);
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[0].start, 3);
        assert_eq!(result.matches[0].line, 1);
        assert_eq!(result.matches[1].line, 2);
        assert!(!result.truncated);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dirty_override_replaces_the_disk_version() {
        let root = temp_workspace();
        let file = root.join("notes.md");
        fs::write(&file, "old value").unwrap();

        let result = search_workspace_directory(
            &root,
            "new",
            false,
            false,
            vec![SearchContentOverride {
                path: file.to_string_lossy().to_string(),
                content: "new unsaved value".to_string(),
            }],
        );
        assert_eq!(result.matches.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hidden_and_generated_directories_follow_workspace_rules() {
        let root = temp_workspace();
        fs::create_dir_all(root.join(".private")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join(".private/hidden.md"), "needle").unwrap();
        fs::write(root.join("node_modules/generated.md"), "needle").unwrap();

        assert!(
            search_workspace_directory(&root, "needle", true, false, vec![])
                .matches
                .is_empty()
        );
        assert_eq!(
            search_workspace_directory(&root, "needle", true, true, vec![])
                .matches
                .len(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }
}
