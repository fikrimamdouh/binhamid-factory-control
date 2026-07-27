import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { parseDailyWorkbook } from '../api/_lib/daily-summary-parser.js';

const { historicalSalesCompatibility,payloadFromAnalysis,resolveReportDate }=await import(['..','api','erp','daily-report.js'].join('/'));

const rows=[
  ['المبيعات'],
  [18448,40,11508,'مبيعات البلك النقدي فقط لاغير','بلك اسود مقاس 20*20*40 سم','تحويل',70],
  [18447,250,13200,'حلمي 0545150504','بلك اسود مقاس 20*20*40 سم',450],
  [18449,350,12164,'مؤسسة كيان اعمالي للمقاولات العامه','بلك اسود مقاس 15*20*40 سم','','',595],
  ['منتجات تامه'],
  ['كود الصنف','الصنف','الوحده','الرصيد الأفتتاحي','وارد','منصرف','رصيد'],
  [10020006,'بلك اسود مقاس 20*20*40 سم','بلوكه',1353,6500,1090,6763],
  ['خامات'],
  ['كود الصنف','الصنف','الوحدة','الرصيد الافتتاحي','وارد','منصرف','رصيد الصنف'],
  [10010001,'اسمنت سايب','طن ton',8352.52235,27.05,0,8379.57235],
  ['حركه الخزن'],
  ['', '', 'الخزينة',101,'الخزينة النقدية'],
  [439,'اول المدة'],
  ['مدين','دائن','اسم الحساب','نوع الحساب','رقم الحساب','البيان','نوع الحركة','رقم الاذن','التاريخ'],
  [5500,0,'مؤسسة ورقتين ونص','عميل',13184,'','إذن إستلام نقدية',497,''],
  [0,9400,'البنك الأهلى 607','بنك',105,'','إذن صرف نقدية',525,46228],
  [6450,0,'مؤسسة برج الراية','عميل',11533,'','إشعار مدين - بنك',573,46228],
  [11950,9400,'المجموع'],
  [2974,'','','الرصيد النهائي'],
  ['', '', 'الخزينة',104,'خزينة نقاط البيع'],
  [54028.25,'اول المدة'],
  ['مدين','دائن','اسم الحساب','نوع الحساب','رقم الحساب','البيان','نوع الحركة','رقم الاذن','التاريخ'],
  [70,0,'مبيعات البلك النقدي فقط لاغير','عميل',11508,'','إذن إستلام نقدية',265,''],
  [70,0,'المجموع'],
  [54098.25,'','','الرصيد النهائي']
];

function workbook(){
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'ورقة1');
  return book;
}

async function browserParser(){
  const source=await readFile(new URL('../assets/daily-summary-parser.js',import.meta.url),'utf8');
  const sandbox={console};sandbox.globalThis=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'daily-summary-parser.js'});
  return sandbox.BinHamidDailySummaryParser;
}

test('server parser reads shifted sales amounts and every treasury/bank movement',()=>{
  const parsed=parseDailyWorkbook(workbook(),XLSX);
  assert.equal(parsed.sales.length,3);
  assert.deepEqual(parsed.sales.map(row=>row.amount),[70,450,595]);
  assert.equal(parsed.sales[0].paymentTerms,'تحويل');
  assert.deepEqual(parsed.reportDates,['2026-07-25']);
  assert.equal(parsed.cashMovements.length,4);
  assert.equal(parsed.collections.length,3);
  assert.equal(parsed.collections.reduce((sum,row)=>sum+row.debit,0),12020);
  const bankCollection=parsed.cashMovements.find(row=>row.voucherNo==='573');
  assert.equal(bankCollection.treasuryCode,'105');
  assert.equal(bankCollection.paymentMethod,'bank');
  assert.equal(bankCollection.isCustomerCollection,true);
  assert.equal(bankCollection.movementDate,'2026-07-25');
  assert.deepEqual(parsed.treasuries.map(row=>[row.treasuryCode,row.opening,row.closing]),[
    ['101',439,2974],
    ['104',54028.25,54098.25]
  ]);
});

test('browser parser stays aligned with the server parser',async()=>{
  const parser=await browserParser(),parsed=parser.parseWorkbook(workbook(),XLSX);
  assert.equal(parsed.sales.length,3);
  assert.deepEqual(Array.from(parsed.reportDates),['2026-07-25']);
  assert.equal(parsed.cashMovements.length,4);
  assert.equal(parsed.collections.length,3);
  assert.equal(parsed.cashMovements.find(row=>row.voucherNo==='573').treasuryCode,'105');
  assert.equal(parsed.treasuries.length,2);
});

test('ERP route selects the latest movement date and posts full financial detail',()=>{
  const analysis=parseDailyWorkbook(workbook(),XLSX);
  const reportDate=resolveReportDate({headers:{}},workbook(),'تقرير الحركة.xlsx',analysis);
  assert.equal(reportDate,'2026-07-25');
  const payload=payloadFromAnalysis(analysis,reportDate);
  assert.equal(payload.sales.length,3);
  assert.equal(payload.sales[0].paymentTerms,'تحويل');
  assert.equal(payload.cashMovements.length,4);
  assert.equal(payload.cashMovements.find(row=>row.voucherNo==='573').treasuryCode,'105');
  assert.equal(payload.cashMovements.find(row=>row.voucherNo==='573').isCustomerCollection,true);
  assert.equal(payload.treasuries.length,2);
  assert.equal(payload.summary.parserVersion,'daily-report-v2');
});

test('historical upgrade accepts a revised file only when its original invoices and customers still match',()=>{
  const existing=[
    {invoice_no:'18448',customer_code:'11508',sales_type:'block',amount:70},
    {invoice_no:'18447',customer_code:'13200',sales_type:'block',amount:450}
  ];
  const incoming=[
    {invoice:'18448',customerCode:'11508',kind:'بلك',amount:70},
    {invoice:'18447',customerCode:'13200',kind:'بلوك',amount:450},
    {invoice:'18450',customerCode:'13201',kind:'block',amount:1440}
  ];
  assert.deepEqual(historicalSalesCompatibility(existing,incoming),{
    compatible:true,existingCount:2,incomingCount:3,missing:[]
  });
  assert.equal(historicalSalesCompatibility(existing,[incoming[0],{...incoming[1],customerCode:'WRONG'}]).compatible,false);
});

test('migration 029 upgrades the exact approved file and supports bank collections',async()=>{
  const [sql,workflow,preflight,verify]=await Promise.all([
    readFile(new URL('../supabase/migrations/029_daily_report_v2_upgrade.sql',import.meta.url),'utf8'),
    readFile(new URL('../.github/workflows/apply-daily-report-v2-migration.yml',import.meta.url),'utf8'),
    readFile(new URL('../scripts/daily-report-v2-migration-preflight.mjs',import.meta.url),'utf8'),
    readFile(new URL('../scripts/daily-report-v2-migration-verify.mjs',import.meta.url),'utf8')
  ]);
  assert.match(sql,/upgrade_daily_report_details/);
  assert.match(sql,/file_hash is distinct from p_file_hash/);
  assert.match(sql,/on conflict\(batch_id,source_row_no\) do update/);
  assert.match(sql,/\('101','104','105'\)/);
  assert.match(sql,/'110205','البنك الأهلي 105'/);
  assert.match(sql,/when v_cash\.treasury_code='105' then '110205'/);
  assert.match(sql,/public\.post_daily_report_accounting\(v_batch\.id,p_actor\)/);
  assert.match(workflow,/Create and verify encrypted pre-migration backup/);
  assert.match(workflow,/Restore production backup to isolated PostgreSQL 17/);
  assert.match(workflow,/--single-transaction --file supabase\/migrations\/029_daily_report_v2_upgrade\.sql/);
  assert.match(workflow,/EXPECTED_SCHEMA_VERSION=29/);
  assert.match(preflight,/currentVersion<28\|\|currentVersion>targetVersion/);
  assert.match(preflight,/BACKUP_GATE_FAILED/);
  assert.match(verify,/PROTECTED_ROW_COUNT_CHANGED/);
  assert.match(verify,/SCHEMA_29_DAILY_REPORT_V2_VERIFIED/);
});
