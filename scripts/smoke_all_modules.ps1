param(
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [string]$Username = "anta",
  [string]$Password = $env:ECOM_SMOKE_PASSWORD,
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Password)) {
  throw "Provide -Password or set ECOM_SMOKE_PASSWORD."
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Name, [bool]$Ok, [int]$Status, [string]$Detail) {
  $results.Add([pscustomobject]@{
      name = $Name
      ok = $Ok
      status = $Status
      detail = $Detail
    }) | Out-Null
}

function Invoke-JsonGet([string]$Name, [string]$Uri) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $Uri -WebSession $session -TimeoutSec 30
    $json = $resp.Content | ConvertFrom-Json
    Add-Result -Name $Name -Ok $true -Status ([int]$resp.StatusCode) -Detail "ok"
    return $json
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    Add-Result -Name $Name -Ok $false -Status $status -Detail $_.Exception.Message
    return $null
  }
}

try {
  $loginBody = @{ username = $Username; password = $Password } | ConvertTo-Json
  $loginResp = Invoke-WebRequest `
    -UseBasicParsing `
    -Uri "$BaseUrl/api/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body $loginBody `
    -WebSession $session `
    -TimeoutSec 20
  Add-Result -Name "auth.login" -Ok $true -Status ([int]$loginResp.StatusCode) -Detail "ok"
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  Add-Result -Name "auth.login" -Ok $false -Status $status -Detail $_.Exception.Message
}

Invoke-JsonGet -Name "auth.me" -Uri "$BaseUrl/api/auth/me" | Out-Null
Invoke-JsonGet -Name "healthz" -Uri "$BaseUrl/healthz" | Out-Null
Invoke-JsonGet -Name "readyz" -Uri "$BaseUrl/readyz" | Out-Null

$dailyDates = Invoke-JsonGet -Name "report.daily.dates" -Uri "$BaseUrl/api/report-daily/dates"
$dailyDate = if ($dailyDates -and $dailyDates.default_sales_date) { [string]$dailyDates.default_sales_date } else { "" }
if ($dailyDate) {
  Invoke-JsonGet -Name "report.daily.meta" -Uri "$BaseUrl/api/report-daily/meta?salesDate=$dailyDate" | Out-Null
  Invoke-JsonGet -Name "report.daily.rows" -Uri "$BaseUrl/api/report-daily/rows?salesDate=$dailyDate&page=1&pageSize=20" | Out-Null
}

$dashDates = Invoke-JsonGet -Name "dashboard.dates" -Uri "$BaseUrl/api/dashboard/dates"
$dateFrom = if ($dashDates -and $dashDates.default_date_from) { [string]$dashDates.default_date_from } else { "" }
$dateTo = if ($dashDates -and $dashDates.default_date_to) { [string]$dashDates.default_date_to } else { "" }
if ($dateFrom -and $dateTo) {
  Invoke-JsonGet -Name "dashboard.overview" -Uri "$BaseUrl/api/dashboard/overview?date_from=$dateFrom&date_to=$dateTo" | Out-Null
  Invoke-JsonGet -Name "dashboard.channel.compare" -Uri "$BaseUrl/api/dashboard/channel-compare?date_from=$dateFrom&date_to=$dateTo" | Out-Null
  Invoke-JsonGet -Name "channel.dashboard" -Uri "$BaseUrl/api/channel-dashboard?date_from=$dateFrom&date_to=$dateTo" | Out-Null
}

Invoke-JsonGet -Name "agent.skills" -Uri "$BaseUrl/api/agent/skills" | Out-Null
Invoke-JsonGet -Name "agent.context" -Uri "$BaseUrl/api/agent/context?period_type=week" | Out-Null
Invoke-JsonGet -Name "agent.reports" -Uri "$BaseUrl/api/agent/reports?page=1&pageSize=5" | Out-Null

Invoke-JsonGet -Name "arrival.status" -Uri "$BaseUrl/api/arrival/status" | Out-Null
Invoke-JsonGet -Name "arrival.data" -Uri "$BaseUrl/api/arrival/data" | Out-Null
Invoke-JsonGet -Name "notes.notes" -Uri "$BaseUrl/notes-api/notes?user_id=$Username" | Out-Null
Invoke-JsonGet -Name "dispatch.tasks" -Uri "$BaseUrl/api/dispatch/tasks" | Out-Null

foreach ($path in @("/", "/report-daily", "/arrival", "/dashboard", "/channel-dashboard", "/analysis", "/dispatch", "/admin/accounts")) {
  $name = "page$path"
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl$path" -WebSession $session -TimeoutSec 25 -MaximumRedirection 0
    Add-Result -Name $name -Ok $true -Status ([int]$resp.StatusCode) -Detail "ok"
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($status -eq 301 -or $status -eq 302) {
      Add-Result -Name $name -Ok $true -Status $status -Detail "redirect"
    } else {
      Add-Result -Name $name -Ok $false -Status $status -Detail $_.Exception.Message
    }
  }
}

$failed = @($results | Where-Object { -not $_.ok })
$summary = [pscustomobject]@{
  timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  base_url = $BaseUrl
  total = $results.Count
  passed = $results.Count - $failed.Count
  failed = $failed.Count
}

$payload = [pscustomobject]@{
  summary = $summary
  results = $results
}

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $dir = Split-Path -Parent $OutputPath
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -Path $dir -ItemType Directory -Force | Out-Null
  }
  ($payload | ConvertTo-Json -Depth 6) | Set-Content -Path $OutputPath -Encoding UTF8
}

$summary | ConvertTo-Json -Compress
if ($failed.Count -gt 0) {
  $failed | ConvertTo-Json -Depth 4
  exit 2
}
