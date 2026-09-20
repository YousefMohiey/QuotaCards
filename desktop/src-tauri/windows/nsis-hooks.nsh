; QuotaCards NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; Windows caches shell icons by file path, so an update that replaces the app
; exe in place can keep showing the previous icon in Explorer, the taskbar
; and the Start menu until the icon cache is rebuilt. That repair used to be
; a manual script the user had to find and run. The installer now does it on
; every install and every in-app update, so nobody ever sees a stale icon.
;
; Order mirrors the proven manual recipe: clear the on-disk cache first,
; schedule whatever Explorer holds open for deletion at the next reboot,
; then tell the shell to drop its in-memory icons and re-read what is there.

!macro NSIS_HOOK_POSTINSTALL
  ; --- Shortcut hygiene: the app used to be called QuotaCards, and an update
  ; skips shortcut creation ($UpdateMode), so old desktops kept the old-name
  ; shortcut forever. Drop it and make sure a current one exists.
  IfFileExists "$DESKTOP\QuotaCards.lnk" 0 qc_desktop_new
    Delete "$DESKTOP\QuotaCards.lnk"
    DetailPrint "Removed the old QuotaCards desktop shortcut"
  qc_desktop_new:
  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" qc_desktop_done 0
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    DetailPrint "Desktop shortcut updated"
  qc_desktop_done:
  IfFileExists "$SMPROGRAMS\QuotaCards.lnk" 0 qc_sm_new
    Delete "$SMPROGRAMS\QuotaCards.lnk"
  qc_sm_new:
  IfFileExists "$SMPROGRAMS\QuotaCards\*.*" 0 qc_sm_done
    RMDir /r "$SMPROGRAMS\QuotaCards"
  qc_sm_done:

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

!macro NSIS_HOOK_POSTUNINSTALL
  ; Same refresh after uninstall, so the removed shortcuts leave the shell
  ; cleanly instead of showing broken icons until the next rebuild.
  nsExec::ExecToLog '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
!macroend
