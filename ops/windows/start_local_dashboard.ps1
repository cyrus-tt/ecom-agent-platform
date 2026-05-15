$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Split-Path -Parent $scriptDir
$pidFile = Join-Path $scriptDir "dashboard_3000.pid"
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")

function Resolve-NodeRuntime([string]$RootDir) {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:NODE_BIN)) {
    $candidates += $env:NODE_BIN
  }
  $candidates += (Join-Path $RootDir "tools\node-v20.20.2-win-x64\node.exe")

  foreach ($candidate in @($candidates)) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand -and -not [string]::IsNullOrWhiteSpace($nodeCommand.Source)) {
    return $nodeCommand.Source
  }
  throw "node runtime not found. Set NODE_BIN or place Node 20 under tools/node-v20.20.2-win-x64."
}

function Resolve-NpmCli([string]$NodeBin) {
  if (-not [string]::IsNullOrWhiteSpace($env:NPM_CLI) -and (Test-Path $env:NPM_CLI)) {
    return (Resolve-Path $env:NPM_CLI).Path
  }

  $nodeDir = Split-Path -Parent $NodeBin
  $npmFromNode = Join-Path $nodeDir "npm.cmd"
  if (Test-Path $npmFromNode) {
    return (Resolve-Path $npmFromNode).Path
  }

  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCommand -and -not [string]::IsNullOrWhiteSpace($npmCommand.Source)) {
    return $npmCommand.Source
  }

  throw "npm.cmd not found. Set NPM_CLI or ensure npm is available."
}

$nodeBin = Resolve-NodeRuntime -RootDir $repoRoot
$npmCli = Resolve-NpmCli -NodeBin $nodeBin

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

$proc = Start-Process -FilePath $npmCli -ArgumentList "start" -WorkingDirectory $projectDir -WindowStyle Hidden -PassThru
$proc.Id | Set-Content -Path $pidFile -Encoding ascii

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:3000/"
Write-Host "[OK] dashboard started (PID=$($proc.Id), node=$nodeBin)."
