import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Telegram maintenance creation and confirmation use the central service only',async()=>{
  const source=await read('api/_lib/bot-maintenance.js');
  for(const marker of ['createTelegramWorkshopDraft','confirmTelegramWorkshopOrder','cancelTelegramWorkshopOrder','searchWorkshopAssets'])assert.match(source,new RegExp(marker));
  assert.doesNotMatch(source,/insert\('maintenance_orders'/);
  assert.doesNotMatch(source,/patch\('maintenance_orders'/);
  assert.doesNotMatch(source,/plate_snapshot:String\(target/);
  assert.match(source,/لا توجد أصول مسجلة في السجل الموحد/);
});

test('mechanic free text records a note and never infers status automatically',async()=>{
  const source=await read('api/_lib/bot-mechanic.js');
  assert.doesNotMatch(source,/function statusFromUpdate/);
  assert.doesNotMatch(source,/patch\('maintenance_orders'/);
  assert.doesNotMatch(source,/تم الانتهاء\|تم الاصلاح\|اكتمل/);
  assert.match(source,/تم حفظ التحديث[\s\S]*دون تغيير الحالة تلقائيًا/);
  assert.match(source,/allowedWorkshopTransitions/);
  assert.match(source,/callback_data:`wst:/);
});

test('Telegram workshop operations are structured and linked to an order',async()=>{
  const source=await read('api/_lib/bot-mechanic.js');
  for(const marker of ['addTelegramDiagnostic','addTelegramLabor','addTelegramPartRequest','submitTelegramWorkshopDailyReport','wstest','wshandover'])assert.match(source,new RegExp(marker));
  assert.match(source,/طلب القطعة[\s\S]*مرتبط بأمر الإصلاح/);
  assert.match(source,/سيُحفظ كتقرير منظم/);
  assert.match(source,/الزر هو الذي يغيّر الحالة/);
});

test('Telegram adapter uses unified assets and structured daily reports',async()=>{
  const source=await read('api/_lib/workshop-telegram-service.js');
  assert.match(source,/select\('unified_assets'/);
  assert.match(source,/createWorkshopOrder/);
  assert.match(source,/transitionWorkshopOrder/);
  assert.match(source,/upsert\('workshop_daily_reports'/);
  assert.match(source,/maintenance_id:order\.id/);
  assert.doesNotMatch(source,/insert\('maintenance_orders'/);
  assert.doesNotMatch(source,/patch\('maintenance_orders'/);
});

test('webhook resumes workshop sessions and routes explicit callbacks',async()=>{
  const source=await read('api/_lib/telegram-webhook-handler.js');
  assert.match(source,/session\?\.state\?\.startsWith\('workshop_'\)/);
  assert.match(source,/\['wsselect','wst','wstest','wshandover'\]/);
  assert.match(source,/handleWorkshopBotCallback/);
});

test('central service preserves Telegram app-user identity',async()=>{
  const source=await read('api/_lib/workshop-service.js');
  assert.match(source,/identity\.appUserId\|\|identity\.user_id\|\|identity\.userId/);
});
