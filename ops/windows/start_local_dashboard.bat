@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_local_dashboard.ps1"
if errorlevel 1 pause
