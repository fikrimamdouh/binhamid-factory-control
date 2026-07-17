import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateUnitEconomics, normalizePeriod } from '../api/_lib/cost-engine.js';
import { capabilitiesForRole, roleAllows } from '../api/_lib/permissions.js';
import { detectManagerAlerts, stableAlertDigest } from '../api/_lib/manager-metrics.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

process.env.NODE_ENV='test';
const { MockGpsAdapter, compareFuelToGps, normalizeGpsEvent }=await import('../api/_lib/gps-provider.js');

test('unit-cost economics distinguish reliable and incomplete results',()=>{
  const result=calculateUnitEconomics([
    {cost_center:'block',revenue:15000,actual_cost:10000,sold_quantity:5000,direct_cost:8000,indirect_cost:2000,unclassified_cost:0,completeness_percent:100},
    {cost_center:'concrete',revenue:20000,actual_cost:22000,sold_quantity:100,direct_cost:18000,indirect_cost:4000,unclassified_cost:500,completeness_percent:90}
  ]);
  assert.equal(result.block.unitCost,2);
  assert.equal(result.block.marginPerUnit,1);
  assert.equal(result.block.reliable,true);
  assert.equal(result.concrete.grossMargin,-2000);
  assert.equal(result.concrete.reliable,false);
  assert.equal(normalizePeriod('2026-07'),'2026-07-01');
  assert.throws(()=>normalizePeriod('07/2026'));
});

test('server capabilities are explicit and admin remains wildcard',()=>{
  assert.equal(roleAllows('admin','backups.manage'),true);
  assert.equal(roleAllows('accountant','daily_report.approve'),true);
  assert.equal(roleAllows('accountant','financial_period.manage'),true);
  assert.equal(roleAllows('manager','credit_override.approve'),true);
  assert.equal(roleAllows('driver','daily_report.view'),false);
  assert.ok(capabilitiesForRole('manager').includes('governance.view'));
});

test('manager alert keys are stable and cover operational failures',()=>{
  const snapshot={
    day:'2026-07-17',previousDay:'2026-07-16',previousDayReport:null,
    imports:{failed:[{id:'failed-1'}]},reconciliation:{difference:50},
    debtors:{overLimit:[{customerCode:'C1',customerName:'عميل',balance:1500,creditLimit:1000}]},
    collections:{unallocated:200},fuel:{duplicates:1},
    cost:{periodStart:'2026-07-01',unclassified:[{id:'x'}],economics:{block:{grossMargin:-100}}},
    sync:{staleHours:24},backup:{lastSuccessful:null,ageHours:null},notifications:{failed:2}
  };
  const alerts=detectManagerAlerts(snapshot),types=new Set(alerts.map(item=>item.alertType));
  for(const type of ['daily_report_missing','daily_report_failed','daily_report_reconciliation','credit_limit','unallocated_collection','fuel_duplicate','cost_unclassified','negative_margin','sync_stale','backup_stale','notification_failures'])assert.ok(types.has(type),`missing ${type}`);
  assert.equal(stableAlertDigest(alerts),stableAlertDigest([...alerts].reverse()));
  assert.equal(new Set(alerts.map(item=>item.alertKey)).size,alerts.length);
});

test('GPS adapter normalizes events and compares consumption without production mocks',async()=>{
  const event=normalizeGpsEvent({id:'g1',vehicleExternalId:'V1',occurredAt:'2026-07-17T10:00:00Z',latitude:17.5,longitude:44.2,distanceKm:50,engineOn:true},'test-provider');
  assert.equal(event.vehicleExternalId,'V1');
  const adapter=new MockGpsAdapter([
    {providerEventId:'1',vehicleExternalId:'V1',occurredAt:'2026-07-17T10:00:00Z',distanceKm:50,engineOn:true},
    {providerEventId:'2',vehicleExternalId:'V1',occurredAt:'2026-07-17T11:00:00Z',distanceKm:50,engineOn:true}
  ]);
  const events=await adapter.fetchEvents({from:'2026-07-17T00:00:00Z',to:'2026-07-18T00:00:00Z'}),comparison=compareFuelToGps([{vehicleExternalId:'V1',liters:20}],events);
  assert.equal(events.length,2);
  assert.equal(comparison[0].distanceKm,100);
  assert.equal(comparison[0].litersPer100Km,20);
});

test('migrations 011 through 018 contain non-destructive operational and governance foundations',async()=>{
  const cost=await read('supabase/migrations/011_cost_centers_and_operational_resilience.sql'),daily=await read('supabase/migrations/012_daily_report_idempotency_and_validation.sql'),fifo=await read('supabase/migrations/013_fifo_rebuild_and_cost_reversals.sql'),guard=await read('supabase/migrations/014_fifo_replay_and_maintenance_trigger_guard.sql'),customers=await read('supabase/migrations/015_daily_report_customer_master.sql'),governance=await read('supabase/migrations/016_enterprise_governance_and_handover.sql'),controls=await read('supabase/migrations/017_governance_control_rpcs.sql'),safety=await read('supabase/migrations/018_governance_safety_refinements.sql');
  for(const marker of ['cost_centers','cost_periods','run_cost_period','cost_unit_monthly_report','project_driver_fuel_cost','project_maintenance_cost','role_capabilities','backup_runs','gps_provider_events'])assert.match(cost,new RegExp(marker));
  for(const marker of ['daily_report_import_attempts','line_identity','daily_report_sales_identity_uidx','daily_report_cash_identity_uidx','DAILY_REPORT_UNKNOWN_CUSTOMER_CODE','register_daily_report_attempt'])assert.match(daily,new RegExp(marker));
  for(const marker of ['fifo_rebuild_runs','rebuild_customer_fifo','preview_customer_fifo_rebuild','maintenance_order_reversal','active=false','sales_order_backdated_fifo_trigger'])assert.match(fifo,new RegExp(marker));
  for(const marker of ['allocate_collection_fifo_core',"tg_op='UPDATE'"])assert.match(guard,new RegExp(marker));
  for(const marker of ['ensure_daily_report_customer','new.customer_name','new.account_name','DAILY_REPORT_CUSTOMER_INACTIVE'])assert.match(customers,new RegExp(marker));
  for(const marker of ['financial_periods','credit_override_requests','unified_assets','asset_source_links','compliance_documents','custody_accounts','restore_test_runs','handover_acceptance_runs','control_credit_exposure','unified_assets_plate_idx'])assert.match(governance,new RegExp(marker));
  for(const marker of ['close_financial_period','request_credit_override','guard_sales_order_credit','approve_custody_transaction','guard_maintenance_closure','start_handover_acceptance','sign_handover_acceptance'])assert.match(controls,new RegExp(marker));
  for(const marker of ['flag_daily_report_credit_breach','daily_report_credit_breach_flag','control_asset_duplicates','unified_assets_plate_idx'])assert.match(safety,new RegExp(marker));
  assert.ok(guard.includes('greatest(0,coalesce(paid_amount,0)-v_existing.amount)'));
  assert.doesNotMatch([cost,daily,fifo,guard,customers,governance,controls,safety].join('\n'),/truncate\s+table/i);
  assert.doesNotMatch(`${fifo}\n${guard}\n${governance}\n${controls}\n${safety}`,/delete\s+from\s+public\.sales_payment_allocations/i);
});

test('router keeps enterprise features consolidated under one Vercel function',async()=>{
  const router=await read('api/router.js'),vercel=JSON.parse(await read('vercel.json'));
  for(const route of ["'daily-report'","'daily-report/fifo'","'costs'","'driver/webapp'","'resilience'","'dashboard'","'control-center'","'governance'"])assert.ok(router.includes(route));
  for(const source of ['/api/daily-report','/api/daily-report/fifo','/api/costs','/api/driver/webapp','/api/resilience','/api/control-center','/api/governance'])assert.ok(vercel.rewrites.some(item=>item.source===source));
  assert.equal(Object.keys(vercel.functions).length,1);
});

test('sync conflict and Telegram WebApp validation remain server-side',async()=>{
  const state=await read('api/state.js'),initial=await read('supabase/migrations/001_initial_schema.sql'),webapp=await read('api/_lib/telegram-webapp.js'),driver=await read('api/_lib/routes/driver-webapp.js');
  assert.match(state,/p_base_revision/);assert.match(state,/revision conflict/i);assert.match(state,/status\s*=\s*409/);
  assert.match(initial,/save_app_state/);assert.match(initial,/revision conflict/);
  assert.match(webapp,/timingSafeEqual/);assert.match(webapp,/WebAppData/);assert.match(webapp,/auth_date/);
  assert.match(driver,/vehicleFor/);assert.match(driver,/client_event_id/);assert.match(driver,/receiptDataUrl/);assert.match(driver,/مركبة مسندة/);
});

test('readiness requires governance schema 18 and reports missing objects',async()=>{
  const readiness=await read('api/_lib/routes/system-runtime.js');
  assert.match(readiness,/LATEST_REQUIRED_VERSION=18/);
  for(const marker of ['missingTables','missingColumns','missingMigrations','migration_history.sequence','collectDatabaseReadiness','financial_periods','credit_override_requests','unified_assets','compliance_documents','handover_acceptance_runs','control_asset_duplicates','credit_override_id'])assert.match(readiness,new RegExp(marker));
  assert.doesNotMatch(readiness,/ready:\s*true,\s*schemaVersion/);
});
