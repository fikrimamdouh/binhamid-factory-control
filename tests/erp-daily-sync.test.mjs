import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entryPath=['..','api','erp','daily-report.js'].join('/');
const implementationPath=['..','api','_lib','daily-report-v6.js'].join('/');
const wrapperPath=['..','api','_lib','daily-report-v7.js'].join('/');
const dateHelpersPath=['..','api','_lib','daily-report-v3.js'].join('/');

test('ERP folder sync routes through the safe v7 repair wrapper and preserved v6 importer',async()=>{
  const [entry,source,wrapper]=await Promise.all([
    readFile(new URL(entryPath,import.meta.url),'utf8'),
    readFile(new URL(implementationPath,import.meta.url),'utf8'),
    readFile(new URL(wrapperPath,import.meta.url),'utf8')
  ]);
  assert.match(entry,/daily-report-v7\.js/);
  assert.match(wrapper,/currentDailyReport/);
  assert.match(wrapper,/planSingleDayRepair/);
  assert.match(source,/X-ERP|x-erp-sync-token/i);
  assert.match(source,/sha256\(buffer\)/);
  assert.match(source,/parseDailyWorkbook/);
  assert.match(source,/commitDailyReportFromTelegram/);
  assert.match(source,/splitAggregatedAnalysis/);
  assert.match(source,/buildSnapshotPlan/);
  assert.match(source,/buildFullSnapshot/);
  assert.match(source,/upgrade_daily_report_details/);
  assert.match(source,/collectionKey/);
  assert.match(source,/currentInvoices/);
  assert.match(source,/historicalInvoices/);
  assert.match(source,/erp-folder\/ranges/);
  assert.match(source,/committedDays:results/);
});

test('ERP folder sync accepts parser evidence when generic classification misses the workbook',async()=>{
  const source=await readFile(new URL(implementationPath,import.meta.url),'utf8');
  assert.match(source,/dailyParserEvidence\(analysis\)/);
  assert.match(source,/if\(evidence\.recognized\)/);
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

test('snapshot reconciliation preserves invoices, corrects legacy payment dates and adds only missing rows',async()=>{
  const { buildFullSnapshot,buildSnapshotPlan }=await import(new URL(implementationPath,import.meta.url));
  const existing={
    sales:[
      {id:'s1',batch_id:'b23',source_row_no:1,invoice_no:'100',customer_code:'C1',customer_name:'عميل 1',sales_type:'block',item_name:'بلوك',quantity:10,amount:100},
      {id:'s-old',batch_id:'b23',source_row_no:2,invoice_no:'099',customer_code:'C0',customer_name:'قديم',sales_type:'block',item_name:'بلوك',quantity:5,amount:50}
    ],
    cash:[
      {id:'c1',batch_id:'b23',source_row_no:3,treasury_code:'101',account_code:'C1',voucher_no:'500',movement_type:'استلام',debit:50,credit:0,movement_date_text:'2026-07-23',is_customer_collection:true},
      {id:'c-old',batch_id:'b23',source_row_no:4,treasury_code:'101',account_code:'C0',voucher_no:'499',movement_type:'استلام',debit:25,credit:0,movement_date_text:'2026-07-23',is_customer_collection:true}
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
  const plan=buildSnapshotPlan(existing.sales,existing.cash,incoming,{currentBatchId:'b23',legacyBaseline:true});
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

test('multi-line invoice matches as one immutable invoice and a changed line blocks the whole number',async()=>{
  const { buildSnapshotPlan }=await import(new URL(implementationPath,import.meta.url));
  const existingSales=[
    {id:'s1',batch_id:'b1',source_row_no:1,invoice_no:'100',customer_code:'C1',sales_type:'block',item_name:'بلوك 20',quantity:10,amount:100},
    {id:'s2',batch_id:'b1',source_row_no:2,invoice_no:'100',customer_code:'C1',sales_type:'block',item_name:'بلوك 15',quantity:5,amount:60}
  ];
  const exact=buildSnapshotPlan(existingSales,[],{sales:[
    {invoice:'100',customerCode:'C1',kind:'بلوك',item:'بلوك 20',quantity:10,amount:100},
    {invoice:'100',customerCode:'C1',kind:'بلوك',item:'بلوك 15',quantity:5,amount:60}
  ],cashMovements:[]},{currentBatchId:'b1'});
  assert.equal(exact.matchedSales.length,1);
  assert.equal(exact.conflicts.length,0);

  const changed=buildSnapshotPlan(existingSales,[],{sales:[
    {invoice:'100',customerCode:'C1',kind:'بلوك',item:'بلوك 20',quantity:10,amount:999},
    {invoice:'100',customerCode:'C1',kind:'بلوك',item:'بلوك 15',quantity:5,amount:60}
  ],cashMovements:[]},{currentBatchId:'b1'});
  assert.equal(changed.conflicts.length,1);
  assert.equal(changed.missingSales.length,0);
});
