@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 未找到 Electron 运行时。
  echo 请在项目目录执行：npm install --include=dev
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0"
