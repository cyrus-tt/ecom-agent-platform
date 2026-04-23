param(
  [int]$Port = 3000
)

$ErrorActionPreference = "SilentlyContinue"

function Stop-PidFileProcess([string]$PidFile) {
  if (-not (Test-Path $PidFile)) {
    return
  }
  try {
    $pidText = Get-Content -LiteralPath $PidFile -ErrorAction Stop | Select-Object -First 1
    $pidValue = [int]($pidText.Trim())
    if ($pidValue -gt 0) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      Write-Host "[stop] launcher pid=$pidValue"
    }
  } catch {
    Write-Warning "[warn] failed to stop process from pid file: $PidFile"
  } finally {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }
}

function Stop-PortListener([int]$TargetPort) {
  $listeners = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in @($listeners)) {
    if ($null -eq $listener) { continue }
    try {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      Write-Host "[stop] port $TargetPort pid=$($listener.OwningProcess)"
    } catch {
      Write-Warning "[warn] failed to stop pid=$($listener.OwningProcess) on port $TargetPort"
    }
  }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pidDir = Join-Path $root "runtime\pids"
$pidFile = Join-Path $pidDir "gateway-saas.pid"

Stop-PidFileProcess -PidFile $pidFile
Stop-PortListener -TargetPort $Port

Write-Host ""
Write-Host "==== SaaS Core Stopped ===="
Write-Host "port $Port listener has been stopped."
