import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/025_workshop_central_data_model.sql',import.meta.url),'utf8');

test('migration 025 is non-destructive and records its version',()=>{
  assert.doesNotMatch(sql,/\btruncate\b/i);
  assert.doesNotMatch(sql,/\bdrop\s+table\b/i);
  assert.match(sql,/insert into public\.migration_history\(version,migration_name\)/i);
  assert.match(sql,/values\(25,'025_workshop_central_data_model'\)/i);
});

test('migration 025 preserves legacy workshop records through reconciliation',()=>{
  assert.match(sql,/create table if not exists public\.maintenance_reconciliation_queue/i);
  assert.match(sql,/missing_asset_link/);
  assert.match(sql,/missing_operational_link/);
  assert.match(sql,/orphan_operational_record/);
  assert.match(sql,/source_snapshot jsonb not null/);
});

test('maintenance orders become the authoritative source for operations center projections',()=>{
  assert.match(sql,/maintenance_order_id uuid/);
  assert.match(sql,/operational_records_maintenance_order_fk/);
  assert.match(sql,/operational_records_maintenance_order_uidx/);
  assert.match(sql,/created_linked_operational_projection/);
});

test('all required workshop data domains exist',()=>{
  for(const table of [
    'maintenance_status_history','maintenance_labor_entries','maintenance_diagnostics',
    'maintenance_parts','maintenance_attachments','maintenance_checklist_templates',
    'maintenance_checklist_items','maintenance_checklist_results','preventive_maintenance_plans',
    'preventive_maintenance_schedules','preventive_maintenance_executions','asset_meter_readings',
    'workshop_daily_reports'
  ])assert.match(sql,new RegExp(`create table if not exists public\\.${table}`,'i'));
});

test('the published workshop state machine contains guarded lifecycle transitions',()=>{
  assert.match(sql,/workshop_status_transition_allowed/);
  assert.match(sql,/when p_from='testing' and p_to in \('ready_for_handover','in_repair','on_hold'\)/);
  assert.match(sql,/when p_from='ready_for_handover' and p_to in \('completed','in_repair','on_hold'\)/);
  assert.match(sql,/when p_from='completed' and p_to in \('closed','in_repair'\)/);
  assert.match(sql,/maintenance_orders_status_history_trigger/);
});

test('Telegram idempotency is protected at the database layer',()=>{
  assert.match(sql,/maintenance_orders_telegram_source_uidx/);
  assert.match(sql,/maintenance_attachments_telegram_uidx/);
  assert.match(sql,/workshop_daily_reports_telegram_uidx/);
});
