import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('enterprise runtime persists direct operations and data lineage',async()=>{
  const migration=await read('supabase/migrations/005_enterprise_runtime_completion.sql');
  for(const marker of ['finance_events','hr_requests','employee_daily_reports','operation_status_history','document_registry','source_audit_id','project_enterprise_structured_audit','daily_attendance_summary','driver_daily_summary'])assert.match(migration,new RegExp(marker));
});

test('runtime replay protects projections and raises operational alerts',async()=>{
  const migration=await read('supabase/migrations/006_runtime_replay_and_integrity.sql');
  for(const marker of ['audit_enterprise_structured_replay_trigger','flag_negative_inventory','queue_approval_notification','queue_missing_daily_reports','operational_alerts'])assert.match(migration,new RegExp(marker));
});

test('procurement projection and permissions remain database-controlled',async()=>{
  const migration=await read('supabase/migrations/007_procurement_projection_and_permissions.sql');
  for(const marker of ['project_supplier_quote_request','source_event_type','supplier_quote_request_projection_trigger','role_capabilities','user_capabilities'])assert.match(migration,new RegExp(marker));
});

test('management route provides task, status, approvals and notification actions',async()=>{
  const source=await read('api/_lib/routes/management.js');
  for(const marker of ["action==='set_status'","action==='create_task'","action==='approval_decision'","action==='enqueue_notification'",'approvals_pending','notifyOperationSource','enterprise_operation_status','next_document_no'])assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('operations and reports interfaces preserve the original application',async()=>{
  const [index,actions,reports]=await Promise.all([read('index.html'),read('assets/cloud-operations-actions.js'),read('assets/cloud-reports.js')]);
  assert.match(index,/cloud-operations-actions\.js/);
  assert.match(index,/cloud-reports\.js/);
  for(const marker of ['bhOpsNewTask','create_task','set_status','approval_decision','bhOperationNotify'])assert.match(actions,new RegExp(marker));
  for(const marker of ['sales','maintenance','inventory','collections','finance','purchases','quality','attendance','fleet','tasks','dailyReports','exportCsv','printReport'])assert.match(reports,new RegExp(marker));
});

test('documents stay verifiable without external chart services',async()=>{
  const [documents,verify,management]=await Promise.all([read('api/_lib/bot-documents.js'),read('verify-document.html'),read('api/_lib/routes/management.js')]);
  assert.match(documents,/document_registry/);
  assert.match(documents,/createHash\('sha256'\)/);
  assert.match(documents,/verify-document\.html\?code=/);
  assert.match(management,/export async function documentVerification/);
  assert.match(verify,/\/api\/documents\/verify\?code=/);
  assert.doesNotMatch(documents,/quickchart\.io/);
});

test('schedulers remain on-demand and do not call absent external URLs',async()=>{
  const [notifications,cron,operational,telegram]=await Promise.all([read('api/_lib/bot-notifications.js'),read('api/cron/manager-brief.js'),read('.github/workflows/operational-schedule.yml'),read('.github/workflows/bot-schedules.yml')]);
  for(const marker of ['processNotificationOutbox','retryFailedNotifications','queueDailyReportReminders','notification_outbox'])assert.match(notifications,new RegExp(marker));
  assert.match(cron,/CRON_SECRET غير مضبوط/);
  assert.match(cron,/onDemandOnly:true/);
  assert.match(cron,/enabled:false/);
  assert.doesNotMatch(cron,/mode==='all'/);
  for(const workflow of [operational,telegram]){
    assert.match(workflow,/workflow_dispatch/);
    assert.doesNotMatch(workflow,/\bschedule:/);
    assert.doesNotMatch(workflow,/\bcron:/);
    assert.doesNotMatch(workflow,/curl --fail/);
    assert.doesNotMatch(workflow,/BINHAMID_CRON_URL|BOT_CRON_URL/);
  }
});

test('sync conflict and Telegram WebApp validation remain server-side',async()=>{
  const state=await read('api/state.js'),initial=await read('supabase/migrations/001_initial_schema.sql'),webapp=await read('api/_lib/telegram-webapp.js'),driver=await read('api/_lib/routes/driver-webapp.js');
  assert.match(state,/p_base_revision/);assert.match(state,/revision conflict/i);assert.match(state,/status\s*=\s*409/);
  assert.match(initial,/save_app_state/);assert.match(initial,/revision conflict/);
  assert.match(webapp,/timingSafeEqual/);assert.match(webapp,/WebAppData/);assert.match(webapp,/auth_date/);
  assert.match(driver,/vehicleFor/);assert.match(driver,/client_event_id/);assert.match(driver,/receiptDataUrl/);assert.match(driver,/مركبة مسندة/);
});

test('readiness requires schema 33 and reports accounting, governance, reset and persistent master gaps',async()=>{
  const readiness=await read('api/_lib/routes/system-runtime.js');
  assert.match(readiness,/LATEST_REQUIRED_VERSION=33/);
  for(const marker of ['missingTables','missingColumns','missingMigrations','migration_history.sequence','collectDatabaseReadiness','financial_periods','credit_override_requests','unified_assets','compliance_documents','handover_acceptance_runs','control_asset_duplicates','credit_override_id','chart_of_accounts','journal_entries','journal_entry_lines','general_ledger','trial_balance','accounting_integrity_report','telegram_update_receipts','user_invitations','nickname','master_data_import_runs','employee_asset_directory','control_employee_identity_duplicates','national_id','persistentEmployeeMaster','telegramIdentityAutoLink','erpPaymentReconciliation'])assert.match(readiness,new RegExp(marker));
  assert.doesNotMatch(readiness,/ready:\s*true,\s*schemaVersion/);
});
