import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('all operational roles have dedicated home actions',async()=>{
  const enterprise=await read('api/_lib/bot-enterprise.js');
  for(const role of ['driver','employee','warehouse','fuel_operator','hr','procurement','quality'])assert.match(enterprise,new RegExp(`role==='${role}'`));
  for(const callback of ['home:attendance','gps:fleet','ent:inventory_menu','ent:fuel_menu','ent:hr_menu','ent:quality_menu','home:suppliers'])assert.match(enterprise,new RegExp(callback.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('forms enforce permissions on start, continuation and confirmation',async()=>{
  const forms=await read('api/_lib/bot-enterprise-forms.js');
  for(const marker of ['COLLECTION_ROLES','INVENTORY_ROLES','PURCHASE_ROLES','FUEL_ROLES','TRIP_ROLES','CUSTOMER_ROLES','HR_ADMIN_ACTIONS','QUALITY_ADMIN_ACTIONS','TASK_CREATE_ROLES'])assert.match(forms,new RegExp(marker));
  assert.match(forms,/const denied=permission\(identity,action,def\)/);
  assert.match(forms,/export async function confirmEnterpriseForm[\s\S]*permission\(identity,action,def\)/);
  assert.match(forms,/!identity\?\.active/);
});

test('employee self service and specialist controls are separated',async()=>{
  const forms=await read('api/_lib/bot-enterprise-forms.js');
  assert.match(forms,/HR_ADMIN_ACTIONS=new Set\(\['hr_expiry','hr_payroll'\]\)/);
  assert.match(forms,/QUALITY_ADMIN_ACTIONS=new Set\(\['quality_check','quality_corrective'\]\)/);
  assert.match(forms,/action==='quality_issue'/);
  assert.match(forms,/def\.category==='incident'&&action!=='daily_report'/);
});
