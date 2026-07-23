import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('master data workspace keeps employees vehicles declarations and recovery in one screen',()=>{
  const nav=read('assets/admin-nav.js');
  const workspace=read('assets/master-data-unified-operations.js');
  assert.match(nav,/master-data-unified-operations\.js/);
  assert.match(workspace,/الإقرارات والسائقون/);
  assert.match(workspace,/استعادة شغل الموظفين والمركبات المحفوظ من 22 يوليو/);
  assert.match(workspace,/إدخال الورشة/);
  assert.match(workspace,/إرجاع للعمل/);
  assert.match(workspace,/فك السائق/);
  assert.match(workspace,/حفظ السائق/);
  assert.match(workspace,/save_employee/);
  assert.match(workspace,/save_asset/);
});

test('quick workshop action unassigns driver and preserves unrelated systems',()=>{
  const workspace=read('assets/master-data-unified-operations.js');
  assert.match(workspace,/operationalStatus:'stopped',employeeExternalId:''/);
  assert.doesNotMatch(workspace,/telegram-webhook|\/api\/customers|\/api\/reports|delete_employee|delete_asset/);
  assert.match(workspace,/لا يتم حذف أي سجل ولا تعديل Telegram أو العملاء أو التقارير/);
});
