!macro LAT_KILL_GATEWAY
  ; The sidecar is a child process and NSIS does not know about it when the
  ; main LAT process is closed. Stop the whole process tree before deleting it.
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "hy-mt2-gateway.exe"' $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LAT_KILL_GATEWAY
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LAT_KILL_GATEWAY
!macroend
