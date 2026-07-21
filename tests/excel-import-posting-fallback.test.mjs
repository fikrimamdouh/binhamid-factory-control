import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Excel remains registered when automatic posting fails',async()=>{
  const source=await read('api/_lib/bot-files.js');
  assert.match(source,/postingFailure=String\(error\?\.message/);
  assert.match(source,/status:'ready_for_review'/);
  assert.match(source,/الملف مسجل ولم تُفقد نتيجة القراءة/);
  assert.match(source,/pendingApproval:approval\.waitingApproval\|\|Boolean\(postingFailure\)/);
});

test('Storage failure does not discard an already parsed workbook',async()=>{
  const source=await read('api/_lib/bot-files.js');
  assert.match(source,/\[telegram excel storage fallback\]/);
  assert.match(source,/ORIGINAL_STORAGE_FAILED/);
  assert.match(source,/لم تُهمل نتيجة القراءة/);
});

test('product photos route through image identification instead of generic attachment storage',async()=>{
  const source=await read('api/_lib/bot-files.js');
  assert.match(source,/session\?\.state==='product_image_waiting'/);
  assert.match(source,/return handleProductImage\(message,identity,downloaded\.buffer/);
});
