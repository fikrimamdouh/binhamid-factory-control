import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEVICE_CAPABILITIES } from '../api/_lib/device-session.js';
import { roleAllows } from '../api/_lib/permissions.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('factory device can view governance but cannot mutate governance controls',()=>{
  assert.ok(DEVICE_CAPABILITIES.includes('governance.view'));
  for(const capability of ['financial_period.manage','credit_override.approve','assets.manage','compliance.manage','custody.approve','handover.manage','restore_test.manage'])assert.equal(DEVICE_CAPABILITIES.includes(capability),false,capability);
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
  for(const [action,capability] of Object.entries(expected)){assert.match(route,new RegExp(`${action}[^\n]+${capability.replace('.','\\.')}`));}
  assert.match(route,/requireCapability\(req,'governance\.view'\)/);
});

test('governance page is read-only on automatic device sessions and exports evidence',async()=>{
  const page=await read('governance.html'),entry=await read('assets/governance-entry.js'),index=await read('index.html');
  for(const marker of ['/api/governance','الحوكمة والتسليم المؤسسي','تصدير JSON','مركز الرقابة','device-session'])assert.match(page,new RegExp(marker));
  assert.match(entry,/control-center\.html/);assert.match(entry,/governance\.html/);assert.match(index,/governance-entry\.js/);
});

test('migration workflow applies through schema 17 with encrypted backups',async()=>{
  const workflow=await read('.github/workflows/apply-pending-migrations.yml'),preflight=await read('scripts/migration-preflight.mjs'),verify=await read('scripts/migration-verify.mjs');
  for(const marker of ['016_enterprise_governance_and_handover.sql','017_governance_control_rpcs.sql','EXPECTED_SCHEMA_VERSION=17','seq $((current_version + 1)) 17','encrypted-pre-migration-backup','encrypted-post-migration-backup'])assert.match(workflow,new RegExp(marker.replace(/[()$+]/g,'\\$&')));
  assert.match(preflight,/targetVersion:17/);assert.match(verify,/toVersion:17/);assert.match(verify,/PROTECTED_ROW_COUNT_CHANGED/);
});

test('financial and maintenance guards are server-side database controls',async()=>{
  const controls=await read('supabase/migrations/017_governance_control_rpcs.sql');
  for(const marker of ['sales_orders_credit_limit_guard','CREDIT_LIMIT_EXCEEDED','CREDIT_OVERRIDE_INVALID','maintenance_closure_control_trigger','MAINTENANCE_DIAGNOSIS_REQUIRED','MAINTENANCE_ATTACHMENT_REQUIRED','FINANCIAL_PERIOD_CLOSED'])assert.match(controls,new RegExp(marker));
});
