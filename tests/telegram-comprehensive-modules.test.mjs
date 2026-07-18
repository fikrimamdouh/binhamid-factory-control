import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const callbacks=markup=>markup.reply_markup.inline_keyboard.flat().map(button=>button.callback_data);

test('concrete and block sales are independent bot modules',async()=>{
  const {roleHomeRows,concreteSalesMenu,blockSalesMenu,SIMPLE_DEFS}=await import('../api/_lib/bot-enterprise-defs.js');
  const manager=roleHomeRows('manager').flat().map(button=>button.callback_data);
  assert.ok(manager.includes('ent:concrete_sales_menu'));
  assert.ok(manager.includes('ent:block_sales_menu'));
  const concrete=callbacks(concreteSalesMenu('concrete_sales')),block=callbacks(blockSalesMenu('block_sales'));
  for(const action of ['sales:new_concrete','sales:open_concrete','ent:concrete_pre_report','ent:concrete_daily_report','ent:concrete_reports'])assert.ok(concrete.includes(action),`missing concrete action ${action}`);
  for(const action of ['sales:new_block','sales:open_block','ent:block_pre_report','ent:block_daily_report','ent:block_reports'])assert.ok(block.includes(action),`missing block action ${action}`);
  assert.ok(!concrete.some(action=>String(action).includes('block')));
  assert.ok(!block.some(action=>String(action).includes('concrete')));
  assert.equal(SIMPLE_DEFS.concrete_pre_report.prefix,'CPR');
  assert.equal(SIMPLE_DEFS.concrete_daily_report.prefix,'CDR');
  assert.equal(SIMPLE_DEFS.block_pre_report.prefix,'BPR');
  assert.equal(SIMPLE_DEFS.block_daily_report.prefix,'BDR');
  assert.ok(SIMPLE_DEFS.concrete_pre_report.fields.some(([key])=>key==='requirements'));
  assert.ok(SIMPLE_DEFS.concrete_daily_report.fields.some(([key])=>key==='delivered'));
});

test('production reports are role scoped, persisted and sent to management',async()=>{
  const [forms,status,enterprise,sales]=await Promise.all([read('api/_lib/bot-enterprise-forms.js'),read('api/_lib/bot-enterprise-status.js'),read('api/_lib/bot-enterprise.js'),read('api/_lib/bot-sales.js')]);
  for(const marker of ['PRODUCTION_REPORT_ACTIONS','CONCRETE_REPORT_ROLES','BLOCK_REPORT_ROLES','production_report_received','notifyProductionReport','enterprise_operation_created'])assert.match(forms,new RegExp(marker));
  assert.match(forms,/action\.startsWith\('concrete_'\).*CONCRETE_REPORT_ROLES\.has\(role\)/);
  assert.match(forms,/action\.startsWith\('block_'\).*BLOCK_REPORT_ROLES\.has\(role\)/);
  assert.match(status,/sendEnterpriseProductionReports/);
  assert.match(status,/identity\.role==='concrete_sales'/);
  assert.match(status,/identity\.role==='block_sales'/);
  assert.match(enterprise,/concrete_pre_report/);
  assert.match(enterprise,/block_daily_report/);
  assert.match(sales,/mode==='open_concrete'\?'concrete'/);
  assert.match(sales,/mode==='open_block'\?'block'/);
});

test('telegram accounting center uses the shared capability system and real ledger tables',async()=>{
  const [accounting,enterprise]=await Promise.all([read('api/_lib/bot-accounting.js'),read('api/_lib/bot-enterprise.js')]);
  assert.match(accounting,/capabilityAllowed\(identity\.role,VIEW_CAPABILITY,roleRows,userRows\)/);
  for(const table of ['role_capabilities','user_capabilities','accounting_integrity_report','trial_balance','general_ledger','journal_entries'])assert.match(accounting,new RegExp(table));
  for(const action of ['accounting_summary','accounting_trial','accounting_ledger','accounting_search','accounting_entries','accounting_integrity'])assert.match(accounting,new RegExp(action));
  assert.match(enterprise,/continueAccountingSession/);
  assert.match(enterprise,/handleAccountingTextCommand/);
  assert.match(enterprise,/handleAccountingCallback/);
});

test('voice messages acknowledge immediately, transcribe within budget and enter normal bot sessions',async()=>{
  const [handler,voice]=await Promise.all([read('api/_lib/telegram-webhook-handler.js'),read('api/_lib/bot-voice.js')]);
  const acknowledgement=handler.indexOf('تم استلام رسالتك الصوتية'),download=handler.indexOf('downloadTelegramFile(message.voice.file_id)');
  assert.ok(acknowledgement>0&&acknowledgement<download);
  assert.match(handler,/Promise\.all\(\[transcribeTelegramVoice/);
  assert.match(handler,/result\.text\?handleText\(message,group,identity,result\.text/);
  assert.match(voice,/AbortSignal\.timeout\(8500\)/);
  for(const phrase of ['تقرير مسبق','تقرير اليوم','احتياجات الخرسانة','ميزان مراجعة','دفتر أستاذ'])assert.match(voice,new RegExp(phrase));
});

test('communication center observer cannot retrigger itself from class and style mutations',async()=>{
  const source=await read('assets/cloud-control-navigation-fix.js');
  assert.match(source,/observer\.observe\(document\.documentElement,\{childList:true,subtree:true\}\)/);
  assert.doesNotMatch(source,/attributes:true/);
  assert.doesNotMatch(source,/attributeFilter/);
});
