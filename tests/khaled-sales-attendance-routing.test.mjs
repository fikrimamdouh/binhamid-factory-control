import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('block sales natural and structured messages enter a sales workflow',()=>{
  const secure=read('api/_lib/bot-sales-secure.js');
  const gateway=read('api/_lib/telegram-webhook-gateway.js');
  assert.match(secure,/export function isStructuredSalesOrder/);
  assert.match(secure,/export function isNaturalSalesMessage/);
  assert.match(secure,/handleStructuredSalesOrder/);
  assert.match(secure,/handleNaturalSalesMessage/);
  assert.match(secure,/state:'sales_new_order'/);
  assert.match(secure,/guided\.startGuidedSales/);
  assert.match(gateway,/structuredSalesCommand=isStructuredSalesOrder/);
  assert.match(gateway,/naturalSalesCommand=isNaturalSalesMessage/);
  assert.match(gateway,/handleStructuredSalesOrder/);
  assert.match(gateway,/handleNaturalSalesMessage/);
});

test('sales-role voice is routed only after its transcription is understood',()=>{
  const gateway=read('api/_lib/telegram-webhook-gateway.js');
  const routing=read('api/_lib/bot-routing.js');
  assert.doesNotMatch(gateway,/prepareSalesVoiceSession|role_voice_default/);
  assert.match(gateway,/if\(message\.voice\|\|message\.document/);
  assert.match(routing,/route\.intent==='sales'/);
  assert.match(routing,/salesTypeForRole/);
  assert.match(routing,/state:'guided_sales_customer'/);
  assert.match(routing,/voice_or_natural_sales_intent/);
  assert.match(routing,/اكتب اسم العميل فقط/);
});

test('attendance checks employee and effective site binding before opening GPS',()=>{
  const secure=read('api/_lib/bot-attendance-secure.js');
  assert.match(secure,/attendanceReadiness/);
  assert.match(secure,/employee_assignments/);
  assert.match(secure,/storedSiteForEmployee/);
  assert.match(secure,/payload->legacy->emp/);
  assert.match(secure,/work_sites/);
  assert.match(secure,/لم تُسجل أي حركة حضور أو انصراف/);
  assert.match(secure,/ARABIC_SALES_ROLES/);
  assert.match(secure,/language_code:'ar'/);
});
