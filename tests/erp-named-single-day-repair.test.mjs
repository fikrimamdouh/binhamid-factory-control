import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

const modulePath=new URL('../api/_lib/daily-report-v9.js',import.meta.url);

test('extracts the authoritative date only from an explicitly named daily report',async()=>{
  const { singleDayFilenameDate }=await import(modulePath);
  assert.equal(singleDayFilenameDate('Daily-Report-2026-08-01.xlsx'),'2026-08-01');
  assert.equal(singleDayFilenameDate('Daily-Report-2026-08-01-20260802-080502.xlsx'),'2026-08-01');
  assert.equal(singleDayFilenameDate('19-26-20260728.xlsx'),'');
});

test('repairs a named daily file when either sales or cash rows are undated',async()=>{
  const { shouldRepairNamedSingleDay,undatedNamedDailyRows }=await import(modulePath);
  const salesCase={reportDates:['2026-07-31','2026-08-01'],sales:[{reportDate:''}],cashMovements:[]};
  assert.equal(shouldRepairNamedSingleDay(salesCase,'2026-08-01'),true);
  assert.equal(undatedNamedDailyRows(salesCase)[0]._erpUndatedKind,'sale');
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-07-31','2026-08-01'],cashMovements:[{movementDate:''}]},'2026-08-01'),true);
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-08-01'],cashMovements:[{movementDate:''}]},'2026-08-01'),false);
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-07-31','2026-08-01'],cashMovements:[{movementDate:'2026-08-01'}]},'2026-08-01'),false);
});

test('writes the filename date into an undated sales row using a dated peer column',async()=>{
  const { repairNamedSingleDayWorkbook }=await import(modulePath);
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
    ['رقم الفاتورة','العميل','الصنف','الكمية','المبلغ','التاريخ'],
    ['100','عميل 1','بلوك',10,100,''],
    ['101','عميل 2','بلوك',10,100,'2026-07-31']
  ]);
  XLSX.utils.book_append_sheet(workbook,sheet,'Sales');
  const analysis={
    reportDates:['2026-07-31','2026-08-01'],
    sales:[
      {sheet:'Sales',row:2,invoice:'100',customer:'عميل 1',item:'بلوك',quantity:10,amount:100,reportDate:''},
      {sheet:'Sales',row:3,invoice:'101',customer:'عميل 2',item:'بلوك',quantity:10,amount:100,reportDate:'2026-07-31'}
    ],
    cashMovements:[]
  };
  const repaired=repairNamedSingleDayWorkbook(workbook,analysis,'2026-08-01');
  assert.equal(repaired.salesAssigned,1);
  const output=XLSX.read(repaired.buffer,{type:'buffer',cellDates:true});
  assert.equal(output.Sheets.Sales.F2.v,'2026-08-01');
  assert.equal(output.Sheets.Sales.F3.v,'2026-07-31');
});
