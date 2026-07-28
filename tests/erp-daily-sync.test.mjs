import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entryPath=['..','api','erp','daily-report.js'].join('/');
const implementationPath=['..','api','erp','daily-report-v3.js'].join('/');

test('ERP folder sync routes through the aggregate-safe authenticated importer',async()=>{
  const [entry,source]=await Promise.all([
    readFile(new URL(entryPath,import.meta.url),'utf8'),
    readFile(new URL(implementationPath,import.meta.url),'utf8')
  ]);
  assert.match(entry,/daily-report-v3\.js/);
  assert.match(source,/X-ERP|x-erp-sync-token/i);
  assert.match(source,/sha256\(buffer\)/);
  assert.match(source,/parseDailyWorkbook/);
  assert.match(source,/commitDailyReportFromTelegram/);
  assert.match(source,/splitAggregatedAnalysis/);
  assert.match(source,/buildReconciliationPlan/);
  assert.match(source,/LEGACY_BASELINE_START='2026-07-19'/);
  assert.match(source,/LEGACY_BASELINE_END='2026-07-23'/);
  assert.match(source,/erp-folder-aggregate/);
  assert.match(source,/rebuild_customer_fifo/);
  assert.match(source,/status:'posted',posted_batch_id:/);
  assert.match(source,/posting\?\.reason/);
});

test('ERP folder sync accepts a workbook when the dedicated parser found daily sections even if generic classification missed it',async()=>{
  const source=await readFile(new URL(implementationPath,import.meta.url),'utf8');
  assert.match(source,/export function dailyParserEvidence/);
  assert.match(source,/Object\.values\(counts\)\.some\(value=>value>0\)/);
  assert.match(source,/if\(evidence\.recognized\)return\{reportType:/);
  assert.match(source,/classification=resolveDailyReportType/);
  assert.match(source,/source:\{kind:'erp-folder'.*classification/s);
});

test('aggregate ERP maps 19-23 to the approved 23 July baseline and keeps later days separate',async()=>{
  const { postingDateForTransaction,splitAggregatedAnalysis }=await import(new URL(implementationPath,import.meta.url));
  assert.equal(postingDateForTransaction('2026-07-19'),'2026-07-23');
  assert.equal(postingDateForTransaction('2026-07-23'),'2026-07-23');
  assert.equal(postingDateForTransaction('2026-07-24'),'2026-07-24');
  const result=splitAggregatedAnalysis({
    reportDates:['2026-07-19','2026-07-20','2026-07-23','2026-07-24','2026-07-25'],
    sales:[
      {row:11,reportDate:'2026-07-19',invoice:'100',customerCode:'C1',customer:'عميل 1',item:'بلوك',kind:'بلوك',quantity:10,amount:100},
      {row:12,reportDate:'2026-07-24',invoice:'101',customerCode:'C2',customer:'عميل 2',item:'خرسانة',kind:'خرسانة',quantity:2,amount:200}
    ],
    cashMovements:[
      {row:20,movementDate:'2026-07-20',treasuryCode:'101',accountCode:'C1',voucherNo:'500',movementType:'استلام',debit:50,credit:0,isCustomerCollection:true},
      {row:21,movementDate:'2026-07-25',treasuryCode:'105',accountCode:'C2',voucherNo:'501',movementType:'بنك',debit:75,credit:0,isCustomerCollection:true}
    ],
    treasuries:[],finishedGoods:[],rawMaterials:[],contentText:''
  });
  assert.deepEqual(result.groups.map(row=>row.reportDate),['2026-07-23','2026-07-24','2026-07-25']);
  assert.deepEqual(result.groups[0].analysis.sourceDates,['2026-07-19','2026-07-20']);
  assert.equal(result.groups[0].analysis.sales.length,1);
  assert.equal(result.groups[0].analysis.cashMovements.length,1);
  assert.equal(result.undated.length,0);
});

test('transaction reconciliation ignores exact old rows, corrects their dates, adds only missing rows and blocks value conflicts',async()=>{
  const { buildReconciliationPlan }=await import(new URL(implementationPath,import.meta.url));
  const existingSales=[{id:'s1',batch_id:'b23',source_row_no:1,invoice_no:'100',customer_code:'C1',sales_type:'block',quantity:10,amount:100}];
  const existingCash=[{id:'c1',batch_id:'b23',source_row_no:2,treasury_code:'101',account_code:'C1',voucher_no:'500',movement_type:'استلام',debit:50,credit:0,movement_date_text:'2026-07-23',is_customer_collection:true}];
  const incoming={
    sales:[
      {invoice:'100',customerCode:'C1',kind:'بلوك',quantity:10,amount:100},
      {invoice:'101',customerCode:'C2',kind:'خرسانة',quantity:2,amount:200}
    ],
    cashMovements:[
      {treasuryCode:'101',accountCode:'C1',voucherNo:'500',movementType:'استلام',debit:50,credit:0,movementDate:'2026-07-20',isCustomerCollection:true},
      {treasuryCode:'105',accountCode:'C2',voucherNo:'501',movementType:'بنك',debit:75,credit:0,movementDate:'2026-07-24',isCustomerCollection:true}
    ]
  };
  const plan=buildReconciliationPlan(existingSales,existingCash,incoming,'b23');
  assert.equal(plan.matchedSales.length,1);
  assert.equal(plan.missingSales.length,1);
  assert.equal(plan.matchedCash.length,1);
  assert.equal(plan.missingCash.length,1);
  assert.deepEqual(plan.cashDateCorrections.map(row=>row.actualDate),['2026-07-20']);
  assert.equal(plan.conflicts.length,0);

  const conflict=buildReconciliationPlan(existingSales,existingCash,{sales:[{invoice:'100',customerCode:'C1',kind:'بلوك',quantity:10,amount:999}],cashMovements:[]},'b23');
  assert.equal(conflict.conflicts.length,1);
  assert.equal(conflict.missingSales.length,0);
});
