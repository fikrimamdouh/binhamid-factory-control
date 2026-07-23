import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const sync=read('assets/sync-integrity-guard.js');
const cloud=read('assets/cloud-control.js');
const login=read('assets/login-sync.js');
const telegram=read('assets/telegram-pdf-declarations.js');
const reports=read('api/_lib/routes/reports-telegram.js');
const canonical=read('api/_lib/routes/canonical-master-data.js');
const employeeSync=read('assets/employee-declaration-sync.js');
const workspace=read('assets/declaration-workspace-fixes.js');
const masterOps=read('assets/master-data-unified-operations.js');
const index=read('index.html');

test('safe cloud pull always bypasses boot metadata interception and never prints runtime notices',()=>{
  assert.match(sync,/\/api\/state\?full=1/);
  assert.match(sync,/className='noprint no-print'/);
  assert.match(login,/className='noprint no-print'/);
  assert.match(cloud,/api\('\/api\/state\?full=1'\)/);
  assert.match(cloud,/api\('\/api\/state\?meta=1'\)/);
});

test('telegram PDF path has a non-sending readiness check and supports preview based print buttons',()=>{
  assert.match(reports,/method\(req,res,\['GET','POST'\]\)/);
  assert.match(reports,/pdfServiceStatus/);
  assert.match(telegram,/deliveryReadiness/);
  assert.match(telegram,/pvStage/);
  assert.match(telegram,/stage\.innerHTML/);
  assert.match(telegram,/data-bh-runtime-notice/);
});

test('telegram employee merge is persisted and propagated to declarations and other screens',()=>{
  assert.match(canonical,/syncEmployeeDeclarationRole/);
  assert.match(canonical,/employee_external_id:employee\.external_id/);
  assert.match(canonical,/app_user_id=neq/);
  assert.match(employeeSync,/route=canonical-master-data/);
  assert.match(employeeSync,/binhamid-canonical-master-data-updated/);
  assert.match(masterOps,/binhamid-employee-roster-updated/);
  assert.match(masterOps,/الإقرارات تبقى في صفحة إصدار النماذج الحالية فقط/);
});

test('existing issue page owns vehicle and driver completion, separate languages, and workshop guard',()=>{
  assert.match(workspace,/العربية فقط/);
  assert.match(workspace,/English only/);
  assert.match(workspace,/اردو فقط/);
  assert.match(workspace,/استكمال بيانات السيارة والسائق من نفس صفحة الإقرار/);
  assert.match(workspace,/save_asset/);
  assert.match(workspace,/save_employee/);
  assert.match(workspace,/في الورشة أو متوقفة/);
  assert.match(workspace,/languageOnly/);
  assert.match(index,/declaration-workspace-fixes\.js\?v=20260723-1/);
});
