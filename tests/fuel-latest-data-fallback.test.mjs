import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
test('ambiguous diesel text opens menu before AI',()=>{const reports=read('api/_lib/bot-fuel-reports.js'),webhook=read('api/_lib/telegram-webhook-handler.js');assert.match(reports,/\/ديزل\/\.test\(value\)/);assert.match(webhook,/if\(\/ديزل\/\.test\(normalized\)\)return showFuelMenu/);});
test('daily diesel falls back to latest data and shows upload date',()=>{const analytics=read('api/_lib/fuel-analytics.js'),reports=read('api/_lib/bot-fuel-reports.js');assert.match(analytics,/loadLatestFuelActivity/);assert.match(reports,/لا توجد بيانات مسجلة ليوم/);assert.match(reports,/آخر ملف مرفوع يغطي حتى/);});
