$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$manifest = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = $manifest.version

node scripts/check-version.mjs
if ($LASTEXITCODE -ne 0) {
  throw "Version files are not synchronized."
}

& (Join-Path $PSScriptRoot "build-sidecar.ps1")
npm run tauri build
if ($LASTEXITCODE -ne 0) {
  throw "Tauri installer build failed with exit code $LASTEXITCODE."
}

$bundleDir = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
$installer = Get-ChildItem -LiteralPath $bundleDir -Filter "LAT_$($version)_x64-setup.exe" |
  Select-Object -First 1
if (-not $installer) {
  throw "LAT $version NSIS installer was not found."
}

$artifactDir = Join-Path $projectRoot "artifacts\v$version"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$artifactPath = Join-Path $artifactDir $installer.Name
Copy-Item -LiteralPath $installer.FullName -Destination $artifactPath -Force

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($artifactPath)
try {
  $digest = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace("-", "").ToLowerInvariant()
}
finally {
  $stream.Dispose()
  $sha256.Dispose()
}
$checksumPath = Join-Path $artifactDir "SHA256SUMS.txt"
"$digest  $($installer.Name)" | Set-Content -LiteralPath $checksumPath -Encoding ascii

Write-Host "Installer: $artifactPath"
Write-Host "SHA-256: $digest"
Write-Host "Checksum file: $checksumPath"
