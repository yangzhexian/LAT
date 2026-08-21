!macro LAT_KILL_GATEWAY
  ; The sidecar is a child process and NSIS does not know about it when the
  ; main LAT process is closed. Stop the whole process tree before deleting it.
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "hy-mt2-gateway.exe"' $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LAT_KILL_GATEWAY
  Call LAT_PROMPT_DELETE_MODEL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LAT_KILL_GATEWAY
  Call un.LAT_PROMPT_DELETE_MODEL
!macroend
Function LAT_PROMPT_DELETE_MODEL
  ReadRegStr $0 HKCU "Software\LAT" "DataRoot"
  StrCmp $0 "" 0 +2
    StrCpy $0 "$INSTDIR\.lat-runtime"
  IfFileExists "$0\models\HY-MT2-7B-Q6_K.gguf" 0 check_partial
  Goto ask
check_partial:
  IfFileExists "$0\models\HY-MT2-7B-Q6_K.gguf.part" 0 done
ask:
  MessageBox MB_YESNO|MB_DEFBUTTON2 "是否删除已下载的 Hy-MT2 Q6_K 模型？$\r$\n选择否将保留模型，便于更新后继续使用。" IDNO done
  Delete "$0\models\HY-MT2-7B-Q6_K.gguf"
  Delete "$0\models\HY-MT2-7B-Q6_K.gguf.sha256"
  Delete "$0\models\HY-MT2-7B-Q6_K.gguf.part"
done:
FunctionEnd

Function un.LAT_PROMPT_DELETE_MODEL
  ReadRegStr $0 HKCU "Software\LAT" "DataRoot"
  StrCmp $0 "" 0 +2
    StrCpy $0 "$INSTDIR\.lat-runtime"
  IfFileExists "$0\models\HY-MT2-7B-Q6_K.gguf" 0 check_partial
  Goto ask
check_partial:
  IfFileExists "$0\models\HY-MT2-7B-Q6_K.gguf.part" 0 done
ask:
  MessageBox MB_YESNO|MB_DEFBUTTON2 "是否删除已下载的 Hy-MT2 Q6_K 模型？$\r$\n选择否将保留模型，便于更新后继续使用。" IDNO done
  Delete "$0\models\HY-MT2-7B-Q6_K.gguf"
  Delete "$0\models\HY-MT2-7B-Q6_K.gguf.sha256"
  Delete "$0\models\HY-MT2-7B-Q6_K.gguf.part"
done:
FunctionEnd
