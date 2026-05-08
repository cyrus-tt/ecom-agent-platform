param()

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$pipeline = Join-Path $root "pipelines\pg-daily-wide"
$runtimeDir = Join-Path $root "runtime"
$summaryPath = Join-Path $runtimeDir "pg_pipeline_summary.json"
$newSkuPath = Join-Path $runtimeDir "pg_pipeline_new_skus.txt"
$prepareManifestPath = Join-Path $root "data\prepared\prepare_manifest.json"
$startPlatformScript = Join-Path $root "ops\windows\start_platform.ps1"
$workspaceParent = Split-Path $root -Parent

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
    Get-ChildItem -Path $workspaceParent -Directory -ErrorAction SilentlyContinue |
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

$arrivalDashboardDir = Resolve-ConfiguredDir -Candidates @($env:ARRIVAL_PROJECT_DIR) -RequiredFiles @("dashboard_service.py")
if (-not $arrivalDashboardDir) {
  $arrivalDashboardDir = Find-LegacyProjectDir -RequiredFiles @("dashboard_service.py")
}

$psqlPath = if ($env:PSQL_BIN) { [System.IO.Path]::GetFullPath($env:PSQL_BIN) } else { "C:\Program Files\PostgreSQL\18\bin\psql.exe" }
$pgArgs = @(
  "-X",
  "-q",
  "-h", "127.0.0.1",
  "-p", "5432",
  "-U", "ecom_app",
  "-d", "ecom_dashboard_v2",
  "-v", "ON_ERROR_STOP=1"
)

if (-not (Test-Path $psqlPath)) {
  throw "psql not found: $psqlPath. Configure PSQL_BIN or install PostgreSQL client."
}

function Invoke-PsqlLines {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [switch]$AllowFailure
  )

  $output = & $psqlPath @pgArgs -A -t -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) {
    if ($AllowFailure) {
      return @()
    }
    $message = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    throw "psql failed: $message"
  }

  return @(
    $output |
      ForEach-Object { $_.ToString().Trim() } |
      Where-Object { $_ -ne "" }
  )
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @()
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  & $FilePath @Arguments
  $exitCode = $LASTEXITCODE
  $stopwatch.Stop()
  if ($exitCode -ne 0) {
    throw "$Label failed with exit code $exitCode"
  }
  Write-Host ("[PG] {0} done in {1:N1}s" -f $Label, $stopwatch.Elapsed.TotalSeconds)
}

function Invoke-PsqlScalar {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [string]$Default = "",
    [switch]$AllowFailure
  )

  $lines = @(Invoke-PsqlLines -Sql $Sql -AllowFailure:$AllowFailure)
  if ($lines.Count -eq 0) {
    return $Default
  }
  return [string]$lines[0]
}

function Test-PgRelationExists {
  param([Parameter(Mandatory = $true)][string]$RelationName)

  $exists = Invoke-PsqlScalar -Sql "select case when to_regclass('$RelationName') is null then 0 else 1 end;" -Default "0" -AllowFailure
  return $exists -eq "1"
}

function Get-VisibleSkuList {
  $parts = @()
  if (Test-PgRelationExists "anta_daily.rpt_inventory_sku_latest") {
    $parts += "select btrim(sku) as sku from anta_daily.rpt_inventory_sku_latest"
  }
  if (Test-PgRelationExists "anta_daily.rpt_sales_sku_daily") {
    $parts += "select btrim(sku) as sku from anta_daily.rpt_sales_sku_daily"
  }
  if ($parts.Count -eq 0) {
    return @()
  }

  $sql = @"
select sku
from (
  $($parts -join "`n  union`n  ")
) visible
where nullif(sku, '') is not null
order by sku;
"@
  return Invoke-PsqlLines -Sql $sql -AllowFailure
}

function Get-VisibleSkuCount {
  $parts = @()
  if (Test-PgRelationExists "anta_daily.rpt_inventory_sku_latest") {
    $parts += "select btrim(sku) as sku from anta_daily.rpt_inventory_sku_latest"
  }
  if (Test-PgRelationExists "anta_daily.rpt_sales_sku_daily") {
    $parts += "select btrim(sku) as sku from anta_daily.rpt_sales_sku_daily"
  }
  if ($parts.Count -eq 0) {
    return 0
  }

  $sql = @"
select count(*)
from (
  $($parts -join "`n  union`n  ")
) visible
where nullif(sku, '') is not null;
"@
  return [int](Invoke-PsqlScalar -Sql $sql -Default "0" -AllowFailure)
}

function Get-LatestDate {
  param(
    [Parameter(Mandatory = $true)][string]$RelationName,
    [Parameter(Mandatory = $true)][string]$ColumnName
  )

  if (-not (Test-PgRelationExists $RelationName)) {
    return ""
  }

  return Invoke-PsqlScalar -Sql "select coalesce(to_char(max($ColumnName), 'YYYY-MM-DD'), '') from $RelationName;" -Default "" -AllowFailure
}

function Get-PreparedMaxDate {
  param(
    [Parameter(Mandatory = $true)][string]$CsvPath,
    [Parameter(Mandatory = $true)][string]$ColumnName
  )

  if (-not (Test-Path $CsvPath)) {
    return ""
  }

  $maxDate = ""
  foreach ($row in (Import-Csv -Path $CsvPath)) {
    $value = [string]$row.$ColumnName
    if ([string]::IsNullOrWhiteSpace($value)) {
      continue
    }
    $normalized = $value.Trim()
    if ($maxDate -eq "" -or $normalized -gt $maxDate) {
      $maxDate = $normalized
    }
  }
  return $maxDate
}

function Get-PreparedDistinctDates {
  param(
    [Parameter(Mandatory = $true)][string]$CsvPath,
    [Parameter(Mandatory = $true)][string]$ColumnName
  )

  if (-not (Test-Path $CsvPath)) {
    return @()
  }

  $dateSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($row in (Import-Csv -Path $CsvPath)) {
    $value = [string]$row.$ColumnName
    if ([string]::IsNullOrWhiteSpace($value)) {
      continue
    }
    [void]$dateSet.Add($value.Trim())
  }

  return @($dateSet | Sort-Object)
}

function Test-DateExistsInRelation {
  param(
    [Parameter(Mandatory = $true)][string]$RelationName,
    [Parameter(Mandatory = $true)][string]$ColumnName,
    [Parameter(Mandatory = $true)][string]$DateValue
  )

  if (-not (Test-PgRelationExists $RelationName)) {
    return $false
  }

  $safeDate = $DateValue.Replace("'", "''")
  $count = Invoke-PsqlScalar -Sql "select count(*) from $RelationName where $ColumnName = date '$safeDate';" -Default "0" -AllowFailure
  return [int]$count -gt 0
}

function Remove-ImportedCsvFiles {
  if (-not (Test-Path $prepareManifestPath)) {
    Write-Host "[PG] prepare manifest not found, skip csv cleanup"
    return
  }

  $jsonText = [System.IO.File]::ReadAllText($prepareManifestPath, [System.Text.Encoding]::UTF8)
  $manifest = $jsonText | ConvertFrom-Json
  $files = @()
  foreach ($path in @($manifest.prepared_files)) {
    if (-not [string]::IsNullOrWhiteSpace($path)) {
      $files += [string]$path
    }
  }

  foreach ($file in ($files | Sort-Object -Unique)) {
    if (Test-Path $file) {
      Remove-Item -Path $file -Force
      Write-Host "[PG] deleted csv $file"
    }
  }
}

function Refresh-DownstreamServices {
  if (Test-Path $startPlatformScript) {
    Invoke-CheckedCommand -Label "restart_gateway" -FilePath "powershell" -Arguments @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $startPlatformScript
    )
  }

  if ($arrivalDashboardDir -and (Test-Path (Join-Path $arrivalDashboardDir "dashboard_service.py"))) {
    Push-Location $arrivalDashboardDir
    try {
      Invoke-CheckedCommand -Label "refresh_arrival_dashboard" -FilePath "python" -Arguments @(
        ".\dashboard_service.py",
        "--refresh-once"
      )
    }
    finally {
      Pop-Location
    }
  }
}

Write-Host "[PG] root=$root"
Write-Host "[PG] pipeline=$pipeline"

Push-Location $pipeline
try {
  if (-not (Test-Path $psqlPath)) {
    throw "psql not found at $psqlPath"
  }

  $env:PGPASSWORD = "ecom123456"
  $beforeVisibleSkuCount = Get-VisibleSkuCount
  $beforeVisibleSkus = @(Get-VisibleSkuList)
  $beforeVisibleSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($sku in $beforeVisibleSkus) {
    [void]$beforeVisibleSet.Add($sku)
  }
  Write-Host "[PG] visible sku before pipeline=$beforeVisibleSkuCount"

  Invoke-CheckedCommand -Label "prepare_pg_sources" -FilePath "python" -Arguments @(".\prepare_pg_sources.py")

  if (-not (Test-Path $prepareManifestPath)) {
    throw "prepare manifest not found after prepare_pg_sources"
  }

  $prepareManifest = Get-Content -Path $prepareManifestPath -Raw | ConvertFrom-Json
  $inventorySources = @()
  foreach ($source in @($prepareManifest.inventory_sources)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$source)) {
      $inventorySources += [string]$source
    }
  }
  $salesPreparedPath = Join-Path $root "data\prepared\sales_history.csv"
  $inventoryPreparedPath = Join-Path $root "data\prepared\inventory_latest.csv"
  $expectedSalesDates = @(Get-PreparedDistinctDates -CsvPath $salesPreparedPath -ColumnName "sales_date")
  $expectedSalesDate = Get-PreparedMaxDate -CsvPath $salesPreparedPath -ColumnName "sales_date"
  $expectedInventoryDate = Get-PreparedMaxDate -CsvPath $inventoryPreparedPath -ColumnName "snapshot_date"
  $loadMode = if ($inventorySources.Count -gt 0) { "full" } else { "sales-only" }
  Write-Host "[PG] load mode=$loadMode"
  if ($expectedSalesDate) {
    Write-Host "[PG] expected sales date=$expectedSalesDate"
  }
  if ($loadMode -eq "full" -and $expectedInventoryDate) {
    Write-Host "[PG] expected inventory snapshot date=$expectedInventoryDate"
  }

  Invoke-CheckedCommand -Label "01_postgres_daily_wide_ddl.sql" -FilePath $psqlPath -Arguments ($pgArgs + @("-f", ".\sql\01_postgres_daily_wide_ddl.sql"))
  if ($loadMode -eq "full") {
    Invoke-CheckedCommand -Label "02_postgres_daily_wide_load.sql" -FilePath $psqlPath -Arguments ($pgArgs + @("-f", ".\sql\02_postgres_daily_wide_load.sql"))
  }
  else {
    Invoke-CheckedCommand -Label "02_postgres_sales_only_load.sql" -FilePath $psqlPath -Arguments ($pgArgs + @("-f", ".\sql\02_postgres_sales_only_load.sql"))
  }
  Invoke-CheckedCommand -Label "05_postgres_split_daily_wide.sql" -FilePath $psqlPath -Arguments ($pgArgs + @("-f", ".\sql\05_postgres_split_daily_wide.sql"))

  # F-PERF-40C: post-ETL ANALYZE (PLAN 2026-04-29-perf-40-concurrent-readiness.md §S5)
  # 故意 fail-tolerant：ANALYZE 失败只意味着统计信息没刷新，查询会继续可用，不应阻断 pipeline。
  try {
    Invoke-CheckedCommand -Label "06_postgres_post_etl_analyze.sql" -FilePath $psqlPath -Arguments ($pgArgs + @("-f", ".\sql\06_postgres_post_etl_analyze.sql"))
  }
  catch {
    Write-Warning "[PG] 06_postgres_post_etl_analyze.sql failed (continuing): $($_.Exception.Message)"
  }

  # ChatBI readonly user is preferred for AI-generated SQL. Creating roles needs a PG
  # admin/CREATEROLE account, so support explicit admin env vars and otherwise skip
  # with a precise warning. The gateway still wraps BI fallback queries in READ ONLY
  # transactions when this role is not available.
  $biReadonlySql = ".\sql\07_bi_readonly_user.sql"
  if (Test-Path $biReadonlySql) {
    $pgAdminUser = [string]$env:PG_ADMIN_USER
    $pgAdminPassword = [string]$env:PG_ADMIN_PASSWORD
    if (-not [string]::IsNullOrWhiteSpace($pgAdminUser)) {
      $previousPgPassword = [string]$env:PGPASSWORD
      if (-not [string]::IsNullOrWhiteSpace($pgAdminPassword)) {
        $env:PGPASSWORD = $pgAdminPassword
      }
      $pgAdminArgs = @(
        "-X",
        "-q",
        "-h", "127.0.0.1",
        "-p", "5432",
        "-U", $pgAdminUser,
        "-d", "ecom_dashboard_v2",
        "-v", "ON_ERROR_STOP=1"
      )
      try {
        Invoke-CheckedCommand -Label "07_bi_readonly_user.sql" -FilePath $psqlPath -Arguments ($pgAdminArgs + @("-f", $biReadonlySql))
      }
      finally {
        if ($previousPgPassword) {
          $env:PGPASSWORD = $previousPgPassword
        }
        else {
          Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        }
      }
    }
    else {
      $canCreateRoles = Invoke-PsqlScalar -Sql "select case when rolsuper or rolcreaterole then 1 else 0 end from pg_roles where rolname = current_user;" -Default "0" -AllowFailure
      if ($canCreateRoles -eq "1") {
        Invoke-CheckedCommand -Label "07_bi_readonly_user.sql" -FilePath $psqlPath -Arguments ($pgArgs + @("-f", $biReadonlySql))
      }
      else {
        Write-Warning "[PG] skipped 07_bi_readonly_user.sql: current DB user cannot create roles. Set PG_ADMIN_USER/PG_ADMIN_PASSWORD to apply it."
      }
    }
  }

  $afterVisibleSkuCount = Get-VisibleSkuCount
  $afterVisibleSkus = @(Get-VisibleSkuList)
  $newVisibleSkus = @()
  foreach ($sku in $afterVisibleSkus) {
    if (-not $beforeVisibleSet.Contains($sku)) {
      $newVisibleSkus += $sku
    }
  }

  $latestSalesDate = Get-LatestDate -RelationName "anta_daily.rpt_sales_sku_daily" -ColumnName "sales_date"
  $latestInventoryDate = Get-LatestDate -RelationName "anta_daily.rpt_inventory_sku_latest" -ColumnName "inventory_snapshot_date"
  foreach ($salesDate in $expectedSalesDates) {
    if (-not (Test-DateExistsInRelation -RelationName "anta_daily.src_sales_history" -ColumnName "sales_date" -DateValue $salesDate)) {
      throw "sales date validation failed in src_sales_history: missing $salesDate"
    }
    if (-not (Test-DateExistsInRelation -RelationName "anta_daily.rpt_sales_sku_daily" -ColumnName "sales_date" -DateValue $salesDate)) {
      throw "sales date validation failed in rpt_sales_sku_daily: missing $salesDate"
    }
  }
  if ($loadMode -eq "full" -and $expectedInventoryDate -and $latestInventoryDate -ne $expectedInventoryDate) {
    throw "inventory date validation failed: expected $expectedInventoryDate, actual $latestInventoryDate"
  }

  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $summary = [ordered]@{
    generated_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    expected_sales_dates = $expectedSalesDates
    expected_sales_date = $expectedSalesDate
    expected_inventory_snapshot_date = $expectedInventoryDate
    latest_sales_date = $latestSalesDate
    latest_inventory_snapshot_date = $latestInventoryDate
    before_visible_sku_count = $beforeVisibleSkuCount
    after_visible_sku_count = $afterVisibleSkuCount
    new_visible_sku_count = $newVisibleSkus.Count
    new_skus = $newVisibleSkus
  }
  $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $summaryPath -Encoding UTF8
  Set-Content -Path $newSkuPath -Value ($newVisibleSkus -join [Environment]::NewLine) -Encoding UTF8

  Write-Host "[PG] latest sales date=$latestSalesDate"
  Write-Host "[PG] latest inventory snapshot date=$latestInventoryDate"
  Write-Host "[PG] visible sku after pipeline=$afterVisibleSkuCount"
  Write-Host "[PG] new visible sku count=$($newVisibleSkus.Count)"
  if ($newVisibleSkus.Count -gt 0) {
    $preview = $newVisibleSkus | Select-Object -First 20
    Write-Host "[PG] new visible sku sample=$($preview -join ', ')"
  }
  Write-Host "[PG] summary saved to $summaryPath"
  Write-Host "[PG] new sku list saved to $newSkuPath"
  Remove-ImportedCsvFiles
  Refresh-DownstreamServices

  Write-Host "[PG] pipeline done"
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
