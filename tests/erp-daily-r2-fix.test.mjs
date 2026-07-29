import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

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

test('repaired date is written to the detected date column, not fixed column I',async()=>{
  const { planSingleDayRepair,repairSingleDayWorkbook }=await import(new URL(implementationPath,import.meta.url));
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
    ['مدين','دائن','اسم الحساب','نوع الحساب','رقم الحساب','التاريخ','نوع الحركة','رقم الإذن'],
    [500,0,'عميل 1','عميل','C1','', 'receipt','590']
  ]);
  XLSX.utils.book_append_sheet(workbook,sheet,'Sheet1');
  const plan=planSingleDayRepair({sales:[],reportDates:[],finishedGoods:[],rawMaterials:[],treasuries:[],cashMovements:[
    {row:2,sheet:'Sheet1',treasuryCode:'101',accountCode:'C1',voucherNo:'590',movementType:'receipt',debit:500,credit:0,isCustomerCollection:true}
  ]},'2026-07-28');
  const repaired=XLSX.read(repairSingleDayWorkbook(workbook,plan,'2026-07-28'),{type:'buffer'});
  assert.equal(repaired.Sheets.Sheet1.F2.v,'2026-07-28');
  assert.equal(repaired.Sheets.Sheet1.I2,undefined);
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
