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

test('workflow runs in the Riyadh morning for the previous day and uses secrets',()=>{
  const workflow=read('.github/workflows/noor-khoy-fuel-sync.yml');
  assert.match(workflow,/id-token:\s*write/);
  assert.match(workflow,/secrets\.NOOR_KHOY_USERNAME/);
  assert.match(workflow,/secrets\.NOOR_KHOY_PASSWORD/);
  assert.match(workflow,/cron:\s*'0 5 \* \* \*'/);
  assert.match(workflow,/FUEL_REPORT_DATE_OFFSET_DAYS:\s*'-1'/);
});

test('browser sync reads the dashboard balance before downloading and uploading Excel',()=>{
  const script=read('scripts/noor-khoy-fuel-sync.mjs');
  assert.match(script,/DASHBOARD_URL/);
  assert.match(script,/extractDieselBalance/);
  assert.match(script,/balanceCandidates/);
  assert.match(script,/x-fuel-account-balance/);
  assert.match(script,/companies\/fuels\?fueltype=all/);
  assert.match(script,/shiftedRiyadhDate/);
  assert.match(script,/setReportDate/);
  assert.match(script,/waitForEvent\('download'/);
  assert.match(script,/parseFuelWorkbook/);
  assert.match(script,/ACTIONS_ID_TOKEN_REQUEST_URL/);
});

test('server stores balance history, reports it, and keeps the private Renault out silently',()=>{
  const route=read('api/_lib/routes/fuel-sync.js'),pdf=read('api/_lib/fuel-report-pdf.js'),router=read('api/router.js'),vercel=read('vercel.json');
  assert.match(route,/token\.actions\.githubusercontent\.com/);
  assert.match(route,/PRIVATE_PLATE_KEY='DGD7293'/);
  assert.match(route,/operationalRows=parsed\.rows\.filter\(row=>!privateFuelRow\(row\)\)/);
  assert.match(route,/requestBalance/);
  assert.match(route,/fuelAccountBalance/);
  assert.match(route,/fuelBalances/);
  assert.match(route,/متبقي في رصيد الديزل/);
  assert.match(route,/accountBalance/);
  assert.match(route,/mergeIntoState\(operationalRows/);
  assert.match(route,/rows:operationalRows/);
  assert.doesNotMatch(route,/تم استبعاد|تم تجاهل|مستبعدة/);
  assert.match(pdf,/متبقي في الرصيد/);
  assert.match(pdf,/category==='diesel'/);
  assert.match(pdf,/options\.accountBalance/);
  assert.match(route,/uploadObject/);
  assert.match(route,/insert\('imports'/);
  assert.match(route,/revision=eq\./);
  assert.match(router,/'fuel\/daily-report':fuelDailyReport/);
  assert.match(vercel,/api\/fuel\/daily-report/);
});