# =============================================================================
# loadtest_40_concurrent.ps1
# =============================================================================
# Purpose:
#   F-PERF-40C step S8 — fire 40 concurrent threads against the running gateway,
#   replay the 12 core read endpoints with random rotation, and produce a JSON
#   report with per-endpoint P50/P95/P99/max/min latencies + 4xx/5xx counts.
#
# How to run (from repo root):
#   $env:ECOM_LOADTEST_PASSWORD = "<your password>"
#   pwsh -NoProfile -File scripts/loadtest_40_concurrent.ps1 `
#        -BaseUrl http://localhost:3000 -Username anta -Concurrency 40 -DurationSeconds 60
#
#   Output JSON: ./runtime/loadtest_<timestamp>.json
#
# How to read the output:
#   - summary.passed = $true  -> 0 x 500 AND every endpoint P95 < 5000ms (strict pass)
#   - summary.count_500 > 0   -> hard fail (exit 1)
#   - any P95 >= 5000ms        -> soft fail / warning (exit 2)
#   - per_endpoint[*].p95_ms  -> latency tail per route, used for SLO review
#
# Exit codes:
#   0 = strict pass   (count_500 == 0 AND all P95 < 5000ms)
#   1 = hard fail     (count_500 > 0)
#   2 = soft fail     (count_500 == 0 BUT some P95 >= 5000ms)
#
# Requirements:
#   - PowerShell 7+ preferred (uses Start-ThreadJob, in-process threads).
#   - Falls back to Start-Job (process-based, slower) on PS 5.1 with a warning.
#   - No external deps; uses Invoke-WebRequest + WebRequestSession for cookies.
# =============================================================================

param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Username = "anta",
  [string]$Password = $env:ECOM_LOADTEST_PASSWORD,
  [int]$Concurrency = 40,
  [int]$DurationSeconds = 60,
  [string]$OutputPath = "$PSScriptRoot/../runtime/loadtest_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Password)) {
  throw "Provide -Password or set ECOM_LOADTEST_PASSWORD."
}

# -------------------------------------------------------------------------
# 1. Login + grab cookie via WebRequestSession
# -------------------------------------------------------------------------
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "[loadtest] Logging in as $Username @ $BaseUrl ..." -ForegroundColor Cyan
$loginBody = @{ username = $Username; password = $Password } | ConvertTo-Json
$null = Invoke-WebRequest `
  -UseBasicParsing `
  -Uri "$BaseUrl/api/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $loginBody `
  -WebSession $session `
  -TimeoutSec 20

# Verify the session works
$me = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/auth/me" -WebSession $session -TimeoutSec 20
if ([int]$me.StatusCode -ne 200) {
  throw "auth/me did not return 200 after login (got $([int]$me.StatusCode))"
}
Write-Host "[loadtest] Session verified (auth/me 200)." -ForegroundColor Green

# -------------------------------------------------------------------------
# 2. Resolve <latest> sales date + <auto> channel for endpoint rotation
# -------------------------------------------------------------------------
$latestDate = ""
try {
  $datesResp = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/report-daily/dates" -WebSession $session -TimeoutSec 20
  $datesJson = $datesResp.Content | ConvertFrom-Json
  if ($datesJson.default_sales_date) {
    $latestDate = [string]$datesJson.default_sales_date
  } elseif ($datesJson.dates -and $datesJson.dates.Count -gt 0) {
    $latestDate = [string]($datesJson.dates | Select-Object -Last 1)
  }
} catch {
  Write-Warning "Could not resolve latest sales date: $($_.Exception.Message)"
}
if (-not $latestDate) { $latestDate = (Get-Date).ToString("yyyy-MM-dd") }
Write-Host "[loadtest] latestDate = $latestDate" -ForegroundColor Cyan

# Probe channel-dashboard for an auto channel key
$autoChannel = ""
try {
  $chResp = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/channel-dashboard?anchor_date=$latestDate" -WebSession $session -TimeoutSec 20
  $chJson = $chResp.Content | ConvertFrom-Json
  if ($chJson.data -and $chJson.data.channels -and $chJson.data.channels.Count -gt 0) {
    $first = $chJson.data.channels[0]
    if ($first.channel_key) { $autoChannel = [string]$first.channel_key }
    elseif ($first.channel) { $autoChannel = [string]$first.channel }
    elseif ($first.key)     { $autoChannel = [string]$first.key }
  } elseif ($chJson.channels -and $chJson.channels.Count -gt 0) {
    $first = $chJson.channels[0]
    if ($first.channel_key) { $autoChannel = [string]$first.channel_key }
    elseif ($first.channel) { $autoChannel = [string]$first.channel }
  }
} catch {
  Write-Warning "Could not auto-pick channel: $($_.Exception.Message)"
}
Write-Host "[loadtest] autoChannel = '$autoChannel' (empty -> drilldown dropped)" -ForegroundColor Cyan

# -------------------------------------------------------------------------
# 3. Build endpoint rotation list (label + path)
# -------------------------------------------------------------------------
$endpoints = New-Object System.Collections.Generic.List[object]
function Add-Endpoint([string]$label, [string]$path) {
  $endpoints.Add([pscustomobject]@{ label = $label; path = $path }) | Out-Null
}

Add-Endpoint "/api/auth/me"                                   "/api/auth/me"
Add-Endpoint "/api/report-daily/dates"                        "/api/report-daily/dates"
Add-Endpoint "/api/report-daily/meta"                         "/api/report-daily/meta?salesDate=$latestDate"
Add-Endpoint "/api/report-daily/rows"                         "/api/report-daily/rows?salesDate=$latestDate&page=1&pageSize=20"
Add-Endpoint "/api/dashboard/dates"                           "/api/dashboard/dates"
Add-Endpoint "/api/dashboard/overview"                        "/api/dashboard/overview?date_from=$latestDate&date_to=$latestDate"
Add-Endpoint "/api/dashboard/channel-compare"                 "/api/dashboard/channel-compare?date_from=$latestDate&date_to=$latestDate"
Add-Endpoint "/api/channel-dashboard"                         "/api/channel-dashboard?anchor_date=$latestDate"
if ($autoChannel) {
  Add-Endpoint "/api/channel-dashboard/drilldown"             "/api/channel-dashboard/drilldown?anchor_date=$latestDate&channel=$autoChannel"
}
Add-Endpoint "/api/agent/context"                             "/api/agent/context?period_type=week"
Add-Endpoint "/api/agent/reports"                             "/api/agent/reports?page=1&pageSize=5"
Add-Endpoint "/healthz"                                       "/healthz"

Write-Host "[loadtest] Endpoint rotation has $($endpoints.Count) entries." -ForegroundColor Cyan

# -------------------------------------------------------------------------
# 4. Extract cookies from the WebSession so worker threads can re-attach.
#    (Each thread builds its own WebSession to avoid shared-state contention.)
# -------------------------------------------------------------------------
$cookieList = New-Object System.Collections.Generic.List[object]
try {
  $uri = [Uri]$BaseUrl
  $cookies = $session.Cookies.GetCookies($uri)
  foreach ($c in $cookies) {
    $cookieList.Add([pscustomobject]@{
        name   = $c.Name
        value  = $c.Value
        domain = $c.Domain
        path   = $c.Path
      }) | Out-Null
  }
} catch {
  Write-Warning "Could not enumerate cookies: $($_.Exception.Message)"
}
if ($cookieList.Count -eq 0) {
  throw "No session cookies captured after login — cannot continue."
}

# -------------------------------------------------------------------------
# 5. Launch worker threads
# -------------------------------------------------------------------------
$useThreadJob = $null -ne (Get-Command Start-ThreadJob -ErrorAction SilentlyContinue)
if (-not $useThreadJob) {
  Write-Warning "Start-ThreadJob not available (PS 5.1?). Falling back to Start-Job (process-based, slower)."
}

$workerScript = {
  param(
    [string]$BaseUrl,
    [int]$DurationSeconds,
    [int]$ThreadId,
    [object[]]$Endpoints,
    [object[]]$Cookies
  )

  # Rebuild a per-thread WebSession with the captured cookies.
  $localSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  foreach ($c in $Cookies) {
    $cookie = New-Object System.Net.Cookie($c.name, $c.value, $c.path, $c.domain)
    $localSession.Cookies.Add($cookie)
  }

  $records = New-Object System.Collections.Generic.List[object]
  $rng = New-Object System.Random ($ThreadId * 7919 + (Get-Date).Millisecond)
  $deadline = (Get-Date).AddSeconds($DurationSeconds)

  while ((Get-Date) -lt $deadline) {
    $idx = $rng.Next(0, $Endpoints.Count)
    $ep = $Endpoints[$idx]
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = 0
    try {
      $resp = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri "$BaseUrl$($ep.path)" `
        -WebSession $localSession `
        -TimeoutSec 30 `
        -ErrorAction Stop
      $status = [int]$resp.StatusCode
    } catch {
      if ($_.Exception.Response) {
        $status = [int]$_.Exception.Response.StatusCode
      } else {
        $status = 0
      }
    } finally {
      $sw.Stop()
    }

    $records.Add([pscustomobject]@{
        endpoint   = $ep.label
        http_status = $status
        elapsed_ms = [int]$sw.ElapsedMilliseconds
        timestamp  = (Get-Date).ToString("o")
        thread_id  = $ThreadId
      }) | Out-Null
  }

  return $records
}

Write-Host "[loadtest] Launching $Concurrency workers for ${DurationSeconds}s ..." -ForegroundColor Yellow
$startedAt = (Get-Date).ToString("o")
$jobs = @()
for ($i = 1; $i -le $Concurrency; $i++) {
  $args = @($BaseUrl, $DurationSeconds, $i, $endpoints.ToArray(), $cookieList.ToArray())
  if ($useThreadJob) {
    $jobs += Start-ThreadJob -ScriptBlock $workerScript -ArgumentList $args
  } else {
    $jobs += Start-Job      -ScriptBlock $workerScript -ArgumentList $args
  }
}

# Wait for completion
$jobs | Wait-Job | Out-Null
$endedAt = (Get-Date).ToString("o")

$allRecords = New-Object System.Collections.Generic.List[object]
foreach ($job in $jobs) {
  try {
    $out = Receive-Job -Job $job -ErrorAction SilentlyContinue
    if ($out) {
      foreach ($r in $out) { $allRecords.Add($r) | Out-Null }
    }
  } catch {
    Write-Warning "Worker job $($job.Id) errored: $($_.Exception.Message)"
  }
  Remove-Job -Job $job -Force | Out-Null
}

Write-Host "[loadtest] Collected $($allRecords.Count) request records." -ForegroundColor Green

# -------------------------------------------------------------------------
# 6. Aggregate per-endpoint stats
# -------------------------------------------------------------------------
function Get-Percentile([int[]]$Sorted, [double]$Pct) {
  if (-not $Sorted -or $Sorted.Count -eq 0) { return 0 }
  if ($Sorted.Count -eq 1) { return $Sorted[0] }
  # Nearest-rank method, 1-indexed.
  $rank = [int][Math]::Ceiling(($Pct / 100.0) * $Sorted.Count)
  if ($rank -lt 1) { $rank = 1 }
  if ($rank -gt $Sorted.Count) { $rank = $Sorted.Count }
  return $Sorted[$rank - 1]
}

$perEndpoint = New-Object System.Collections.Generic.List[object]
$grouped = $allRecords | Group-Object -Property endpoint
foreach ($g in $grouped) {
  $samples = @($g.Group | ForEach-Object { [int]$_.elapsed_ms } | Sort-Object)
  $count500 = @($g.Group | Where-Object { $_.http_status -ge 500 -and $_.http_status -lt 600 }).Count
  $count4xx = @($g.Group | Where-Object { $_.http_status -ge 400 -and $_.http_status -lt 500 }).Count
  $success  = @($g.Group | Where-Object { $_.http_status -ge 200 -and $_.http_status -lt 400 }).Count

  $perEndpoint.Add([pscustomobject]@{
      endpoint  = $g.Name
      total     = $g.Count
      success   = $success
      count_500 = $count500
      count_4xx = $count4xx
      p50_ms    = Get-Percentile $samples 50
      p95_ms    = Get-Percentile $samples 95
      p99_ms    = Get-Percentile $samples 99
      max_ms    = if ($samples.Count -gt 0) { ($samples | Measure-Object -Maximum).Maximum } else { 0 }
      min_ms    = if ($samples.Count -gt 0) { ($samples | Measure-Object -Minimum).Minimum } else { 0 }
    }) | Out-Null
}

$totalReqs   = $allRecords.Count
$totalSucc   = @($allRecords | Where-Object { $_.http_status -ge 200 -and $_.http_status -lt 400 }).Count
$total500    = @($allRecords | Where-Object { $_.http_status -ge 500 -and $_.http_status -lt 600 }).Count
$total4xx    = @($allRecords | Where-Object { $_.http_status -ge 400 -and $_.http_status -lt 500 }).Count
$anyHighP95  = @($perEndpoint | Where-Object { $_.p95_ms -ge 5000 }).Count -gt 0
$strictPass  = ($total500 -eq 0) -and (-not $anyHighP95)

# -------------------------------------------------------------------------
# 7. Build payload + write JSON
# -------------------------------------------------------------------------
$payload = [pscustomobject]@{
  started_at        = $startedAt
  ended_at          = $endedAt
  concurrency       = $Concurrency
  duration_seconds  = $DurationSeconds
  base_url          = $BaseUrl
  summary = [pscustomobject]@{
    total_requests = $totalReqs
    success_count  = $totalSucc
    count_500      = $total500
    count_4xx      = $total4xx
    passed         = $strictPass
  }
  per_endpoint = $perEndpoint
}

# Resolve + ensure output directory exists
$dir = Split-Path -Parent $OutputPath
if ($dir -and -not (Test-Path $dir)) {
  New-Item -Path $dir -ItemType Directory -Force | Out-Null
}
($payload | ConvertTo-Json -Depth 6) | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "[loadtest] Wrote report to $OutputPath" -ForegroundColor Green

# -------------------------------------------------------------------------
# 8. Print human-friendly summary
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "===== Per-endpoint summary =====" -ForegroundColor Cyan
$perEndpoint |
  Sort-Object endpoint |
  Format-Table endpoint, total, success, count_500, count_4xx, p50_ms, p95_ms, p99_ms, max_ms, min_ms -AutoSize |
  Out-String | Write-Host

Write-Host "===== Overall =====" -ForegroundColor Cyan
Write-Host ("total_requests = {0}" -f $totalReqs)
Write-Host ("success        = {0}" -f $totalSucc)
Write-Host ("count_500      = {0}" -f $total500)
Write-Host ("count_4xx      = {0}" -f $total4xx)
Write-Host ("any P95>=5000  = {0}" -f $anyHighP95)
if ($strictPass) {
  Write-Host "RESULT: PASS (strict)" -ForegroundColor Green
} elseif ($total500 -gt 0) {
  Write-Host "RESULT: FAIL (5xx detected)" -ForegroundColor Red
} else {
  Write-Host "RESULT: WARN (P95 over budget)" -ForegroundColor Yellow
}

# -------------------------------------------------------------------------
# 9. Exit code
# -------------------------------------------------------------------------
if ($total500 -gt 0) {
  exit 1
} elseif ($anyHighP95) {
  exit 2
} else {
  exit 0
}
