; Tauri saved its per-user directory under the manufacturer's key. Preserve
; that directory on the first Electron upgrade without seeding registry values
; during setup (the user can cancel). Later upgrades use electron-builder's key.
!ifndef BUILD_UNINSTALLER
  Var AMarkLegacyDirectory

  !macro customInit
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 == ""
      ReadRegStr $0 HKCU "Software\marswave\AMark" ""
      ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      ${If} $0 != ""
      ${AndIf} $1 == '"$0\uninstall.exe"'
      ${AndIf} ${FileExists} "$0\amark.exe"
      ${AndIf} ${FileExists} "$0\uninstall.exe"
        StrCpy $AMarkLegacyDirectory $0
        Call AMarkCheckLegacyContents
        Call AMarkUseLegacyDirectory
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customHeader
    Function AMarkCheckLegacyContents
      ; Electron's uninstaller owns the entire directory. Tauri owned two
      ; executables and one icon, and a user may have stored notes beside them.
      FindFirst $R0 $R1 "$AMarkLegacyDirectory\*"
      loopRoot:
        StrCmp $R1 "" checkIcons
        StrCmp $R1 "." nextRoot
        StrCmp $R1 ".." nextRoot
        StrCmp $R1 "amark.exe" nextRoot
        StrCmp $R1 "uninstall.exe" nextRoot
        StrCmp $R1 "icons" nextRoot shared
      nextRoot:
        FindNext $R0 $R1
        Goto loopRoot
      checkIcons:
        FindClose $R0
        IfFileExists "$AMarkLegacyDirectory\icons\*.*" 0 done
        FindFirst $R0 $R1 "$AMarkLegacyDirectory\icons\*"
      loopIcons:
        StrCmp $R1 "" close
        StrCmp $R1 "." nextIcon
        StrCmp $R1 ".." nextIcon
        StrCmp $R1 "amark_markdown_icon.ico" nextIcon shared
      nextIcon:
        FindNext $R0 $R1
        Goto loopIcons
      shared:
        ; Use a new dedicated child, including when the legacy path already
        ; equals electron-builder's default destination. Never reuse a child.
        StrCpy $R2 "$AMarkLegacyDirectory\AMark Desktop"
        StrCpy $R3 0
        StrCpy $AMarkLegacyDirectory $R2
      pickChild:
        IfFileExists "$AMarkLegacyDirectory" 0 close
        IntOp $R3 $R3 + 1
        StrCpy $AMarkLegacyDirectory "$R2 $R3"
        Goto pickChild
      close:
        FindClose $R0
      done:
    FunctionEnd

    Function AMarkUseLegacyDirectory
      ${If} $AMarkLegacyDirectory != ""
      ${AndIf} $installMode == "CurrentUser"
        !insertmacro GetDParameter $0
        ${If} $0 == ""
          StrCpy $perUserInstallationFolder $AMarkLegacyDirectory
          StrCpy $hasPerUserInstallation "1"
          StrCpy $INSTDIR $AMarkLegacyDirectory
        ${EndIf}
      ${EndIf}
    FunctionEnd
  !macroend

  !macro customInstallMode
    ; The assisted installer's mode page recalculates $INSTDIR on Next.
    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE AMarkUseLegacyDirectory
    ${If} $AMarkLegacyDirectory != ""
    ${AndIf} ${isForCurrentUser}
      !insertmacro setInstallModePerUser
      Call AMarkUseLegacyDirectory
      Abort ; skip the mode page when /currentuser was explicitly requested
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    ; electron-builder normally appends the product name when the chosen path
    ; lacks it. A verified Tauri install in a custom path already has a home.
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define MUI_PAGE_CUSTOMFUNCTION_PRE AMarkCheckInstallDirectory
    Function AMarkCheckInstallDirectory
      ${If} $installMode == "CurrentUser"
        ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
        ${If} $INSTDIR == $AMarkLegacyDirectory
        ${OrIf} $INSTDIR == $0
          Return
        ${EndIf}
      ${EndIf}
      Call instFilesPre
    FunctionEnd
  !macroend

  !macro customInstall
    ; Keep Windows' executable and document arguments unambiguous if either
    ; the selected installation directory or the Markdown path contains spaces.
    WriteRegStr SHELL_CONTEXT "Software\Classes\AMark.Markdown\shell\open\command" "" '"$appExe" "%1"'
  !macroend
!endif
