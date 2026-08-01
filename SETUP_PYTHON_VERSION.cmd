@echo off
setlocal
cd /d "%~dp0"
title Set Up ExtendedArt Offline Workflow

where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 was not found. Install Python 3.12 or newer, then run this file again.
  pause
  exit /b 1
)

py -3 -m venv ".venv"
if errorlevel 1 goto :failed
".venv\Scripts\python.exe" -m pip install -r "requirements.txt"
if errorlevel 1 goto :failed

echo.
echo Setup complete. This computer can now process images offline.
pause
exit /b 0

:failed
echo.
echo Setup failed. Check the messages above.
pause
exit /b 1
