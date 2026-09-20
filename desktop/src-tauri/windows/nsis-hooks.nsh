; QuotaVPN NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; Two jobs:
;
; 1) Shortcut hygiene. The app used to be called QuotaCards, and an update
;    skips the template's shortcut creation ($UpdateMode), so old-name
;    shortcuts could survive forever. Old installs may also have used the
;    per-machine layout, which puts shortcuts in the shared (Public) desktop
;    and the shared start menu, where a per-user cleanup never looks. A
;    short-lived 0.3.2 test build briefly named the shortcut "Quota"; that
;    name is legacy too. On every install and update: remove every legacy
;    shortcut name from every location Windows can show, then make sure the
;    single current shortcut (named after the app, QuotaVPN) exists.
;
; 2) Shell icon cache refresh, so nobody sees a stale icon after an update.
;    That repair used to be a manual script the user had to find and run;
;    the installer now does it on every install and every in-app update.

!macro QCVPN_PURGE_LEGACY_SHORTCUTS
  ; Shared locations first (per-machine era). A per-user installer may not
  ; have rights here; the reboot fallback covers that without failing.
  SetShellVarContext all
  Delete /REBOOTOK "$DESKTOP\QuotaCards.lnk"
  Delete /REBOOTOK "$DESKTOP\Quota.lnk"
  Delete /REBOOTOK "$SMPROGRAMS\QuotaCards.lnk"
  Delete /REBOOTOK "$SMPROGRAMS\Quota.lnk"
  RMDir /r "$SMPROGRAMS\QuotaCards"
  RMDir /r "$SMPROGRAMS\Quota"
  SetShellVarContext current

  ; Per-user locations. The extra profile paths cover a desktop that was
  ; moved by OneDrive redirection after the old shortcut was created.
  Delete "$DESKTOP\QuotaCards.lnk"
  Delete "$DESKTOP\Quota.lnk"
  Delete "$PROFILE\Desktop\QuotaCards.lnk"
  Delete "$PROFILE\Desktop\Quota.lnk"
  Delete "$PROFILE\OneDrive\Desktop\QuotaCards.lnk"
  Delete "$PROFILE\OneDrive\Desktop\Quota.lnk"
  Delete "$SMPROGRAMS\QuotaCards.lnk"
  Delete "$SMPROGRAMS\Quota.lnk"
  RMDir /r "$SMPROGRAMS\QuotaCards"
  RMDir /r "$SMPROGRAMS\Quota"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro QCVPN_PURGE_LEGACY_SHORTCUTS

  ; Exactly one shortcut, named after the app, always refreshed here. The
  ; template skips its own creation on updates, so this is what keeps the
  ; shortcut correct on every install and every in-app update.
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"

  DetailPrint "Refreshing the shell icon cache"
  nsExec::ExecToLog 'cmd /c del /f /q "%LOCALAPPDATA%\IconCache.db" 2>nul & del /f /q "%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db" 2>nul'
  FindFirst $0 $1 "$LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db"
  iconcache_loop:
    StrCmp $1 "" iconcache_done
    Delete /REBOOTOK "$LOCALAPPDATA\Microsoft\Windows\Explorer\$1"
    FindNext $0 $1
    Goto iconcache_loop
  iconcache_done:
  FindClose $0
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -show'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The template removes "$DESKTOP\${PRODUCTNAME}.lnk" itself; clean the
  ; legacy names here too. Restore the shell var context at the end so the
  ; rest of the uninstaller is unaffected.
  Delete "$DESKTOP\QuotaCards.lnk"
  Delete "$DESKTOP\Quota.lnk"
  Delete "$SMPROGRAMS\QuotaCards.lnk"
  Delete "$SMPROGRAMS\Quota.lnk"
  SetShellVarContext all
  Delete /REBOOTOK "$DESKTOP\QuotaCards.lnk"
  Delete /REBOOTOK "$DESKTOP\Quota.lnk"
  Delete /REBOOTOK "$SMPROGRAMS\QuotaCards.lnk"
  Delete /REBOOTOK "$SMPROGRAMS\Quota.lnk"
  SetShellVarContext current
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Same refresh after uninstall, so the removed shortcuts leave the shell
  ; cleanly instead of showing broken icons until the next rebuild.
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
!macroend
