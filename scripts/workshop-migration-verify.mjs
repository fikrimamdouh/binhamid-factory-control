import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const databaseUrl=String(process.env.SUPABASE_DB_URL||process.env.TEST_DATABASE_URL||'').trim();
const outputPath=String(process.env.WORKSHOP_MIGRATION_RESULT||'workshop-migration-result.json').trim();
const expectedMinMaintenance=Number(process.env.EXPECTED_MIN_MAINTENANCE_ORDERS||0);
const expectedMinOperational=Number(process.env.EXPECTED_MIN_OPERATIONAL_RECORDS||0);
if(!databaseUrl)throw new Error('SUPABASE_DB_URL or TEST_DATABASE_URL is required.');

function run(sql){
  const result=spawnSync('psql',[databaseUrl,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{
    encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe'],timeout:60000,
  });
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(String(result.stderr||'psql query failed').trim());
  return String(result.stdout||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).at(-1)||'';
}
function number(sql){const value=Number(run(sql));return Number.isFinite(value)?value:0;}
function bool(sql){return run(sql)==='t';}
function json(sql,fallback={}){const raw=run(sql);if(!raw)return fallback;return JSON.parse(raw);}

const requiredTables=[
  'maintenance_reconciliation_queue','maintenance_status_history','maintenance_labor_entries',
  'maintenance_diagnostics','maintenance_parts','maintenance_attachments',
  'maintenance_checklist_templates','maintenance_checklist_items','maintenance_checklist_results',
  'preventive_maintenance_plans','preventive_maintenance_schedules','preventive_maintenance_executions',
  'asset_meter_readings','workshop_daily_reports'
];
const requiredColumns={
  maintenance_orders:['asset_external_id','fault_category','assigned_supervisor_id','started_at','target_completion_at','completed_at','downtime_started_at','downtime_ended_at','approved_cost','root_cause','resolution_summary','test_result','handover_status','version'],
  operational_records:['entity_id','maintenance_order_id','version'],
};
const errors=[];
const schemaVersion=number('select coalesce(max(version),0) from public.migration_history;');
if(schemaVersion<25)errors.push(`schema version ${schemaVersion} is below 25`);
for(const table of requiredTables){if(!bool(`select to_regclass('public.${table}') is not null`))errors.push(`missing table ${table}`);}
for(const [table,columns] of Object.entries(requiredColumns))for(const column of columns){
  if(!bool(`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='${table}' and column_name='${column}')`))errors.push(`missing column ${table}.${column}`);
}

const maintenanceOrders=number('select count(*) from public.maintenance_orders;');
const operationalRecords=number('select count(*) from public.operational_records;');
if(maintenanceOrders<expectedMinMaintenance)errors.push(`maintenance order count fell below ${expectedMinMaintenance}`);
if(operationalRecords<expectedMinOperational)errors.push(`operational record count fell below ${expectedMinOperational}`);

const missingOperationalLinks=number(`select count(*) from public.maintenance_orders mo where not exists(select 1 from public.operational_records o where o.maintenance_order_id=mo.id)`);
if(missingOperationalLinks!==0)errors.push(`${missingOperationalLinks} maintenance orders have no linked operational projection`);
const duplicateOperationalLinks=number(`select count(*) from (select maintenance_order_id,count(*) from public.operational_records where maintenance_order_id is not null group by maintenance_order_id having count(*)>1) x`);
if(duplicateOperationalLinks!==0)errors.push(`${duplicateOperationalLinks} duplicate maintenance operational links exist`);
const duplicateTelegramKeys=number(`select count(*) from (select source_chat_id,source_message_id,count(*) from public.maintenance_orders where source_channel='telegram' and source_chat_id is not null and source_message_id is not null group by source_chat_id,source_message_id having count(*)>1) x`);
if(duplicateTelegramKeys!==0)errors.push(`${duplicateTelegramKeys} duplicate Telegram source keys exist`);

const reconciliation=json(`select coalesce(json_object_agg(issue_type,total),'{}'::json)::text from (select issue_type,count(*) total from public.maintenance_reconciliation_queue group by issue_type order by issue_type) x`,{});
const reconciliationPending=number(`select count(*) from public.maintenance_reconciliation_queue where status='pending'`);
const statusHistory=number('select count(*) from public.maintenance_status_history;');
const legacyDailyReports=number(`select count(*) from public.workshop_daily_reports where source_channel='legacy'`);
const transitionFunction=bool(`select to_regprocedure('public.workshop_status_transition_allowed(text,text)') is not null`);
if(!transitionFunction)errors.push('workshop status transition function is missing');
const statusTrigger=bool(`select exists(select 1 from pg_trigger where tgrelid='public.maintenance_orders'::regclass and tgname='maintenance_orders_status_history_trigger' and not tgisinternal)`);
if(!statusTrigger)errors.push('maintenance status history trigger is missing');

const result={
  ok:errors.length===0,
  checkedAt:new Date().toISOString(),
  schemaVersion,
  counts:{maintenanceOrders,operationalRecords,statusHistory,legacyDailyReports,reconciliationPending},
  linkage:{missingOperationalLinks,duplicateOperationalLinks,duplicateTelegramKeys},
  reconciliation,
  errors,
};
writeFileSync(outputPath,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`WORKSHOP_SCHEMA_OK=25;ORDERS=${maintenanceOrders};OPERATIONAL=${operationalRecords};PENDING_REVIEW=${reconciliationPending}`);
