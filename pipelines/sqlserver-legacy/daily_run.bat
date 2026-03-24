@echo off
setlocal
cd /d %~dp0

if not exist "run_pipeline.py" (
  echo [ERROR] run_pipeline.py not found in %cd%
  exit /b 1
)

if "%~1"=="" (
  for /f %%I in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd')"') do set "INV_DATE=%%I"
) else (
  set "INV_DATE=%~1"
)

if "%~2"=="" (
  for /f %%I in ('powershell -NoProfile -Command "(Get-Date).AddDays(-1).ToString('yyyy-MM-dd')"') do set "SALES_DATE=%%I"
) else (
  set "SALES_DATE=%~2"
)

echo.
echo [Daily] build start
echo [Daily] inventory_date=%INV_DATE%
echo [Daily] sales_date=%SALES_DATE%
echo.

python run_pipeline.py --build-daily --config "%~dp0config.json" --inventory-date "%INV_DATE%" --sales-date "%SALES_DATE%"
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] daily pipeline failed.
  exit /b 1
)

echo.
echo [OK] daily pipeline finished.
echo [Tip] You can pass dates manually:
echo       daily_run.bat 2026-03-06 2026-03-05
exit /b 0
