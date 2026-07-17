import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=parts=>fs.readFileSync(new URL(parts.join('/'),import.meta.url),'utf8');

test('Telegram Excel uploads acknowledge receipt and report processing failures',()=>{
  const source=read(['..','api','_lib','bot-files.js']);
  assert.match(source,/تم استلام ملف/);
  assert.match(source,/telegram excel import/);
  assert.match(source,/لم تُرحّل أي بيانات من هذا الملف/);
  assert.match(source,/if\(stored\?\.id&&imp\?\.id\)/);
});

test('unknown duplicate Excel files are re-read and updated instead of staying unclassified',()=>{
  const source=read(['..','api','_lib','bot-files.js']);
  assert.match(source,/duplicate\.report_type==='unknown_excel'/);
  assert.match(source,/تمت إعادة فحص الملف القديم وتحديث تصنيفه بنجاح/);
  assert.match(source,/await patch\('imports'/);
});

test('approved website reports call the protected Telegram owner notification route',()=>{
  const source=read(['..','assets','daily-report-source-of-truth.js']);
  assert.match(source,/\/api\/telegram\/notify/);
  assert.match(source,/daily_report_approved/);
  assert.match(source,/telegramNotified/);
});

test('single-function router exposes Telegram notifications without adding a function',()=>{
  const router=read(['..','api','router.js']),admin=read(['..','api','_lib','routes','telegram-admin.js']),vercel=JSON.parse(read(['..','vercel.json']));
  assert.match(router,/'telegram\/notify':telegramAdmin\.notify/);
  assert.match(admin,/export async function notify/);
  assert.match(admin,/config\.telegramOwnerId/);
  assert.ok(vercel.rewrites.some(row=>row.source==='/api/telegram/notify'&&row.destination==='/api/router?route=telegram/notify'));
});
