; Tauri's built-in fileAssociations always points DefaultIcon at the app exe,
; so .md files show the AMark app icon instead of a dedicated file-type icon.
; This hook overrides it after Tauri registers the association (ProgID
; "AMark.Markdown" must match bundle.fileAssociations[0].name in tauri.conf.json).
; Written to HKCU explicitly (not SHCTX/HKCR) so it only affects the per-user
; AMark.Markdown ProgID AMark itself owns, never the merged HKCR view or
; .md\DefaultIcon shared by other Markdown editors.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\AMark.Markdown\DefaultIcon" "" "$INSTDIR\icons\amark_markdown_icon.ico,0"
  !insertmacro UPDATEFILEASSOC
!macroend
