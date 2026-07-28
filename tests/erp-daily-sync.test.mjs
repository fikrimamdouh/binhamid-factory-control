import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entryPath=['..','api','erp','daily-report.js'].join('/');
const implementationPath=['..','api','erp','daily-report-v4.js'].join('/');
const dateHelpersPath=['..','api','erp','daily-report-v3.js'].join('/');

test('ERP folder sync routes through the snapshot-safe authenticated importer',async()=>{
  const [entry,source]=await Promise.all([
    readFile(new URL(entryPath,import.meta.url),'utf8'),
    readFile(new URL(implementationPath,import.meta.url),'utf8')
  ]);
  assert.match(entry,/daily-report-v4\.js/);
  assert.match(source,/X-ERP|x-erp-sync-token/i);
  assert.match(source,/sha256\(buffer\)/);
  assert.match(source,/parseDailyWorkbook/);
  assert.match(source,/commitDailyReportFromTelegram/);
  assert.match(source,/splitAggregatedAnalysis/);
  assert.match(source,/buildSnapshotPlan/);
  assert.match(source,/buildFullSnapshot/);
  assert.match(source,/upgrade_daily_report_details/);
  assert.match(source,/erp-folder\/ranges/);
  assert.match(source,/committedDays:results/);
  assert.match(source,/status:'posted',posted_batch_id:/);
});

test('ERP folder sync accepts parser evidence when generic classification misses the workbook',async()=>{
  const source=await readFile(new URL(implementationPath,import.meta.url),'utf8');
  assert.match(source,/dailyParserEvidence\(analysis\)/);
  assert.match(source,/if\(evidence\.recognized\)return\{reportType:/);
  assert.match(source,/classification=resolveDailyReportType/);
});

test('aggregate ERP maps 19-23 to the approved 23 July baseline and keeps later days separate',async()=>{
  const { postingDateForTransaction,splitAggregatedAnalysis }=await import(new URL(dateHelpersPath,import.meta.url));
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

test('snapshot reconciliation consumes exact rows, preserves old rows, corrects dates and adds only missing rows',async()=>{
  const { buildFullSnapshot,buildSnapshotPlan }=await import(new URL(implementationPath,import.meta.url));
  const existing={
    sales:[
      {id:'s1',source_row_no:1,invoice_no:'100',customer_code:'C1',customer_name:'عميل 1',sales_type:'block',item_name:'بلوك',quantity:10,amount:100},
      {id:'s-old',source_row_no:2,invoice_no:'099',customer_code:'C0',customer_name:'قديم',sales_type:'block',item_name:'بلوك',quantity:5,amount:50}
    ],
    cash:[
      {id:'c1',source_row_no:3,treasury_code:'101',account_code:'C1',voucher_no:'500',movement_type:'استلام',debit:50,credit:0,movement_date_text:'2026-07-23',is_customer_collection:true},
      {id:'c-old',source_row_no:4,treasury_code:'101',account_code:'C0',voucher_no:'499',movement_type:'استلام',debit:25,credit:0,movement_date_text:'2026-07-23',is_customer_collection:true}
    ],
    inventory:[],treasuries:[]
  };
  const incoming={
    reportDates:['2026-07-23'],
    sales:[
      {invoice:'100',customerCode:'C1',customer:'عميل 1',item:'بلوك',kind:'بلوك',quantity:10,amount:100},
      {invoice:'101',customerCode:'C2',customer:'عميل 2',item:'خرسانة',kind:'خرسانة',quantity:2,amount:200}
    ],
    cashMovements:[
      {treasuryCode:'101',accountCode:'C1',accountName:'عميل 1',voucherNo:'500',movementType:'استلام',debit:50,credit:0,movementDate:'2026-07-20',isCustomerCollection:true},
      {treasuryCode:'105',accountCode:'C2',accountName:'عميل 2',voucherNo:'501',movementType:'بنك',debit:75,credit:0,movementDate:'2026-07-24',isCustomerCollection:true}
    ],
    finishedGoods:[],rawMaterials:[],treasuries:[]
  };
  const plan=buildSnapshotPlan(existing.sales,existing.cash,incoming);
  assert.equal(plan.matchedSales.length,1);
  assert.equal(plan.missingSales.length,1);
  assert.equal(plan.matchedCash.length,1);
  assert.equal(plan.missingCash.length,1);
  assert.equal(plan.datesCorrected,1);
  assert.equal(plan.conflicts.length,0);
  const full=buildFullSnapshot(existing,plan,incoming);
  assert.equal(full.sales.length,3);
  assert.equal(full.cashMovements.length,3);
  assert.equal(full.cashMovements.find(row=>row.voucherNo==='500').movementDate,'2026-07-20');
  assert.ok(full.cashMovements.some(row=>row.voucherNo==='499'));
  assert.ok(full.cashMovements.some(row=>row.voucherNo==='501'));
});

test('snapshot reconciliation blocks value conflicts, duplicate incoming numbers and multi-line invoice loss',async()=>{
  const { buildSnapshotPlan }=await import(new URL(implementationPath,import.meta.url));
  const existingSales=[
    {id:'s1',source_row_no:1,invoice_no:'100',customer_code:'C1',sales_type:'block',item_name:'بلوك 20',quantity:10,amount:100},
    {id:'s2',source_row_no:2,invoice_no:'100',customer_code:'C1',sales_type:'block',item_name:'بلوك 15',quantity:5,amount:60}
  ];
  const plan=buildSnapshotPlan(existingSales,[],{sales:[
    {invoice:'100',customerCode:'C1',kind:'بلوك',item:'بلوك 20',quantity:10,amount:100},
    {invoice:'100',customerCode:'C1',kind:'بلوك',item:'بلوك 15',quantity:5,amount:60}
  ],cashMovements:[]});
  assert.equal(plan.matchedSales.length,2);
  assert.equal(plan.conflicts.length,0);

  const valueConflict=buildSnapshotPlan(existingSales,[],{sales:[{invoice:'100',customerCode:'C1',kind:'بلوك',item:'بلوك 20',quantity:10,amount:999}],cashMovements:[]});
  assert.equal(valueConflict.conflicts.length,1);
  assert.equal(valueConflict.missingSales.length,0);

  const duplicateIncoming=buildSnapshotPlan([],[],{sales:[
    {invoice:'200',customerCode:'C2',kind:'بلوك',item:'بلوك 20',quantity:1,amount:10},
    {invoice:'200',customerCode:'C2',kind:'بلوك',item:'بلوك 20',quantity:1,amount:10}
  ],cashMovements:[]});
  assert.equal(duplicateIncoming.conflicts.length,1);
});
