@echo off
setlocal EnableExtensions
fltmc >nul 2>&1
if errorlevel 1 (
  echo Run this file as Administrator.
  pause
  exit /b 1
)
for %%T in (0807 0819 0831 0843 0855) do schtasks /Delete /TN "BinHamid Fuel Daily %%T" /F >nul 2>&1
for %%T in (1907 1919 1931 1943 1955) do schtasks /Delete /TN "BinHamid Diesel Balance %%T" /F >nul 2>&1
echo Scheduled tasks removed.
echo C:\BinHamid\FuelAgent was kept so secrets, logs and evidence are not deleted automatically.
pause
