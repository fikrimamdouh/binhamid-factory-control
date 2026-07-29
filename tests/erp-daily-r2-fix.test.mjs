import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseDailyWorkbook } from '../api/_lib/daily-summary-parser.js';

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

test('blank worksheet rows do not shift the physical row used for the single-day date repair',async()=>{
  const { anchorBlankRows,planSingleDayRepair,repairSingleDayWorkbook }=await import(new URL(implementationPath,import.meta.url));
  const source=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(source,XLSX.utils.aoa_to_sheet([
    ['تقرير يوم 2026-07-28'],
    [],
    [],
    ['مدين','دائن','اسم الحساب','نوع الحساب','رقم الحساب','التاريخ','نوع الحركة','رقم الإذن'],
    [500,0,'عميل 1','عميل','C1','','إذن استلام','590']
  ]),'Sheet1');
  const buffer=XLSX.write(source,{type:'buffer',bookType:'xlsx'});
  const workbook=XLSX.read(buffer,{type:'buffer',cellDates:true});
  const coordinateWorkbook=anchorBlankRows(XLSX.read(buffer,{type:'buffer',cellDates:true}));
  const analysis=parseDailyWorkbook(coordinateWorkbook,XLSX);
  assert.equal(analysis.cashMovements.length,1);
  assert.equal(analysis.cashMovements[0].row,5);
  const plan=planSingleDayRepair(analysis,'2026-07-28');
  const repaired=XLSX.read(repairSingleDayWorkbook(workbook,plan,'2026-07-28'),{type:'buffer'});
  assert.equal(repaired.Sheets.Sheet1.F5.v,'2026-07-28');
  assert.equal(repaired.Sheets.Sheet1.F2,undefined);
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
