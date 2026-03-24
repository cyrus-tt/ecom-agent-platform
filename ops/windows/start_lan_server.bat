@echo off
setlocal
cd /d %~dp0

echo [1/2] Installing dependencies...
npm install
if %errorlevel% neq 0 (
  echo npm install failed.
  exit /b 1
)

echo [2/2] Starting LAN test server on 0.0.0.0:3000 ...
node server.js
