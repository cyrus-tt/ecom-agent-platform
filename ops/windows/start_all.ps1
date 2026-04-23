param(
  [switch]$RebuildWeb
)

$ErrorActionPreference = "Stop"

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

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$gatewayDir = Join-Path $root "apps\gateway"
$webDir = Join-Path $root "apps\web"
$webDistIndex = Join-Path $webDir "dist\index.html"
$pidDir = Join-Path $root "runtime\pids"
$desktopDir = Split-Path -Path $root -Parent
$nodeBin = Resolve-NodeRuntime -RootDir $root
$npmCli = Resolve-NpmCli -NodeBin $nodeBin
$arrivalServiceUrl = if ($env:ARRIVAL_SERVICE_URL) { $env:ARRIVAL_SERVICE_URL } elseif ($env:ARRIVAL_BASE) { $env:ARRIVAL_BASE } else { "http://127.0.0.1:5188" }
$notesServiceUrl = if ($env:NOTES_SERVICE_URL) { $env:NOTES_SERVICE_URL } elseif ($env:NOTES_BASE) { $env:NOTES_BASE } else { "http://127.0.0.1:5190" }
$arrivalUri = [System.Uri]$arrivalServiceUrl
$notesUri = [System.Uri]$notesServiceUrl
$arrivalPort = if ($arrivalUri.IsDefaultPort) { if ($arrivalUri.Scheme -eq "https") { 443 } else { 80 } } else { $arrivalUri.Port }
$notesPort = if ($notesUri.IsDefaultPort) { if ($notesUri.Scheme -eq "https") { 443 } else { 80 } } else { $notesUri.Port }
$arrivalHost = if ([string]::IsNullOrWhiteSpace($arrivalUri.Host)) { "127.0.0.1" } else { $arrivalUri.Host }

if (-not (Test-Path $pidDir)) {
  New-Item -Path $pidDir -ItemType Directory -Force | Out-Null
}

function Resolve-ConfiguredDir {
  param(
    [string[]]$Candidates,
    [string[]]$RequiredFiles
  )

  foreach ($candidate in @($Candidates)) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    if (-not (Test-Path $resolved)) {
      continue
    }
    $allFilesPresent = $true
    foreach ($requiredFile in @($RequiredFiles)) {
      if (-not (Test-Path (Join-Path $resolved $requiredFile))) {
        $allFilesPresent = $false
        break
      }
    }
    if ($allFilesPresent) {
      return $resolved
    }
  }

  return ""
}

function Find-LegacyProjectDir {
  param([string[]]$RequiredFiles)

  return @(
    Get-ChildItem -Path $desktopDir -Directory -ErrorAction SilentlyContinue |
      Where-Object {
        $allFilesPresent = $true
        foreach ($requiredFile in @($RequiredFiles)) {
          if (-not (Test-Path (Join-Path $_.FullName $requiredFile))) {
            $allFilesPresent = $false
            break
          }
        }
        $allFilesPresent
      }
  ) | Select-Object -First 1 -ExpandProperty FullName
}

$arrivalDir = Resolve-ConfiguredDir -Candidates @($env:ARRIVAL_PROJECT_DIR) -RequiredFiles @("dashboard_service.py")
if (-not $arrivalDir) {
  $arrivalDir = Find-LegacyProjectDir -RequiredFiles @("dashboard_service.py")
}

$notesDir = Resolve-ConfiguredDir -Candidates @($env:NOTES_PROJECT_DIR, $env:ARRIVAL_PROJECT_DIR, $arrivalDir) -RequiredFiles @("notes_api.py", "notes_api.config.json")
if (-not $notesDir) {
  if ($arrivalDir -and (Test-Path (Join-Path $arrivalDir "notes_api.py")) -and (Test-Path (Join-Path $arrivalDir "notes_api.config.json"))) {
    $notesDir = $arrivalDir
  } else {
    $notesDir = Find-LegacyProjectDir -RequiredFiles @("notes_api.py", "notes_api.config.json")
  }
}

if (-not $arrivalDir) {
  throw "Arrival project dir not configured and no legacy dashboard_service.py location was found."
}

if (-not $notesDir) {
  throw "Notes project dir not configured and no legacy notes_api.py location was found."
}

function Stop-PortListener {
  param([int]$Port)

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in @($listeners)) {
    if (-not $listener) {
      continue
    }
    try {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
      Write-Host "[STOP] port $Port pid=$($listener.OwningProcess)"
    } catch {
      Write-Host "[WARN] failed to stop port $Port pid=$($listener.OwningProcess)"
    }
  }
}

function Wait-PortReady {
  param(
    [int]$Port,
    [string]$Name,
    [int]$TimeoutSeconds = 20
  )

  for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
    Start-Sleep -Seconds 1
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      Write-Host "[OK] $Name on $Port, PID=$($listener.OwningProcess)"
      return $listener
    }
  }

  throw "$Name failed to listen on port $Port within $TimeoutSeconds seconds"
}

function Start-ServiceProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$PidFile
  )

  Write-Host "[START] $Name"
  $proc = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 500
  if ($proc.HasExited) {
    throw "$Name exited immediately with code $($proc.ExitCode)"
  }
  Set-Content -LiteralPath $PidFile -Value $proc.Id -Encoding ascii
  return $proc
}

Get-ChildItem -Path $pidDir -Filter "*.pid" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

if ($RebuildWeb -or -not (Test-Path $webDistIndex)) {
  Write-Host "[BUILD] React web"
  Push-Location $webDir
  try {
    & $npmCli run build
  }
  finally {
    Pop-Location
  }
}

Stop-PortListener -Port 3000
Stop-PortListener -Port $arrivalPort
Stop-PortListener -Port $notesPort
Start-Sleep -Seconds 1

Start-ServiceProcess -Name "arrival service" -FilePath "python" -ArgumentList @("dashboard_service.py", "--host", $arrivalHost, "--port", [string]$arrivalPort) -WorkingDirectory $arrivalDir -PidFile (Join-Path $pidDir "arrival.pid") | Out-Null
Wait-PortReady -Port $arrivalPort -Name "arrival service" | Out-Null

Start-ServiceProcess -Name "notes API" -FilePath "python" -ArgumentList @("notes_api.py", "--config", "notes_api.config.json") -WorkingDirectory $notesDir -PidFile (Join-Path $pidDir "notes.pid") | Out-Null
Wait-PortReady -Port $notesPort -Name "notes API" | Out-Null

Start-ServiceProcess -Name "gateway" -FilePath $nodeBin -ArgumentList @("server.js") -WorkingDirectory $gatewayDir -PidFile (Join-Path $pidDir "gateway.pid") | Out-Null
Wait-PortReady -Port 3000 -Name "gateway" | Out-Null

Write-Host ""
Write-Host "Services started."
Write-Host "URL: http://localhost:3000/"
Write-Host "Node runtime: $nodeBin"
Write-Host "PID files: $pidDir"
