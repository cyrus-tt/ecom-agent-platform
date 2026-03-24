$ErrorActionPreference = "SilentlyContinue"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$pidDir = Join-Path $root "runtime\pids"
$pidFiles = @("gateway.pid", "notes.pid", "arrival.pid")
$arrivalServiceUrl = if ($env:ARRIVAL_SERVICE_URL) { $env:ARRIVAL_SERVICE_URL } elseif ($env:ARRIVAL_BASE) { $env:ARRIVAL_BASE } else { "http://127.0.0.1:5188" }
$notesServiceUrl = if ($env:NOTES_SERVICE_URL) { $env:NOTES_SERVICE_URL } elseif ($env:NOTES_BASE) { $env:NOTES_BASE } else { "http://127.0.0.1:5190" }
$arrivalUri = [System.Uri]$arrivalServiceUrl
$notesUri = [System.Uri]$notesServiceUrl
$arrivalPort = if ($arrivalUri.IsDefaultPort) { if ($arrivalUri.Scheme -eq "https") { 443 } else { 80 } } else { $arrivalUri.Port }
$notesPort = if ($notesUri.IsDefaultPort) { if ($notesUri.Scheme -eq "https") { 443 } else { 80 } } else { $notesUri.Port }

function Stop-PidFileProcess {
  param([string]$PidFileName)

  $pidPath = Join-Path $pidDir $PidFileName
  if (-not (Test-Path $pidPath)) {
    return
  }

  $pidValue = (Get-Content -LiteralPath $pidPath -Raw).Trim()
  if ($pidValue -match "^\d+$") {
    Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
    Write-Host "[STOP] $PidFileName -> PID=$pidValue"
  }
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

function Stop-PortListener {
  param([int]$Port)

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in @($listeners)) {
    if (-not $listener) {
      continue
    }
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "[STOP] port $Port pid=$($listener.OwningProcess)"
  }
}

foreach ($pidFile in $pidFiles) {
  Stop-PidFileProcess -PidFileName $pidFile
}

Stop-PortListener -Port 3000
Stop-PortListener -Port $arrivalPort
Stop-PortListener -Port $notesPort

Write-Host "Services stopped."
