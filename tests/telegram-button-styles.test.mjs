import test from 'node:test';
import assert from 'node:assert/strict';
import { inferTelegramButtonStyle,styleTelegramMarkup } from '../api/_lib/telegram.js';

test('Telegram buttons receive semantic colors',()=>{
  assert.equal(inferTelegramButtonStyle({text:'تأكيد وحفظ',callback_data:'confirm:1'}),'success');
  assert.equal(inferTelegramButtonStyle({text:'رفض الطلب',callback_data:'reject:1'}),'danger');
  assert.equal(inferTelegramButtonStyle({text:'فتح التفاصيل',callback_data:'open:1'}),'primary');
  assert.equal(inferTelegramButtonStyle({text:'المخزون',callback_data:'ent:inventory_menu'}),'primary');
});

test('explicit styles are preserved and mixed colors are applied centrally',()=>{
  const markup=styleTelegramMarkup({inline_keyboard:[[
    {text:'اعتماد',callback_data:'approve:1'},
    {text:'إلغاء',callback_data:'cancel:1'},
    {text:'عرض',callback_data:'view:1'},
    {text:'محايد',callback_data:'neutral:1'},
    {text:'مخصص',callback_data:'custom:1',style:'danger'}
  ]]});
  const [approve,cancel,view,neutral,custom]=markup.inline_keyboard[0];
  assert.equal(approve.style,'success');
  assert.equal(cancel.style,'danger');
  assert.equal(view.style,'primary');
  assert.equal(neutral.style,undefined);
  assert.equal(custom.style,'danger');
});
