@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\BinHamid\ERP-Failed-Agent\FailedReviewAgent.ps1"
echo.
echo Review log:
echo C:\BinHamid\DailyReports\Logs\failed-review-agent-YYYY-MM-DD.log
pause
