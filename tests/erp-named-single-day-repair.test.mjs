import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

const modulePath=new URL('../api/_lib/daily-report-v9.js',import.meta.url);

test('extracts the authoritative date only from an explicitly named daily report',async()=>{
  const { singleDayFilenameDate }=await import(modulePath);
  assert.equal(singleDayFilenameDate('Daily-Report-2026-08-01.xlsx'),'2026-08-01');
  assert.equal(singleDayFilenameDate('Daily-Report-2026-08-01-auto-retry-v3.xlsx'),'2026-08-01');
  assert.equal(singleDayFilenameDate('19-26-20260728.xlsx'),'');
});

test('recognizes the ERP day-month swap found in August daily workbooks',async()=>{
  const { swappedDayMonthDate,shouldRepairNamedSingleDay,namedDailyRowsToRepair }=await import(modulePath);
  assert.equal(swappedDayMonthDate('2026-08-01'),'2026-01-08');
  assert.equal(swappedDayMonthDate('2026-08-02'),'2026-02-08');
  const analysis={
    reportDates:['2026-01-08'],
    sales:[{sheet:'Sheet1',row:2,reportDate:'2026-01-08'}],
    cashMovements:[{sheet:'Sheet1',row:8,movementDate:'2026-01-08',reportDate:'2026-01-08'}]
  };
  assert.equal(shouldRepairNamedSingleDay(analysis,'2026-08-01'),true);
  assert.equal(namedDailyRowsToRepair(analysis,'2026-08-01').length,2);
  assert.equal(shouldRepairNamedSingleDay({...analysis,reportDates:['2026-07-31']},'2026-08-01'),false);
});

test('repairs sales without a date column and swapped bank dates using the sheet date column',async()=>{
  const { repairNamedSingleDayWorkbook }=await import(modulePath);
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
    ['المبيعات','','','','','','','',''],
    [12963,29,12103,'عميل خرسانة','خرسانة 7 كيس',5220,'إجل','',''],
    [18476,40,11508,'مبيعات البلك النقدي','بلك اسود',70,'','',''],
    ['حركه الخزن','','','','','','','',''],
    ['مدين','دائن','اسم الحساب','نوع الحساب','رقم الحساب','البيان','نوع الحركة','رقم الاذن','التاريخ'],
    [70,0,'مبيعات البلك النقدي','عميل',11508,'','إذن إستلام نقدية',510,''],
    [25000,0,'عميل بنك','عميل',13145,'','إشعار مدين - بنك',609,46030]
  ]);
  XLSX.utils.book_append_sheet(workbook,sheet,'Sheet1');
  const analysis={
    reportDates:['2026-01-08'],
    sales:[
      {sheet:'Sheet1',row:2,invoice:'12963',customer:'عميل خرسانة',item:'خرسانة 7 كيس',quantity:29,amount:5220,reportDate:'2026-01-08'},
      {sheet:'Sheet1',row:3,invoice:'18476',customer:'مبيعات البلك النقدي',item:'بلك اسود',quantity:40,amount:70,reportDate:'2026-01-08'}
    ],
    cashMovements:[
      {sheet:'Sheet1',row:6,debit:70,credit:0,movementDate:'2026-01-08',reportDate:'2026-01-08'},
      {sheet:'Sheet1',row:7,debit:25000,credit:0,movementDate:'2026-01-08',reportDate:'2026-01-08'}
    ]
  };
  const repaired=repairNamedSingleDayWorkbook(workbook,analysis,'2026-08-01');
  assert.equal(repaired.salesAssigned,2);
  assert.equal(repaired.cashAssigned,2);
  const output=XLSX.read(repaired.buffer,{type:'buffer',cellDates:true});
  assert.equal(output.Sheets.Sheet1.I2.v,'2026-08-01');
  assert.equal(output.Sheets.Sheet1.I3.v,'2026-08-01');
  assert.equal(output.Sheets.Sheet1.I6.v,'2026-08-01');
  assert.equal(output.Sheets.Sheet1.I7.v,'2026-08-01');
  assert.equal(output.Sheets.Sheet1.A2.v,12963);
  assert.equal(output.Sheets.Sheet1.F2.v,5220);
});

test('still repairs a purely undated named daily file and rejects unrelated explicit dates',async()=>{
  const { shouldRepairNamedSingleDay }=await import(modulePath);
  assert.equal(shouldRepairNamedSingleDay({reportDates:[],sales:[{reportDate:''}],cashMovements:[]},'2026-08-01'),true);
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-07-30'],sales:[{reportDate:''}],cashMovements:[]},'2026-08-01'),false);
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-08-01'],sales:[{reportDate:'2026-08-01'}],cashMovements:[]},'2026-08-01'),false);
});
