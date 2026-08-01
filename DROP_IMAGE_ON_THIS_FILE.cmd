@echo off
setlocal
cd /d "%~dp0"
title Process One Extended Art Image

if "%~1"=="" (
  echo Drag one or more PNG, JPG, WEBP, or TIFF images onto this file.
  pause
  exit /b 1
)

if exist "ExtendedArtOffline.exe" (
  "ExtendedArtOffline.exe" process %*
) else (
  where py >nul 2>nul
  if errorlevel 1 goto :missing
  py -3 "app\drop_workflow.py" process %*
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
