@echo off
setlocal EnableExtensions EnableDelayedExpansion
fltmc >nul 2>&1
if errorlevel 1 (
  echo Run this file as Administrator.
  pause
  exit /b 1
)

set "SOURCE_ROOT=%~dp0..\.."
set "TARGET=C:\BinHamid\FuelAgent"
set "APP=%TARGET%\App"
set "BROWSERS=%TARGET%\Browsers"

where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer, then run this installer again.
  pause
  exit /b 2
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm was not found.
  pause
  exit /b 3
)
for /f "delims=" %%I in ('where node.exe') do if not defined NODE_PATH set "NODE_PATH=%%I"

if not exist "%APP%\scripts" mkdir "%APP%\scripts"
if not exist "%APP%\api\_lib" mkdir "%APP%\api\_lib"
if not exist "%TARGET%\Logs" mkdir "%TARGET%\Logs"
if not exist "%TARGET%\Evidence" mkdir "%TARGET%\Evidence"
if not exist "%BROWSERS%" mkdir "%BROWSERS%"

copy /Y "%~dp0FuelAgent.ps1" "%TARGET%\FuelAgent.ps1" >nul || goto :copyfail
copy /Y "%~dp0local-fuel-agent.mjs" "%APP%\local-fuel-agent.mjs" >nul || goto :copyfail
copy /Y "%~dp0package.json" "%APP%\package.json" >nul || goto :copyfail
copy /Y "%SOURCE_ROOT%\scripts\noor-khoy-fuel-sync.mjs" "%APP%\scripts\noor-khoy-fuel-sync.mjs" >nul || goto :copyfail
copy /Y "%SOURCE_ROOT%\scripts\check-fuel-delivery-status.mjs" "%APP%\scripts\check-fuel-delivery-status.mjs" >nul || goto :copyfail
copy /Y "%SOURCE_ROOT%\api\_lib\fuel-summary-parser.js" "%APP%\api\_lib\fuel-summary-parser.js" >nul || goto :copyfail

>"%TARGET%\node-path.txt" echo %NODE_PATH%
if not exist "%TARGET%\fuel-agent.env" copy /Y "%~dp0fuel-agent.env.example" "%TARGET%\fuel-agent.env" >nul

pushd "%APP%"
set "PLAYWRIGHT_BROWSERS_PATH=%BROWSERS%"
call npm install --omit=dev
if errorlevel 1 goto :installfail
call npx playwright install chromium
if errorlevel 1 goto :installfail
popd

for %%T in (0807 0819 0831 0843 0855) do (
  set "HH=%%T"
  set "TIME=!HH:~0,2!:!HH:~2,2!"
  schtasks /Create /TN "BinHamid Fuel Daily %%T" /SC DAILY /ST !TIME! /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%TARGET%\FuelAgent.ps1\" -Mode daily-report" /RU SYSTEM /RL HIGHEST /F >nul
  if errorlevel 1 goto :taskfail
)
for %%T in (1907 1919 1931 1943 1955) do (
  set "HH=%%T"
  set "TIME=!HH:~0,2!:!HH:~2,2!"
  schtasks /Create /TN "BinHamid Diesel Balance %%T" /SC DAILY /ST !TIME! /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%TARGET%\FuelAgent.ps1\" -Mode vehicle-balance-report" /RU SYSTEM /RL HIGHEST /F >nul
  if errorlevel 1 goto :taskfail
)

echo Installed local fuel fallback agent.
echo Edit: %TARGET%\fuel-agent.env
echo Then run RUN-NOW.cmd to send the diesel balance immediately.
pause
exit /b 0

:copyfail
echo Failed to copy one or more agent files. Run the installer from the complete repository folder.
pause
exit /b 4

:installfail
popd 2>nul
echo Failed to install Node or Chromium dependencies.
pause
exit /b 5

:taskfail
echo Failed to create one or more scheduled tasks.
pause
exit /b 6
