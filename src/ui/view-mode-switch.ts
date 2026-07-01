/**
 * How the editor area is displayed for the active document.
 *
 * - `preview-only`: read-only rendered view (仅预览).
 * - `wysiwyg`: editable WYSIWYG view (可视化编辑). Persisted preferences from
 *   before this rename used `preview`; loadSavedViewMode migrates that value.
 */
export type EditorViewMode = "source" | "wysiwyg" | "split" | "preview-only";
