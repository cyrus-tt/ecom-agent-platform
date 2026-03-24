$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$pidFile = Join-Path $scriptDir "dashboard_3000.pid"

$projectDir = $null

$preferred = Get-ChildItem -Path $desktopDir -Directory -ErrorAction SilentlyContinue |
  Where-Object {
    (Test-Path (Join-Path $_.FullName "package.json")) -and
    (Test-Path (Join-Path $_.FullName "server.js")) -and
    ($_.Name -match "web|dashboard|看板")
  } |
  Select-Object -First 1

if ($preferred) {
  $projectDir = $preferred.FullName
}

if (-not $projectDir) {
  $fallback = Get-ChildItem -Path $desktopDir -Directory -ErrorAction SilentlyContinue |
    Where-Object {
      (Test-Path (Join-Path $_.FullName "package.json")) -and
      (Test-Path (Join-Path $_.FullName "server.js"))
    } |
    Select-Object -First 1
  if ($fallback) {
    $projectDir = $fallback.FullName
  }
}

if (-not $projectDir) {
  Write-Host "[ERROR] dashboard project not found under: $desktopDir"
  exit 1
}

$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $listener.OwningProcess | Set-Content -Path $pidFile -Encoding ascii
  Start-Process "http://127.0.0.1:3000/"
  Write-Host "[INFO] 3000 already listening (PID=$($listener.OwningProcess)). Opened browser."
  exit 0
}

$proc = Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru
$proc.Id | Set-Content -Path $pidFile -Encoding ascii

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:3000/"
Write-Host "[OK] dashboard started (PID=$($proc.Id))."
