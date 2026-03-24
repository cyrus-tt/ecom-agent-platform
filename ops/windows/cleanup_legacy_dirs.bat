@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup_legacy_dirs.ps1"
endlocal
