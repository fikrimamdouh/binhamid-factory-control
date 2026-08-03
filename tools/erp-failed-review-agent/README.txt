BinHamid ERP Failed Review Agent
================================

Purpose
-------
Reviews XLSX files in:
C:\BinHamid\DailyReports\Failed

It does NOT upload files directly. It returns only server-approved repairable files to Incoming, where the existing ERP sync performs the normal authenticated upload.

Safety rules
------------
1. Unknown errors are never retried automatically.
2. ERP_SYNC_NOT_DAILY_REPORT is never retried automatically.
3. ERP_TRANSACTION_CONFLICT is never retried automatically.
4. ERP_RANGE_UNDATED_ROWS is retried only when the production server policy declares the current importer revision capable of repairing it.
5. The exact same file hash gets only one retry per server revision.
6. When several repairable files exist for one report date, only the newest is retried. Older copies move to:
   C:\BinHamid\DailyReports\ManualReview\Superseded
7. Business data under DailyReports is never deleted by the installer or uninstaller.

Installation
------------
Right-click INSTALL-AS-ADMIN.cmd and choose Run as administrator.
The scheduled task runs every five minutes.

Logs
----
C:\BinHamid\DailyReports\Logs\failed-review-agent-YYYY-MM-DD.log
C:\BinHamid\DailyReports\Logs\failed-review-agent-state.json

Manual execution
----------------
Run RUN-NOW.cmd after installation.

Removal
-------
Right-click UNINSTALL-AS-ADMIN.cmd and choose Run as administrator.
