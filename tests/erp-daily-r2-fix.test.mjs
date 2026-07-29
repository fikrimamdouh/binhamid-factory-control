import test from 'node:test';
import assert from 'node:assert/strict';

const implementationPath=['..','api','_lib','daily-report-v6.js'].join('/');

test('single-day ERP assigns the report date to undated cash movements',async()=>{
  const { normalizeSingleDayAnalysis }=await import(new URL(implementationPath,import.meta.url));
  const normalized=normalizeSingleDayAnalysis({
    sales:[],reportDates:[],finishedGoods:[],rawMaterials:[],treasuries:[],
    cashMovements:[
      {row:10,treasuryCode:'101',accountCode:'C1',voucherNo:'590',movementType:'استلام',debit:500,credit:0,isCustomerCollection:true}
    ]
  },'2026-07-28');
  assert.equal(normalized.cashMovements[0].movementDate,'2026-07-28');
  assert.equal(normalized.cashMovements[0].reportDate,'2026-07-28');
});

test('equal customer payments with different voucher numbers are separate movements',async()=>{
  const { buildSnapshotPlan }=await import(new URL(implementationPath,import.meta.url));
  const plan=buildSnapshotPlan([],[],{sales:[],cashMovements:[
    {movementDate:'2026-07-28',treasuryCode:'101',accountCode:'C1',voucherNo:'591',movementType:'استلام',debit:500,credit:0,isCustomerCollection:true},
    {movementDate:'2026-07-28',treasuryCode:'101',accountCode:'C1',voucherNo:'585',movementType:'استلام',debit:500,credit:0,isCustomerCollection:true}
  ]},{currentBatchId:'',legacyBaseline:false});
  assert.equal(plan.conflicts.length,0);
  assert.equal(plan.missingCash.length,2);
});

test('the same customer voucher with a different amount is blocked',async()=>{
  const { buildSnapshotPlan }=await import(new URL(implementationPath,import.meta.url));
  const existing=[
    {id:'c1',batch_id:'b1',movement_date_text:'2026-07-28',treasury_code:'101',account_code:'C1',voucher_no:'591',movement_type:'استلام',debit:500,credit:0,is_customer_collection:true}
  ];
  const plan=buildSnapshotPlan([],existing,{sales:[],cashMovements:[
    {movementDate:'2026-07-28',treasuryCode:'101',accountCode:'C1',voucherNo:'591',movementType:'استلام',debit:700,credit:0,isCustomerCollection:true}
  ]},{currentBatchId:'b1',legacyBaseline:false});
  assert.equal(plan.conflicts.length,1);
  assert.equal(plan.missingCash.length,0);
});
