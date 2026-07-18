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
  assert.match(forms,/MANAGEMENT_FEEDBACK_ACTIONS=new Set\(\['management_suggestion','management_problem'\]\)/);
  assert.ok(forms.includes("if(def.category==='incident'&&!new Set(['daily_report',...MANAGEMENT_FEEDBACK_ACTIONS]).has(action))"));
});

test('reports validate identity inside execution functions',async()=>{
  const status=await read('api/_lib/bot-enterprise-status.js');
  for(const marker of ['TEAM_ROLES','OPERATIONS_ROLES','ALERT_ROLES','DAILY_REPORT_ROLES','CATEGORY_ROLES'])assert.match(status,new RegExp(marker));
  assert.match(status,/sendEnterpriseOperations\(chatId,identity\)/);
  assert.match(status,/sendEnterpriseAlerts\(chatId,identity\)/);
  assert.match(status,/sendEnterpriseDailyReports\(chatId,identity\)/);
  assert.match(status,/sendEnterpriseCategorySummary\(chatId,identity,category,title\)/);
  assert.match(status,/teamAccess=TEAM_ROLES\.has\(identity\.role\)/);
});

test('callbacks pass identity to protected reports and insights',async()=>{
  const enterprise=await read('api/_lib/bot-enterprise.js');
  for(const call of ['sendEnterpriseOperations(message.chat.id,identity)','sendEnterpriseDailyReports(message.chat.id,identity)','sendEnterpriseAlerts(message.chat.id,identity)','sendFuelAnomalies(message.chat.id,identity)','sendInventoryRisks(message.chat.id,identity)','sendDebtAnalysis(message.chat.id,identity)','sendConcreteCapacity(message.chat.id,identity)'])assert.ok(enterprise.includes(call),`missing protected call ${call}`);
  assert.match(enterprise,/if\(!identity\?\.active\)return sendMessage/);
});

test('search results and operational insights are role scoped',async()=>{
  const search=await read('api/_lib/bot-enterprise-search.js');
  const fleet=await read('api/_lib/bot-insights-fleet.js');
  const ops=await read('api/_lib/bot-insights-ops.js');
  for(const marker of ['CUSTOMER_ROLES','VEHICLE_ROLES','MAINTENANCE_ROLES','INVENTORY_ROLES','CATEGORY_SCOPE','operationAllowed'])assert.match(search,new RegExp(marker));
  assert.match(search,/operations المسموحة لدورك|العمليات المسموحة لدورك/);
  assert.match(fleet,/FUEL_ROLES/);
  assert.match(fleet,/driver_events/);
  assert.match(ops,/INVENTORY_ROLES/);
  assert.match(ops,/DEBT_ROLES/);
  assert.match(ops,/CAPACITY_ROLES/);
  assert.match(ops,/sales_orders/);
  assert.match(ops,/inventory_items/);
});
