param(
  [switch]$SkipRebuildWeb
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$rollbackBranch = "feature/dispatch-agent"
$stopScript = Join-Path $root "ops\windows\stop_all.ps1"
$startScript = Join-Path $root "ops\windows\start_all.ps1"
$nodeBin = Join-Path $root "tools\node-v20.20.2-win-x64\node.exe"
$npmCli = Join-Path $root "tools\node-v20.20.2-win-x64\npm.cmd"

Write-Host "[ROLLBACK] root: $root"
Write-Host "[ROLLBACK] stopping current services"
& powershell -NoProfile -ExecutionPolicy Bypass -File $stopScript

Write-Host "[ROLLBACK] switching to $rollbackBranch"
git -C $root switch $rollbackBranch
if ($LASTEXITCODE -ne 0) {
  throw "git switch to $rollbackBranch failed"
}

if (Test-Path $nodeBin) {
  $env:NODE_BIN = $nodeBin
}
if (Test-Path $npmCli) {
  $env:NPM_CLI = $npmCli
}

Write-Host "[ROLLBACK] starting services from $rollbackBranch"
$args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $startScript)
if (-not $SkipRebuildWeb) {
  $args += "-RebuildWeb"
}
& powershell @args
