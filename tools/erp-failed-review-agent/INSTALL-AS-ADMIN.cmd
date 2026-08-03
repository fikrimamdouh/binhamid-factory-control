@echo off
setlocal EnableExtensions
fltmc >nul 2>&1
if errorlevel 1 (
  echo Run this file as Administrator.
  pause
  exit /b 1
)

set "TARGET=C:\BinHamid\ERP-Failed-Agent"
set "TASK=BinHamid ERP Failed Review Agent"
if not exist "%TARGET%" mkdir "%TARGET%"
copy /Y "%~dp0FailedReviewAgent.ps1" "%TARGET%\FailedReviewAgent.ps1" >nul
if errorlevel 1 (
  echo Failed to copy the agent.
  pause
  exit /b 2
)

schtasks /Create /TN "%TASK%" /SC MINUTE /MO 5 /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%TARGET%\FailedReviewAgent.ps1\"" /RU SYSTEM /RL HIGHEST /F >nul
if errorlevel 1 (
  echo Failed to create the scheduled task.
  pause
  exit /b 3
)

schtasks /Run /TN "%TASK%" >nul
echo Installed: %TASK%
echo Runs every 5 minutes and retries only server-approved repairable failures.
pause
