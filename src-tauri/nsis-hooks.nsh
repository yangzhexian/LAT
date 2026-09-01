!macro LAT_KILL_GATEWAY
  ; The sidecar is a child process and NSIS does not know about it when the
  ; main LAT process is closed. Stop the whole process tree before deleting it.
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "hy-mt2-gateway.exe"' $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LAT_KILL_GATEWAY
  Call LAT_PROMPT_DELETE_DATA
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LAT_KILL_GATEWAY
  Call un.LAT_PROMPT_DELETE_DATA
!macroend

Function LAT_PROMPT_DELETE_DATA
  ReadRegStr $0 HKCU "Software\LAT" "DataRoot"
  StrCmp $0 "" 0 +2
    StrCpy $0 "$INSTDIR\.lat-runtime"
  IfFileExists "$0\models\HY-MT2-7B-Q6_K.gguf" 0 check_runtime
  Goto ask
check_runtime:
  IfFileExists "$0\runtime\llama.cpp\*" 0 check_downloads
  Goto ask
check_downloads:
  IfFileExists "$0\downloads\*" 0 check_logs
  Goto ask
check_logs:
  IfFileExists "$0\logs\*" 0 done
  Goto ask
ask:
  MessageBox MB_YESNOCANCEL|MB_DEFBUTTON2 "是否删除 LAT 下载的模型和 llama.cpp 数据？$\r$\n选择是删除模型、运行时、下载缓存和日志。$\r$\n选择否保留这些数据，便于更新后继续使用。$\r$\n选择取消中止操作。" IDYES delete IDNO done
  Abort
delete:
  RMDir /r "$0\models"
  RMDir /r "$0\runtime"
  RMDir /r "$0\downloads"
  RMDir /r "$0\logs"
  Delete "$0\translator.log"
  Goto done
done:
FunctionEnd

Function un.LAT_PROMPT_DELETE_DATA
  ReadRegStr $0 HKCU "Software\LAT" "DataRoot"
  StrCmp $0 "" 0 +2
    StrCpy $0 "$INSTDIR\.lat-runtime"
  IfFileExists "$0\models\HY-MT2-7B-Q6_K.gguf" 0 check_runtime
  Goto ask
check_runtime:
  IfFileExists "$0\runtime\llama.cpp\*" 0 check_downloads
  Goto ask
check_downloads:
  IfFileExists "$0\downloads\*" 0 check_logs
  Goto ask
check_logs:
  IfFileExists "$0\logs\*" 0 done
  Goto ask
ask:
  MessageBox MB_YESNOCANCEL|MB_DEFBUTTON2 "是否删除 LAT 下载的模型和 llama.cpp 数据？$\r$\n选择是删除模型、运行时、下载缓存和日志。$\r$\n选择否保留这些数据，便于更新后继续使用。$\r$\n选择取消中止卸载。" IDYES delete IDNO done
  Abort
delete:
  RMDir /r "$0\models"
  RMDir /r "$0\runtime"
  RMDir /r "$0\downloads"
  RMDir /r "$0\logs"
  Delete "$0\translator.log"
  Goto done
done:
FunctionEnd