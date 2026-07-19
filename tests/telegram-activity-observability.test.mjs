import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('the first Telegram appearance is detected from user_channels and notifies the owner once',async()=>{
  const source=await read('api/_lib/bot-webhook-core.js');
  assert.match(source,/identityWasKnown/);
  assert.match(source,/channel=eq\.telegram&external_id=eq\./);
  assert.match(source,/notifyOwnerOfNewIdentity/);
  assert.match(source,/telegram_user_first_seen/);
  assert.match(source,/دخول مستخدم جديد إلى بوت مصنع بن حامد/);
  assert.match(source,/wasKnown!==false/);
});

test('manager dashboard returns safe previews for recent incoming and outgoing Telegram messages',async()=>{
  const source=await read('api/_lib/routes/manager-dashboard.js');
  assert.match(source,/recentMessages/);
  assert.match(source,/messagePreview/);
  assert.match(source,/text,transcription,file_name,delivery_status/);
  assert.match(source,/replace\(\/<\[\^>\]\*>\/g/);
  assert.match(source,/slice\(0,500\)/);
});

test('bot activity screen renders message previews and Excel import status with escaped cells',async()=>{
  const source=await read('assets/bot-activity-dashboard.js');
  assert.match(source,/آخر الرسائل/);
  assert.match(source,/آخر ملفات Excel الواردة/);
  assert.match(source,/a\.recentMessages/);
  assert.match(source,/data\.imports/);
  assert.match(source,/columns\.map\(column=>`<td>\$\{esc\(column\.value\(row\)\)\}<\/td>`\)/);
  assert.match(source,/الجهاز غير مرتبط بمستخدم مدير/);
});
