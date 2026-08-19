$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  throw "找不到 PyInstaller。请先安装：python -m pip install pyinstaller"
}

$target = (rustc -vV | Select-String '^host:').Line.Split(':')[1].Trim()
$outputDir = Join-Path $projectRoot "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

pyinstaller --noconfirm --clean --onefile --noconsole --name hy-mt2-gateway gateway_entry.py
Copy-Item "dist\hy-mt2-gateway.exe" (Join-Path $outputDir "hy-mt2-gateway-$target.exe") -Force
Write-Host "Sidecar 已生成：$outputDir\hy-mt2-gateway-$target.exe"
