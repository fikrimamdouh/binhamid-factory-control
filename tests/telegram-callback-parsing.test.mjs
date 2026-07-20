import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const handlerUrl=new URL('../api/_lib/telegram-webhook-handler.js',import.meta.url);

test('Telegram callback parsing preserves the full customer pagination payload',async()=>{
  const source=await readFile(handlerUrl,'utf8');
  assert.match(source,/const\[action,value\]=splitCallbackData\(query\.data\)/);
  assert.match(source,/separator=raw\.indexOf\(':'\)/);
  assert.match(source,/raw\.slice\(separator\+1\)/);
  assert.doesNotMatch(source,/String\(query\.data\|\|''\)\.split\(':'\)/);

  const callback='ent:customer_page|balance|1|gt:1000:';
  const separator=callback.indexOf(':');
  const parsed=[callback.slice(0,separator),callback.slice(separator+1)];
  assert.deepEqual(parsed,['ent','customer_page|balance|1|gt:1000:']);
});
