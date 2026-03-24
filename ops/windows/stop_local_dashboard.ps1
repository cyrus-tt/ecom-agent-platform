$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $scriptDir "dashboard_3000.pid"
$stopped = $false

if (Test-Path $pidFile) {
  $pidText = (Get-Content $pidFile -Raw).Trim()
  if ($pidText -match "^\d+$") {
    $targetPid = [int]$pidText
    try {
      Stop-Process -Id $targetPid -Force -ErrorAction Stop
      Write-Host "[OK] stopped process from pid file (PID=$targetPid)."
      $stopped = $true
    } catch {
      Write-Host "[INFO] PID from file is not running: $targetPid"
    }
  }
  Remove-Item -Force $pidFile
}

$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = [int]$listener.OwningProcess
  try {
    Stop-Process -Id $owner -Force -ErrorAction Stop
    Write-Host "[OK] stopped listener on port 3000 (PID=$owner)."
    $stopped = $true
  } catch {
    Write-Host "[WARN] failed to stop PID=$owner on port 3000: $($_.Exception.Message)"
    exit 1
  }
}

if (-not $stopped) {
  Write-Host "[INFO] no dashboard process to stop."
}
