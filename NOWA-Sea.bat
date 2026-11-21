@echo off
rem NOWA Sea: double-click to start. The first start installs everything (a few minutes).
rem Arguments go to the server, e.g.:  NOWA-Sea.bat --new --scale 0.25
rem ASCII only: cmd.exe misreads labels and jumps in UTF-8 batch files; the messages live in scripts\start.ps1.
cd /d "%~dp0"
title NOWA Sea
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 (
  echo.
  echo  Something went wrong, see the messages above.
  pause
)
