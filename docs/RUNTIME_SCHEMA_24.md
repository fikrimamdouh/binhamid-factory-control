# Runtime Schema 24 — Employee Nickname and Financial Command Center

Apply `supabase/migrations/024_employee_nickname_and_financial_command_center.sql` after migrations 001–023.

What it adds:

- structured `nickname` on `app_users`, `employees`, and `user_invitations`;
- automatic synchronization from the approved application user to the employee record;
- Telegram invitation flow support for the employee's preferred name;
- runtime readiness markers for the financial and administrative command centers.

No new environment variables or secrets are required.

After applying the migration:

1. Open the runtime readiness endpoint from the authenticated administration screen.
2. Confirm `latestRequiredVersion` and `schemaVersion` are both `024`.
3. Create a test employee invitation and enter a nickname.
4. Accept and approve the invitation, then run `/menu` in Telegram.
5. Open “مساعد المدير المالي” and verify the dashboard uses the current accounting and operational data.

The bot keeps a compatibility fallback for invitations created before migration 024, but structured nickname persistence and employee synchronization require the migration.
