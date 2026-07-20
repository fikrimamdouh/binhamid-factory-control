import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const callbacks=markup=>markup.reply_markup.inline_keyboard.flat().map(button=>button.callback_data);

test('financial director is capability scoped and uses factory source-of-truth tables',async()=>{
  const source=await read('api/_lib/bot-financial-director.js');
  assert.match(source,/capabilityAllowed\(identity\.role,VIEW_CAPABILITY,roleRows,userRows\)/);
  for(const table of ['trial_balance','journal_entries','sales_orders','collection_events','finance_events','approvals','purchase_requests','inventory_items','financial_periods'])assert.match(source,new RegExp(`safeSelect\\('${table}'`));
  for(const metric of ['collectionRate','netCashMovement','receivables','unallocated','draftEntries','pendingApprovalAmount','inventoryRisks'])assert.match(source,new RegExp(metric));
  for(const action of ['cfo_brief','cfo_cash','cfo_risks','cfo_actions'])assert.match(source,new RegExp(action));
  assert.match(source,/التحليل مبني فقط على بيانات المصنع المسجلة/);
});

test('financial and administrative modules are directly available from Telegram',async()=>{
  const {SIMPLE_DEFS,administrationMenu,financeMenu,systemsMenu}=await import('../api/_lib/bot-enterprise-defs.js');
  for(const action of ['finance_budget_request','finance_supplier_commitment','finance_expense_claim','finance_custody_request','admin_decision','admin_meeting','admin_policy','contract_renewal','risk_register'])assert.ok(SIMPLE_DEFS[action],`missing ${action}`);
  const financeCallbacks=callbacks(financeMenu()),adminCallbacks=callbacks(administrationMenu()),systemCallbacks=callbacks(systemsMenu('manager'));
  for(const action of ['ent:cfo_menu','ent:finance_budget_request','ent:finance_supplier_commitment','ent:finance_expense_claim','ent:finance_custody_request'])assert.ok(financeCallbacks.includes(action),`missing finance callback ${action}`);
  for(const action of ['ent:admin_decision','ent:admin_meeting','ent:admin_policy','ent:contract_renewal','ent:risk_register'])assert.ok(adminCallbacks.includes(action),`missing admin callback ${action}`);
  assert.ok(systemCallbacks.includes('ent:cfo_menu'));
  assert.ok(systemCallbacks.includes('ent:admin_menu'));
});

test('financial control requests notify management and administrative forms enforce roles',async()=>{
  const [forms,enterprise,voice]=await Promise.all([read('api/_lib/bot-enterprise-forms.js'),read('api/_lib/bot-enterprise.js'),read('api/_lib/bot-voice.js')]);
  for(const marker of ['FINANCIAL_CONTROL_ACTIONS','ADMINISTRATION_ACTIONS','ADMINISTRATION_ROLES','GOVERNANCE_ACTIONS','GOVERNANCE_ROLES','notifyFinancialControl','financial_control_received'])assert.match(forms,new RegExp(marker));
  assert.match(forms,/financialControl\?'under_review'/);
  assert.match(forms,/active=eq\.true&role=in\.\(admin,manager\)/);
  assert.match(enterprise,/handleFinancialDirectorTextCommand/);
  assert.match(enterprise,/handleFinancialDirectorCallback/);
  assert.match(enterprise,/administrationMenu/);
  for(const phrase of ['مدير مالي','طلب ميزانية','التزام مورد','مطالبة مصروف','كنية الموظف'])assert.match(voice,new RegExp(phrase));
});

test('schema 024 and 025 remain intact while runtime readiness advances to workshop service schema 027',async()=>{
  const [migration24,migration25,migration26,migration27,audit,runtime]=await Promise.all([
    read('supabase/migrations/024_employee_nickname_and_financial_command_center.sql'),
    read('supabase/migrations/025_workshop_central_data_model.sql'),
    read('supabase/migrations/026_workshop_service_rpcs.sql'),
    read('supabase/migrations/027_workshop_service_compatibility.sql'),
    read('scripts/audit-migrations.mjs'),
    read('api/_lib/routes/system-runtime.js')
  ]);
  assert.match(migration24,/values\(24,'024_employee_nickname_and_financial_command_center'\)/);
  assert.match(migration25,/values\(25,'025_workshop_central_data_model'\)/);
  assert.match(migration26,/values\(26,'026_workshop_service_rpcs'\)/);
  assert.match(migration27,/values\(27,'027_workshop_service_compatibility'\)/);
  assert.match(audit,/const latest=27/);
  for(const version of [24,25,26,27])assert.match(audit,new RegExp(`version===${version}`));
  assert.match(runtime,/LATEST_REQUIRED_VERSION=27/);
  assert.match(runtime,/maintenance_reconciliation_queue/);
  assert.match(runtime,/workshop_command_receipts/);
  assert.match(runtime,/workshopCentralService:true/);
  assert.match(runtime,/app_users:\['nickname'\]/);
  assert.match(runtime,/employees:\['nickname'\]/);
  assert.match(runtime,/user_invitations:\['nickname'\]/);
  assert.match(runtime,/financialDirector:true/);
  assert.match(runtime,/administrativeControlCenter:true/);
});
