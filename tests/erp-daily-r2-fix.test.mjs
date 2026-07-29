import test from 'node:test';
import assert from 'node:assert/strict';

const implementationPath=['..','api','_lib','daily-report-v7.js'].join('/');

test('single-day ERP assigns the report date to undated cash movements',async()=>{
  const { planSingleDayRepair }=await import(new URL(implementationPath,import.meta.url));
  const plan=planSingleDayRepair({
    sales:[],reportDates:[],finishedGoods:[],rawMaterials:[],treasuries:[],
    cashMovements:[
      {row:10,sheet:'Sheet1',treasuryCode:'101',accountCode:'C1',voucherNo:'590',movementType:'receipt',debit:500,credit:0,isCustomerCollection:true}
    ]
  },'2026-07-28');
  assert.equal(plan.analysis.cashMovements[0].movementDate,'2026-07-28');
  assert.equal(plan.analysis.cashMovements[0].reportDate,'2026-07-28');
  assert.equal(plan.undatedRows.length,1);
});

test('equal customer payments with different vouchers are separated safely',async()=>{
  const { planSingleDayRepair }=await import(new URL(implementationPath,import.meta.url));
  const plan=planSingleDayRepair({sales:[],reportDates:['2026-07-28'],finishedGoods:[],rawMaterials:[],treasuries:[],cashMovements:[
    {row:10,sheet:'Sheet1',movementDate:'2026-07-28',treasuryCode:'101',accountCode:'C1',voucherNo:'591',movementType:'receipt',debit:500,credit:0,isCustomerCollection:true},
    {row:11,sheet:'Sheet1',movementDate:'2026-07-28',treasuryCode:'101',accountCode:'C1',voucherNo:'585',movementType:'receipt',debit:500,credit:0,isCustomerCollection:true}
  ]},'2026-07-28');
  assert.equal(plan.conflicts.length,0);
  assert.equal(plan.appendRows.length,1);
  assert.equal(plan.removeRows.length,1);
  assert.equal(plan.analysis.cashMovements.length,2);
});

test('the same customer voucher with a different amount is blocked',async()=>{
  const { planSingleDayRepair }=await import(new URL(implementationPath,import.meta.url));
  const plan=planSingleDayRepair({sales:[],reportDates:['2026-07-28'],finishedGoods:[],rawMaterials:[],treasuries:[],cashMovements:[
    {row:10,sheet:'Sheet1',movementDate:'2026-07-28',treasuryCode:'101',accountCode:'C1',voucherNo:'591',movementType:'receipt',debit:500,credit:0,isCustomerCollection:true},
    {row:11,sheet:'Sheet1',movementDate:'2026-07-28',treasuryCode:'101',accountCode:'C1',voucherNo:'591',movementType:'receipt',debit:700,credit:0,isCustomerCollection:true}
  ]},'2026-07-28');
  assert.equal(plan.conflicts.length,1);
  assert.equal(plan.appendRows.length,0);
});
