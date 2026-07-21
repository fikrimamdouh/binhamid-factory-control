import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram owner uses one canonical environment variable',async()=>{
  const [config,example]=await Promise.all([
    read('api/_lib/config.js'),
    read('.env.example')
  ]);
  assert.match(config,/TELEGRAM_OWNER_ID/);
  assert.match(config,/telegramOwnerId:text\('TELEGRAM_OWNER_ID'\)/);
  assert.match(example,/^TELEGRAM_OWNER_ID=/m);
  assert.doesNotMatch(config,/OWNER_TELEGRAM_ID/);
  assert.doesNotMatch(example,/OWNER_TELEGRAM_ID/);
});

test('Telegram test cleanup is owner-only and cannot select the owner account',async()=>{
  const source=await read('api/_lib/bot-enterprise.js');
  assert.match(source,/if\(!isOwner\(identity\)\)return sendMessage/);
  assert.match(source,/active=eq\.false&role=eq\.pending&select=id/);
  assert.match(source,/if\(ids\.length\)/);
  assert.match(source,/حساب المالك وإعدادات البوت والبيانات المالية والتشغيلية لم تُحذف/);
  assert.doesNotMatch(source,/remove\('app_users'\s*,\s*''\)/);
});
