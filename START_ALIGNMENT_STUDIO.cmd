@echo off
setlocal
cd /d "%~dp0"
title ExtendedArt Alignment Studio

if exist "ExtendedArtOffline.exe" (
  "ExtendedArtOffline.exe" web
) else if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "app\drop_workflow.py" web
) else (
  where py >nul 2>nul
  if errorlevel 1 goto :missing
  py -3 "app\drop_workflow.py" web
)

echo.
echo Alignment Studio stopped. Press any key to close.
pause >nul
exit /b %errorlevel%

:missing
echo Python was not found and ExtendedArtOffline.exe is missing.
echo Reinstall the package or install Python 3.11 or newer.
pause
exit /b 1

rem The studio binds to this PC only and opens http://127.0.0.1:8765/
