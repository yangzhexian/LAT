$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  throw "PyInstaller was not found. Run: python -m pip install -r requirements-build.txt"
}

$target = (rustc -vV | Select-String '^host:').Line.Split(':')[1].Trim()
$outputDir = Join-Path $projectRoot "src-tauri\binaries"
$buildDir = Join-Path $projectRoot "build\sidecar"
$distDir = Join-Path $buildDir "dist"
$workDir = Join-Path $buildDir "work"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$pyinstallerArgs = @(
  "--noconfirm",
  "--clean",
  "--onefile",
  "--noconsole",
  "--name", "hy-mt2-gateway",
  "--distpath", $distDir,
  "--workpath", $workDir,
  "--specpath", $buildDir,
  "gateway_entry.py"
)
pyinstaller @pyinstallerArgs
if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed with exit code $LASTEXITCODE."
}

Copy-Item (Join-Path $distDir "hy-mt2-gateway.exe") (Join-Path $outputDir "hy-mt2-gateway-$target.exe") -Force
Write-Host "Sidecar: $outputDir\hy-mt2-gateway-$target.exe"
