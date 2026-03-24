param(
  [switch]$RebuildWeb
)

& (Join-Path $PSScriptRoot "start_all.ps1") @PSBoundParameters
