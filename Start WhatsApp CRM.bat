@echo off
title WhatsApp CRM - starting
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1" -Open
if errorlevel 1 (
  echo.
  echo Something failed. See logs\stack.log in this folder.
  pause
)
