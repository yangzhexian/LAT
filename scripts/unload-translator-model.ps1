$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
python -m local_translator --config "$projectRoot\translator.config.json" unload
