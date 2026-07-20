# PR-WS-00 — Workshop Baseline

Checked at: 2026-07-20 07:18 UTC  
Repository branch: `agent/workshop-baseline-20260720`  
Database mode: read-only  
Schema version: 24

## Recovery gate

- The encrypted production backup exists.
- The isolated restore drill passed.
- The restored SQL was verified and plaintext was removed after the drill.
- No workshop migration has been executed.

## Production database snapshot

| Item | Result |
|---|---:|
| `maintenance_orders` | 2 |
| `maintenance_updates` | 1 |
| `operational_records` | 23 |
| Workshop records inside `operational_records` | 4 |
| `audit_log` rows | 70 |
| `unified_assets` | 0 |
| `vehicles` | 0 |

## Confirmed split-source defect

The source split is present and measurable:

- 2 maintenance orders exist.
- 0 maintenance orders resolve to a matching `operational_records.reference_no`.
- Both maintenance orders are missing an operations-center link.
- 4 workshop operational records exist, and none resolves to `maintenance_orders`.
- Both maintenance orders are not linked to `unified_assets`.

This confirms that workshop state is currently represented independently in both tables.

## Current maintenance data

Maintenance statuses currently stored:

- `cancelled`: 1
- `quotation_required`: 1

Both rows have a null `vehicle_external_id`. There are no duplicate Telegram source message keys.

## Current workshop reporting

Workshop activity stored in `audit_log`:

- Daily reports: 3
- Inspections: 1
- Order updates: 0
- Total workshop-related audit actions: 5

There is no dedicated `workshop_daily_reports` table.

## Missing target tables

The following 13 planned tables do not exist:

1. `maintenance_status_history`
2. `maintenance_labor_entries`
3. `maintenance_diagnostics`
4. `maintenance_parts`
5. `maintenance_attachments`
6. `maintenance_checklist_templates`
7. `maintenance_checklist_items`
8. `maintenance_checklist_results`
9. `preventive_maintenance_plans`
10. `preventive_maintenance_schedules`
11. `preventive_maintenance_executions`
12. `asset_meter_readings`
13. `workshop_daily_reports`

## Confirmed application-code defects

- `bot-maintenance.js` inserts and patches `maintenance_orders` directly.
- `bot-mechanic.js` inserts `maintenance_updates` and patches order status directly.
- Status is inferred from Arabic words inside free text.
- A text-derived `completed` status writes `closed_at` immediately.
- Daily workshop reports are stored as text inside `audit_log`.
- Assets without plates are stored as descriptive text in `plate_snapshot` rather than as a unified asset reference.

## Required reconciliation before PR-WS-01 is applied

1. Define the authoritative mapping for the 2 maintenance orders and 4 workshop operational records.
2. Preserve all six records; no deletion or overwrite is permitted.
3. Create a review queue for records that cannot be matched deterministically.
4. Add a stable `asset_external_id` link to `maintenance_orders` while preserving `vehicle_external_id` during transition.
5. Create operations-center linkage using `reference_no` and the maintenance order ID.
6. Route every future status change through the workshop state machine.
7. Keep Telegram source-message idempotency as a unique guarded key.

## Gate decision

PR-WS-00 passes. PR-WS-01 may be authored as migration 025, but it must remain non-destructive and must not be applied to production until:

- the four orphan workshop operational records are classified;
- the two maintenance orders are placed in the migration mapping;
- pre-migration encrypted backup succeeds;
- migration preflight reports zero destructive statements;
- rollback and post-migration verification scripts are present.
