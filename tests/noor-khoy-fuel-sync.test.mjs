import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { parseFuelWorkbook } from '../api/_lib/fuel-summary-parser.js';

const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

test('fuel parser classifies diesel and petrol without dropping either',()=>{
  const rows=[['رقم الإيصال','السائق','المحطة','المركبة','رقم اللوحة','المبلغ','نوع الوقود','التاريخ','سعر اللتر','الكمية'],['D-1','سائق 1','نور','شاحنة','1234 أ ب ج',200,'ديزل','2026-07-27',1.66,120.482],['P-1','سائق 2','نور','سيارة','5678 د هـ و',150,'بنزين 95','2026-07-27',2.33,64.378]];
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Fuel');
  const parsed=parseFuelWorkbook(workbook,XLSX);
  assert.equal(parsed.rowCount,2);
  assert.deepEqual(parsed.rows.map(row=>row.category),['diesel','petrol']);
  assert.equal(parsed.categories.diesel,1);
  assert.equal(parsed.categories.petrol,1);
});

test('workflow runs daily and supports an ordered historical range',()=>{
  const workflow=read('.github/workflows/noor-khoy-fuel-sync.yml');
  assert.match(workflow,/id-token:\s*write/);
  assert.match(workflow,/secrets\.NOOR_KHOY_USERNAME/);
  assert.match(workflow,/secrets\.NOOR_KHOY_PASSWORD/);
  assert.match(workflow,/cron:\s*'0 5 \* \* \*'/);
  assert.match(workflow,/start_date:/);
  assert.match(workflow,/end_date:/);
  assert.match(workflow,/while \[\[ "\$current" < "\$end" \|\| "\$current" == "\$end" \]\]/);
  assert.match(workflow,/FUEL_SEND_BALANCE="\$final_day"/);
  assert.match(workflow,/FUEL_NOTIFY="\$final_day"/);
  assert.match(workflow,/fuel-sync-status\/latest\.json/);
  assert.doesNotMatch(workflow,/psql/);
});

test('browser sync locks export to the real fuel report and attaches the current treasury balance only to the latest closed day',()=>{
  const script=read('scripts/noor-khoy-fuel-sync.mjs');
  assert.match(script,/DASHBOARD_URL/);
  assert.match(script,/extractDieselBalance/);
  assert.match(script,/balanceCandidates/);
  assert.match(script,/openReportPage/);
  assert.match(script,/fuelPageHasControls/);
  assert.match(script,/assertFuelReportPage/);
  assert.match(script,/All Funding/);
  assert.match(script,/import\|استيراد\|رفع/);
  assert.match(script,/failure-context\.json/);
  assert.match(script,/latestClosedDate=shiftedRiyadhDate\(-1\)/);
  assert.match(script,/attachBalance=sendBalance&&reportDate===latestClosedDate/);
  assert.match(script,/x-fuel-account-balance/);
  assert.match(script,/x-fuel-balance-date/);
  assert.match(script,/waitForEvent\('download'/);
  assert.match(script,/parseFuelWorkbook/);
});

test('server stores original Excel and every normalized row in the existing imports registry',()=>{
  const route=read('api/_lib/routes/fuel-sync.js'),pdf=read('api/_lib/fuel-report-pdf.js'),router=read('api/router.js'),vercel=read('vercel.json'),http=read('api/_lib/http.js');
  assert.match(route,/PRIVATE_PLATE_KEY='DGD7293'/);
  assert.match(route,/operationalRows=parsed\.rows\.filter\(row=>!privateFuelRow\(row\)\)/);
  assert.match(route,/fuelRows:storedRows\(operationalRows\)/);
  assert.match(route,/storage:\{kind:'imports_registry'/);
  assert.match(route,/storage:'imports_registry'/);
  assert.match(route,/accountBalance/);
  assert.match(route,/balanceDate/);
  assert.match(route,/رصيد خزنة المحطة المتبقي بنهاية يوم/);
  assert.match(route,/FUEL_SYNC_UPSTREAM_FAILED/);
  assert.doesNotMatch(route,/app_state/);
  assert.doesNotMatch(route,/تم استبعاد|تم تجاهل|مستبعدة/);
  assert.match(pdf,/رصيد خزنة المحطة بنهاية اليوم/);
  assert.match(route,/uploadObject/);
  assert.match(route,/insert\('imports'/);
  assert.match(http,/FUEL_SYNC_UPSTREAM_FAILED/);
  assert.match(router,/'fuel\/daily-report':fuelDailyReport/);
  assert.match(vercel,/api\/fuel\/daily-report/);
});
