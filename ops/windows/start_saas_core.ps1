param(
  [switch]$RebuildWeb,
  [string]$BindHost = "0.0.0.0",
  [int]$Port = 3000,
  [switch]$DisableDispatch
)

$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$DirPath) {
  if (-not (Test-Path $DirPath)) {
    New-Item -Path $DirPath -ItemType Directory -Force | Out-Null
  }
}

function Stop-PidFileProcess([string]$PidFile) {
  if (-not (Test-Path $PidFile)) {
    return
  }
  try {
    $pidText = Get-Content -LiteralPath $PidFile -ErrorAction Stop | Select-Object -First 1
    $pidValue = [int]($pidText.Trim())
    if ($pidValue -gt 0) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
      Write-Host "[stop] existing launcher pid=$pidValue"
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

function Wait-PortReady([int]$TargetPort, [string]$ServiceName, [int]$TimeoutSeconds = 25) {
  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    Start-Sleep -Seconds 1
    $listener = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      Write-Host "[ok] $ServiceName on $TargetPort (pid=$($listener.OwningProcess))"
      return $true
    }
  }
  return $false
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$gatewayDir = Join-Path $root "apps\gateway"
$webDir = Join-Path $root "apps\web"
$webDistIndex = Join-Path $webDir "dist\index.html"
$runtimeDir = Join-Path $root "runtime"
$pidDir = Join-Path $runtimeDir "pids"
$logDir = Join-Path $runtimeDir "logs"
$pidFile = Join-Path $pidDir "gateway-saas.pid"
$outLog = Join-Path $logDir "gateway-saas-$Port.out.log"
$errLog = Join-Path $logDir "gateway-saas-$Port.err.log"

Ensure-Dir $runtimeDir
Ensure-Dir $pidDir
Ensure-Dir $logDir

if ($RebuildWeb -or -not (Test-Path $webDistIndex)) {
  Write-Host "[build] apps/web"
  Push-Location $webDir
  try {
    npm run build
  } finally {
    Pop-Location
  }
}

Stop-PidFileProcess -PidFile $pidFile
Stop-PortListener -TargetPort $Port
Start-Sleep -Milliseconds 400

if (Test-Path $outLog) { Remove-Item -LiteralPath $outLog -Force -ErrorAction SilentlyContinue }
if (Test-Path $errLog) { Remove-Item -LiteralPath $errLog -Force -ErrorAction SilentlyContinue }

$dispatchEnabled = if ($DisableDispatch) { "false" } else { "true" }
$envCmd = @(
  "`$env:HOST='$BindHost'"
  "`$env:PORT='$Port'"
  "`$env:DISPATCH_AGENT_ENABLED='$dispatchEnabled'"
  "& node server.js"
) -join "; "

$proc = Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $envCmd) `
  -WorkingDirectory $gatewayDir `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ascii
Write-Host "[start] gateway launcher pid=$($proc.Id)"

if (-not (Wait-PortReady -TargetPort $Port -ServiceName "saas gateway")) {
  throw "gateway failed to listen on port $Port"
}

Write-Host ""
Write-Host "==== SaaS Core Ready ===="
Write-Host "URL: http://127.0.0.1:$Port/"
Write-Host "dispatch enabled: $dispatchEnabled"
Write-Host "pid file: $pidFile"
Write-Host "logs: $outLog ; $errLog"
