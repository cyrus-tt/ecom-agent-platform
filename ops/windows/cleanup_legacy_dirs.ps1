param(
  [int]$MaxAttempts = 600,
  [int]$IntervalSeconds = 2
)

$ErrorActionPreference = 'SilentlyContinue'

$desktopDir = [Environment]::GetFolderPath('Desktop')
$legacyWebName = ([char]0x7535) + ([char]0x5546) + 'web' + ([char]0x770B) + ([char]0x677F)
$targets = @(
  (Join-Path $desktopDir 'new sql'),
  (Join-Path $desktopDir $legacyWebName)
)

function Try-DeleteDirectory([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    return $true
  }
  try {
    [System.IO.Directory]::Delete($path, $true)
    return -not (Test-Path -LiteralPath $path)
  } catch {
    return $false
  }
}

for ($i = 1; $i -le $MaxAttempts; $i++) {
  $allDeleted = $true
  foreach ($target in $targets) {
    if (-not (Try-DeleteDirectory -path $target)) {
      $allDeleted = $false
    }
  }
  if ($allDeleted) {
    Write-Output '[OK] legacy directories deleted.'
    exit 0
  }
  Start-Sleep -Seconds $IntervalSeconds
}

$remaining = @()
foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target) {
    $remaining += $target
  }
}
Write-Output ("[WARN] cleanup timeout. remaining: {0}" -f ($remaining -join ', '))
exit 1
