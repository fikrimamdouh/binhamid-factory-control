@echo off
setlocal EnableExtensions
fltmc >nul 2>&1
if errorlevel 1 (
  echo Run this file as Administrator.
  pause
  exit /b 1
)
schtasks /Delete /TN "BinHamid ERP Failed Review Agent" /F >nul 2>&1
if exist "C:\BinHamid\ERP-Failed-Agent" rmdir /S /Q "C:\BinHamid\ERP-Failed-Agent"
echo Failed review agent removed. DailyReports data was not deleted.
pause
