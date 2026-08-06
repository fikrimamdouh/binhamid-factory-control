@echo off
setlocal
set "TARGET=C:\BinHamid\FuelAgent"
if not exist "%TARGET%\FuelAgent.ps1" (
  echo The agent is not installed. Run INSTALL-AS-ADMIN.cmd first.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TARGET%\FuelAgent.ps1" -Mode vehicle-balance-report
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" echo Failed. Check %TARGET%\Logs
pause
exit /b %CODE%
