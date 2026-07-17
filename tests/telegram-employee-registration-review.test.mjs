import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isEmployeeRegistrationCommand, isPendingRegistration, roleFromApprovalCode } from '../api/_lib/bot-employee-approvals.js';

const read=parts=>fs.readFileSync(new URL(parts.join('/'),import.meta.url),'utf8');

test('employee registration commands are recognized in Arabic and slash form',()=>{
  assert.equal(isEmployeeRegistrationCommand('طلبات تسجيل الموظفين'),true);
  assert.equal(isEmployeeRegistrationCommand('الموظفين المنتظرين'),true);
  assert.equal(isEmployeeRegistrationCommand('/registrations'),true);
  assert.equal(isEmployeeRegistrationCommand('تقرير الخرسانة'),false);
});

test('only inactive pending identities are treated as new registrations',()=>{
  assert.equal(isPendingRegistration({active:false,role:'pending'}),true);
  assert.equal(isPendingRegistration({active:false,role:null}),true);
  assert.equal(isPendingRegistration({active:false,role:'employee'}),false);
  assert.equal(isPendingRegistration({active:true,role:'pending'}),false);
});

test('approval role codes exclude direct admin assignment',()=>{
  assert.equal(roleFromApprovalCode('e'),'employee');
  assert.equal(roleFromApprovalCode('cs'),'concrete_sales');
  assert.equal(roleFromApprovalCode('mg'),'manager');
  assert.equal(roleFromApprovalCode('admin'),'');
});

test('bot review uses the same approval RPC as the web administration page',()=>{
  const flow=read(['..','api','_lib','bot-employee-approvals.js']);
  const admin=read(['..','api','_lib','routes','admin.js']);
  assert.match(flow,/rpc\('approve_telegram_user'/);
  assert.match(admin,/rpc\('approve_telegram_user'/);
  assert.match(flow,/approve_telegram_employee_registration/);
  assert.match(flow,/identity\?\.role==='admin'/);
});

test('admin home and enterprise callbacks expose registration review',()=>{
  const source=read(['..','api','_lib','bot-enterprise.js']);
  assert.match(source,/طلبات تسجيل الموظفين/);
  assert.match(source,/ent:er\|list/);
  assert.match(source,/handleEmployeeRegistrationTextCommand/);
  assert.match(source,/handleEmployeeRegistrationAction/);
});
