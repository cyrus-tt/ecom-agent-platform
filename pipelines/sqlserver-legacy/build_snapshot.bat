@echo off
setlocal
cd /d %~dp0

echo [1/2] Installing dependencies...
python -m pip install -r requirements.txt
if %errorlevel% neq 0 (
  echo Dependency install failed.
  exit /b 1
)

echo [2/2] Building dashboard snapshot...
python run_pipeline.py --build-snapshot --config "%~dp0config.json"
if %errorlevel% neq 0 (
  echo Pipeline failed.
  exit /b 1
)

echo Snapshot ready: %~dp0dashboard.html
