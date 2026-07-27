import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const asset=fs.readFileSync(new URL('../assets/daily-portfolio-declarations.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/027_daily_report_digest_search_path_fix.sql',import.meta.url),'utf8');

test('loads automatic portfolio declarations before daily report source',()=>{
  const declaration=index.indexOf('/assets/daily-portfolio-declarations.js?v=20260724-2');
  const source=index.indexOf('/assets/daily-report-source-of-truth.js?v=20260727-full-finance-1');
  assert.ok(declaration>=0,'portfolio declaration asset must be loaded');
  assert.ok(source>declaration,'portfolio hooks must be installed before daily approval source wraps the modal');
});

test('reuses the existing declaration and exact Telegram print path',()=>{
  assert.ok(asset.includes("/\\bprCli\\s*\\(/"),'must locate the existing prCli print button');
  assert.match(asset,/bhSendPrintedButtonToTelegram/);
  assert.doesNotMatch(asset,/function\s+docCli\s*\(/,'must not duplicate or redesign the declaration document');
});

test('prefers a 10-digit residency employee over Telegram duplicates',()=>{
  assert.ok(asset.includes('/^\\d{10}$/'),'must identify a 10-digit residency number');
  assert.ok(asset.includes('/^TG[-_:]/i'),'must reject Telegram-only employee ids');
  assert.match(asset,/samePerson\(employee,configured\)/);
});

test('treats local duplicate rows as success only after a successful cloud commit',()=>{
  assert.match(asset,/pendingApproval&&isLocalDuplicate\(error\)/);
  assert.match(asset,/كل صفوف الملف مستورده سابقا/);
  assert.match(asset,/تم اعتماد التقرير وإرسال ملفاته إلى Telegram/);
});

test('stores declarations in daily reports and prevents duplicate Telegram sends',()=>{
  assert.match(asset,/dailyPortfolioDeclarations/);
  assert.match(asset,/bh-daily-portfolio-declarations-card/);
  assert.match(asset,/item\.telegramSent/);
  assert.match(asset,/completedApprovals/);
});

test('migration pins both identity functions to extensions.digest',()=>{
  const calls=(migration.match(/extensions\.digest\(/g)||[]).length;
  assert.equal(calls,2);
  assert.match(migration,/set search_path=pg_catalog,public,extensions/g);
});
