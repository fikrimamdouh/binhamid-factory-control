import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const roles=read('api/_lib/employee-declaration-role.js');
const management=read('api/_lib/routes/employee-management.js');
const attendance=read('api/admin/attendance.js');
const bridge=read('assets/employee-declaration-sync.js');
const transfer=read('assets/employee-link-transfer.js');
const index=read('index.html');

test('job titles resolve to the declaration roles used by employee forms',()=>{
  for(const role of ['block_sales','concrete_sales','driver','accountant','mechanic','collector','warehouse','fuel_operator','hr','procurement','quality','manager'])assert.match(roles,new RegExp(`return'${role}'`));
  assert.match(roles,/roleFromJobTitle/);
  assert.match(roles,/resolveEmployeeDeclarationRole/);
  assert.match(roles,/jobTitle/);
});

test('Telegram transfer and task changes update the employee declaration role',()=>{
  assert.match(management,/syncEmployeeDeclarationRole/);
  assert.match(management,/source:'telegram_transfer'/);
  assert.match(management,/source:'assignment_task'/);
  assert.match(management,/declarationRole/);
  assert.match(management,/reconcile_employee_declaration_roles/);
});

test('the original attendance assignment path also updates declaration roles',()=>{
  assert.match(attendance,/employee-declaration-role\.js/);
  assert.match(attendance,/syncEmployeeDeclarationRole/);
  assert.match(attendance,/source:'attendance_assignment'/);
  assert.match(attendance,/select=external_id,full_name,role,active,metadata/);
});

test('existing linked employees are reconciled and merged into the legacy employee roster',()=>{
  assert.match(roles,/reconcileLinkedEmployeeDeclarationRoles/);
  assert.match(roles,/employee_assignments/);
  assert.match(roles,/app_users/);
  assert.match(bridge,/reconcile_employee_declaration_roles/);
  assert.match(bridge,/attendance-safe&scope=employee-sites/);
  assert.match(bridge,/mergeCloudEmployees/);
  assert.match(bridge,/existing\[key\]=value/);
});

test('opening declaration forms refreshes their employee list without a boot-wide redraw',()=>{
  assert.match(bridge,/إصدار النماذج/);
  assert.match(bridge,/الخطابات/);
  assert.match(bridge,/الإقرارات/);
  assert.match(bridge,/refreshDeclarations\(true\)/);
  assert.match(bridge,/typeof window\.rAll==='function'/);
  assert.match(index,/employee-declaration-sync\.js\?v=20260722-1/);
  assert.ok(index.indexOf('attendance-control.js')<index.indexOf('employee-declaration-sync.js'));
});

test('link changes notify other open program tabs to refresh declaration employees',()=>{
  assert.match(transfer,/binhamid_employee_declaration_refresh_v1/);
  assert.match(transfer,/signalDeclarations/);
  assert.match(transfer,/تحديث نموذج الخطاب/);
  assert.match(bridge,/window\.addEventListener\('storage'/);
});
