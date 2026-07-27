import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseFuelWorkbook } from '../api/_lib/fuel-summary-parser.js';

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

test('fuel parser classifies diesel and petrol without dropping either',()=>{
  const rows=[['رقم الإيصال','السائق','المحطة','المركبة','رقم اللوحة','المبلغ','نوع الوقود','التاريخ','سعر اللتر','الكمية'],['D-1','سائق 1','نور','شاحنة','1234 أ ب ج',200,'ديزل','2026-07-27',1.66,120.482],['P-1','سائق 2','نور','سيارة','5678 د هـ و',150,'بنزين 95','2026-07-27',2.33,64.378]];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Fuel');
  const parsed=parseFuelWorkbook(workbook,XLSX);
  assert.equal(parsed.rowCount,2);
  assert.deepEqual(parsed.rows.map(row=>row.category),['diesel','petrol']);
});

test('workflow runs daily and imports a selected period in one workbook',()=>{
  const workflow=read('.github/workflows/noor-khoy-fuel-sync.yml');
  assert.match(workflow,/id-token:\s*write/);
  assert.match(workflow,/secrets\.NOOR_KHOY_USERNAME/);
  assert.match(workflow,/secrets\.NOOR_KHOY_PASSWORD/);
  assert.match(workflow,/cron:\s*'0 5 \* \* \*'/);
  assert.match(workflow,/REPORT_START_DATE:/);
  assert.match(workflow,/REPORT_END_DATE:/);
  assert.match(workflow,/cancel-in-progress:\s*true/);
  assert.match(workflow,/node scripts\/noor-khoy-fuel-sync\.mjs/);
  assert.doesNotMatch(workflow,/while \[\[/);
  assert.match(workflow,/fuel-sync-status\/latest\.json/);
});

test('browser export sends dates in the export URL and rejects out-of-period rows',()=>{
  const script=read('scripts/noor-khoy-fuel-sync.mjs');
  assert.match(script,/reportUrl\(fromDate,toDate,true\)/);
  assert.match(script,/searchParams\.set\('start',fromDate\)/);
  assert.match(script,/searchParams\.set\('end',toDate\)/);
  assert.match(script,/validateDownloadedPeriod/);
  assert.match(script,/rows are outside/);
  assert.match(script,/x-fuel-period-start/);
  assert.match(script,/x-fuel-period-end/);
  assert.match(script,/attachBalance=sendBalance&&toDate===latestClosedDate/);
  assert.match(script,/waitForEvent\('download'/);
});

test('server sends each fuel report to the owner and approved factory manager',()=>{
  const route=read('api/_lib/routes/fuel-sync.js');
  assert.match(route,/FACTORY_MANAGER_CHAT_ID='6870312376'/);
  assert.match(route,/telegramRecipients\(\)/);
  assert.match(route,/new Set\(\[config\.telegramOwnerId,FACTORY_MANAGER_CHAT_ID\]/);
  assert.match(route,/recipients\.map\(chatId=>sendMessage\(chatId,message\)\)/);
  assert.match(route,/for\(const chatId of recipients\)/);
  assert.match(route,/recipients:recipients\.length/);
});

test('server stores one report per period and keeps the private vehicle out silently',()=>{
  const route=read('api/_lib/routes/fuel-sync.js');
  const pdf=read('api/_lib/fuel-report-pdf.js');
  const router=read('api/router.js');
  const vercel=read('vercel.json');
  const http=read('api/_lib/http.js');
  assert.match(route,/PRIVATE_PLATE_KEY='DGD7293'/);
  assert.match(route,/operationalRows=parsed\.rows\.filter\(row=>!privateFuelRow\(row\)\)/);
  assert.match(route,/fuelRows:storedRows\(operationalRows\)/);
  assert.match(route,/summary->period->>start/);
  assert.match(route,/cleanupInvalidJulyImports/);
  assert.match(route,/storage:'imports_registry'/);
  assert.match(route,/رصيد خزنة المحطة المتبقي بنهاية يوم/);
  assert.doesNotMatch(route,/app_state/);
  assert.doesNotMatch(route,/تم استبعاد|تم تجاهل|مستبعدة/);
  assert.match(pdf,/رصيد خزنة المحطة بنهاية اليوم/);
  assert.match(route,/uploadObject/);
  assert.match(route,/insert\('imports'/);
  assert.match(http,/FUEL_SYNC_UPSTREAM_FAILED/);
  assert.match(router,/'fuel\/daily-report':fuelDailyReport/);
  assert.match(vercel,/api\/fuel\/daily-report/);
});

test('the existing fuel sync sends verified vehicle balances at 7 PM Riyadh',()=>{
  const workflow=read('.github/workflows/noor-khoy-fuel-sync.yml');
  const script=read('scripts/noor-khoy-fuel-sync.mjs');
  const route=read('api/_lib/routes/fuel-sync.js');
  assert.match(workflow,/cron:\s*'0 16 \* \* \*'/);
  assert.match(workflow,/FUEL_SYNC_MODE: vehicle-balance-report/);
  assert.match(workflow,/NOOR_KHOY_VEHICLES_URL/);
  assert.match(script,/vehicleBalanceSummary/);
  assert.match(script,/allVehiclePageSnapshots/);
  assert.match(script,/pageLinks/);
  assert.match(script,/لم يتم العثور على رصيد ديزل غير مستخدم موجب في صفحات المركبات/);
  assert.match(script,/candidates\.flatMap/);
  assert.match(script,/x-fuel-operation':'vehicle-balance-report/);
  assert.match(route,/x-fuel-operation/);
  assert.match(route,/رصيد الديزل المتوفر في المركبات/);
  assert.match(route,/vehicle_diesel_balance_report_sent/);
  assert.match(route,/latestVehicleBalanceReport/);
  assert.match(route,/تصحيح رصيد الديزل المتوفر في المركبات/);
});

test('diesel reports show the latest verified unused vehicle balance separately from consumption',()=>{
  const analytics=read('api/_lib/fuel-analytics.js');
  const reports=read('api/_lib/bot-fuel-reports.js');
  assert.match(analytics,/loadLatestVehicleDieselBalance/);
  assert.match(analytics,/vehicle_diesel_balance_report_sent/);
  assert.match(reports,/رصيد الديزل غير المستخدم بالمركبات/);
  assert.match(reports,/loadLatestVehicleDieselBalance/);
  assert.match(reports,/category==='petrol'\?Promise\.resolve\(null\)/);
});
