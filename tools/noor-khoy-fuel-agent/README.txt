BinHamid Noor Khoy Fuel Fallback Agent
======================================

Purpose
-------
Runs the Noor Khoy daily fuel report and vehicle diesel balance directly from the factory Windows computer.
It does not depend on GitHub Actions runners.

Authentication
--------------
The local secret file is:
C:\BinHamid\FuelAgent\fuel-agent.env

Required values:
NOOR_KHOY_USERNAME
NOOR_KHOY_PASSWORD
CRON_SECRET

The secret file is never copied into GitHub by this installer.

Installation
------------
1. Keep this folder inside the complete binhamid-factory-control repository.
2. Right-click INSTALL-AS-ADMIN.cmd and choose Run as administrator.
3. Edit C:\BinHamid\FuelAgent\fuel-agent.env and fill the three required values.
4. Run RUN-NOW.cmd to send the current vehicle diesel balance immediately.

Schedules
---------
Daily fuel report: 08:07, 08:19, 08:31, 08:43, 08:55.
Vehicle diesel balance: 19:07, 19:19, 19:31, 19:43, 19:55.

Before every attempt, the agent asks the production API whether the report was already delivered. Later attempts stop without sending a duplicate.
A process lock prevents overlapping browser sessions.

Logs and evidence
-----------------
C:\BinHamid\FuelAgent\Logs
C:\BinHamid\FuelAgent\Evidence

Manual execution
----------------
RUN-NOW.cmd sends the vehicle diesel balance.
RUN-DAILY-NOW.cmd sends the previous day's fuel movement report.

Removal
-------
Right-click UNINSTALL-AS-ADMIN.cmd and choose Run as administrator.
The scheduled tasks are removed. The secret file, logs and evidence are deliberately kept.
