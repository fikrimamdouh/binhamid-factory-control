import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEVICE_CAPABILITIES } from '../api/_lib/device-session.js';
import { roleAllows } from '../api/_lib/permissions.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('factory transport device cannot read or mutate governance data',()=>{
  assert.deepEqual(DEVICE_CAPABILITIES,[]);
  for(const capability of ['governance.view','financial_period.manage','credit_override.approve','assets.manage','compliance.manage','custody.approve','handover.manage','restore_test.manage'])assert.equal(DEVICE_CAPABILITIES.includes(capability),false,capability);
});

test('governance duties remain separated by role',()=>{
  assert.equal(roleAllows('manager','credit_override.approve'),true);
  assert.equal(roleAllows('manager','financial_period.manage'),false);
  assert.equal(roleAllows('accountant','financial_period.manage'),true);
  assert.equal(roleAllows('accountant','credit_override.request'),true);
  assert.equal(roleAllows('accountant','credit_override.approve'),false);
  assert.equal(roleAllows('hr','compliance.manage'),true);
  assert.equal(roleAllows('fuel_operator','assets.manage'),false);
});

test('governance API maps sensitive actions to explicit capabilities',async()=>{
  const route=await read('api/_lib/routes/governance.js');
  const expected={financial_period_close:'financial_period.manage',credit_override_request:'credit_override.request',credit_override_decide:'credit_override.approve',asset_upsert:'assets.manage',compliance_upsert:'compliance.manage',custody_request:'custody.manage',custody_decide:'custody.approve',restore_test_record:'restore_test.manage',handover_start:'handover.manage',handover_signoff:'handover.manage'};
  for(const [action,capability] of Object.entries(expected)){assert.ok(route.includes(`${action}:'${capability}'`),`${action} must require ${capability}`);}
  assert.match(route,/requireCapability\(req,'governance\.view'\)/);
});

test('governance page requires authenticated access and exports evidence',async()=>{
  const page=await read('governance.html'),entry=await read('assets/governance-entry.js'),index=await read('index.html');
  for(const marker of ['/api/governance','الحوكمة والتسليم المؤسسي','تصدير JSON','مركز الرقابة'])assert.match(page,new RegExp(marker));
  assert.match(page,/401|403|رمز|تسجيل دخول/);
  assert.match(entry,/control-center\.html/);assert.match(entry,/مركز إدارة المصنع/);assert.doesNotMatch(entry,/governance\.html/);assert.match(index,/governance-entry\.js/);
});

test('migration workflow tests through schema 21 with encrypted backups and isolated restore',async()=>{
  const workflow=await read('.github/workflows/apply-pending-migrations.yml'),preflight=await read('scripts/governance-migration-preflight.mjs'),verify=await read('scripts/governance-migration-verify.mjs');
  for(const marker of ['019_accounting_import_and_telegram_integrity.sql','020_accounting_reversal_and_projection_safety.sql','021_reversal_ledger_balance_fix.sql','pre-migration-backup','post-migration-backup','--single-transaction','Restore production backup to isolated PostgreSQL 17','Run transactional accounting and duplicate acceptance'])assert.ok(workflow.includes(marker),`workflow missing ${marker}`);
  assert.match(workflow,/current_version \+ 1\)\) 21/);
  assert.match(preflight,/targetVersion:21/);assert.match(verify,/toVersion:21/);assert.match(verify,/PROTECTED_ROW_COUNT_CHANGED/);assert.match(verify,/ACCOUNTING_INTEGRITY_FAILED/);
});

test('financial, credit and maintenance guards are server-side database controls',async()=>{
  const foundation=await read('supabase/migrations/016_enterprise_governance_and_handover.sql'),controls=await read('supabase/migrations/017_governance_control_rpcs.sql'),safety=await read('supabase/migrations/018_governance_safety_refinements.sql');
  for(const marker of ['FINANCIAL_PERIOD_CLOSED','sales_orders_financial_period_guard','collection_events_financial_period_guard','daily_report_batches_financial_period_guard'])assert.match(foundation,new RegExp(marker));
  for(const marker of ['sales_orders_credit_limit_guard','CREDIT_LIMIT_EXCEEDED','CREDIT_OVERRIDE_INVALID','maintenance_closure_control_trigger','MAINTENANCE_DIAGNOSIS_REQUIRED','MAINTENANCE_ATTACHMENT_REQUIRED'])assert.match(controls,new RegExp(marker));
  for(const marker of ['flag_daily_report_credit_breach','daily_report_credit_breach_flag','control_asset_duplicates','like \'DR-%\'','CUSTODY_SETTLEMENT_EXCEEDS_OUTSTANDING','HANDOVER_BLOCKERS_OPEN'])assert.ok(safety.includes(marker),`safety migration missing ${marker}`);
});

test('backup is limited to the independently restorable public application schema',async()=>{
  const backup=await read('scripts/backup-supabase.mjs'),verify=await read('scripts/verify-backup-files.mjs');
  for(const marker of ["'--schema=public'","databaseScope:'public-schema'","schemas:['public']"])assert.ok(backup.includes(marker),`backup missing ${marker}`);
  for(const marker of ['BACKUP_SCOPE_NOT_RESTORABLE',"manifest.databaseScope!=='public-schema'","result.databaseScope!=='public-schema'"])assert.ok(verify.includes(marker),`backup verifier missing ${marker}`);
});

test('restore drill runs after verified backup and never restores production',async()=>{
  const workflow=await read('.github/workflows/backup-restore-drill.yml'),script=await read('scripts/restore-drill.mjs');
  for(const marker of ['postgres:17','Encrypted Database Backup','encrypted-database-backup-${run_id}','databaseScope','LOCAL_DATABASE_URL','Assert plaintext cleanup','restore-drill-result.json'])assert.ok(workflow.includes(marker),`restore workflow missing ${marker}`);
  for(const marker of ['createDecipheriv','aes-256-gcm','BH01','gunzipSync','rmSync(plaintextPath','productionEvidenceRecorded'])assert.ok(script.includes(marker),`restore script missing ${marker}`);
  assert.match(script,/command\('psql',\[localDb,'-X','-v','ON_ERROR_STOP=1','-f',plaintextPath\]/);
  assert.doesNotMatch(script,/command\('psql',\[productionDb,[^\]]*'-f'/);
});
