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

test('sales-role voice messages are prepared for order parsing before transcription returns',()=>{
  const gateway=read('api/_lib/telegram-webhook-gateway.js');
  assert.match(gateway,/prepareSalesVoiceSession/);
  assert.match(gateway,/state:'sales_new_order'/);
  assert.match(gateway,/source:'role_voice_default'/);
  assert.match(gateway,/if\(message\.voice\)/);
  assert.match(gateway,/roleType\(identity\.role\)/);
});

test('attendance checks employee and site binding before opening GPS',()=>{
  const secure=read('api/_lib/bot-attendance-secure.js');
  assert.match(secure,/attendanceReadiness/);
  assert.match(secure,/employee_assignments/);
  assert.match(secure,/work_sites\(id,name,latitude,longitude,radius_m,active\)/);
  assert.match(secure,/لم تُسجل أي حركة حضور أو انصراف/);
  assert.match(secure,/ARABIC_SALES_ROLES/);
  assert.match(secure,/language_code:'ar'/);
});
