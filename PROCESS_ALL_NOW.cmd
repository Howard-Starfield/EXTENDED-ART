@echo off
setlocal
cd /d "%~dp0"
title Process Extended Art Images

if exist "ExtendedArtOffline.exe" (
  "ExtendedArtOffline.exe" once
) else (
  where py >nul 2>nul
  if errorlevel 1 goto :missing
  py -3 "app\drop_workflow.py" once
)

echo.
echo Finished. Press any key to close this window.
pause >nul
exit /b %errorlevel%

:missing
echo Python was not found and ExtendedArtOffline.exe is missing.
echo Use the complete release ZIP, or install Python and run SETUP_PYTHON_VERSION.cmd.
pause
exit /b 1
