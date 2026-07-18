import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as XLSX from 'xlsx';

const source=fs.readFileSync(new URL('../assets/daily-summary-parser.js',import.meta.url),'utf8');
function parser(){const context={XLSX,console};context.globalThis=context;vm.runInNewContext(source,context);return context.BinHamidDailySummaryParser;}

function workbookFrom(rowsBySheet){const workbook=XLSX.utils.book_new();for(const [name,rows] of Object.entries(rowsBySheet))XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),name);return workbook;}

test('reads shifted sales columns, repeated headers, formulas and Arabic numbers',()=>{
  const rows=[
    ['ملخص العمل اليومي'],['المبيعات'],['ملاحظة قبل الجدول'],
    ['اسم العميل','قيمة المبيعات','الصنف','كود العميل','الكمية','رقم الفاتورة','طريقة السداد'],
    ['حسين المحامض',1260,'بلك اسود','13176','٧٠٠','18354','آجل'],
    ['اسم العميل','قيمة المبيعات','الصنف','كود العميل','الكمية','رقم الفاتورة','طريقة السداد'],
    ['عميل خرسانة','٢٠٬١٧٥','خرسانة جاهزة','20001','١١٠٫٥','19001','آجل'],
    ['حركة الخزن'],['','', 'الخزينة',101,'النقدية'],
    ['نوع الحركة','اسم الحساب','نوع الحساب','رقم الحساب','مدين','دائن','رقم الإذن','التاريخ','البيان'],
    ['استلام نقدية','صالح سالم','عميل','13183','٣٬٨٢٥',0,'429',45500,'تحصيل عميل']
  ];
  const workbook=workbookFrom({اليومي:rows,فارغ:[]}),result=parser().parseWorkbook(workbook,XLSX);
  assert.equal(result.sales.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.sales.map(row=>[row.invoice,row.customerCode,row.kind,row.quantity,row.amount]))),[['18354','13176','بلك',700,1260],['19001','20001','خرسانة',110.5,20175]]);
  assert.equal(result.collections.length,1);
  assert.equal(result.collections[0].treasuryCode,'101');
  assert.equal(result.collections[0].method,'نقدي');
  assert.equal(result.collections[0].date,'2024-07-27');
});

test('keeps the current invoice-quantity-code-customer-item-amount order compatible',()=>{
  const rows=[['المبيعات'],['رقم الفاتورة','الكمية','كود العميل','اسم العميل','الصنف','قيمة المبيعات'],['18354',700,'13176','حسين المحامض','بلوك اسود',1260],['منتجات تامة']];
  const result=parser().parseWorkbook(workbookFrom({Sheet1:rows}),XLSX);
  assert.equal(result.sales.length,1);
  assert.equal(result.sales[0].customerCode,'13176');
  assert.equal(result.sales[0].customer,'حسين المحامض');
  assert.equal(result.sales[0].amount,1260);
});

test('supports points-of-sale treasury 104 and textual dates',()=>{
  const rows=[['','', 'الخزينة',104,'نقاط البيع'],['مدين','دائن','اسم الحساب','نوع الحساب','كود العميل','نوع الحركة','رقم السند','التاريخ','ملاحظات'],[16825,0,'عميل نقاط','عميل','C104','استلام نقاط بيع','POS-1','16/07/2026','تحصيل']];
  const result=parser().parseWorkbook(workbookFrom({تحصيلات:rows}),XLSX);
  assert.equal(result.sales.length,0);
  assert.equal(result.collections.length,1);
  assert.equal(result.collections[0].treasuryCode,'104');
  assert.equal(result.collections[0].method,'نقاط بيع');
  assert.equal(result.collections[0].date,'2026-07-16');
});

test('ignores invalid negative and empty sales without crashing',()=>{
  const rows=[['المبيعات'],['رقم الفاتورة','الكمية','كود العميل','اسم العميل','الصنف','المديونية'],['1',-5,'C1','عميل','بلوك',100],['2',5,'C2','','خرسانة',500],['3','غير رقمي','C3','عميل','بلوك',500],[],['خامات']];
  const result=parser().parseWorkbook(workbookFrom({غير_صالح:rows}),XLSX);
  assert.equal(result.sales.length,0);
  assert.equal(result.collections.length,0);
});

test('normalizes Arabic digits and Excel serial dates deterministically',()=>{
  const api=parser();
  assert.equal(api.number('١٢٬٣٤٥٫٦٧'),12345.67);
  assert.equal(api.isoDate('١٦/٠٧/٢٠٢٦'),'2026-07-16');
  assert.equal(api.isoDate(45500),'2024-07-27');
  assert.equal(api.kind('خرسانة جاهزة'),'خرسانة');
  assert.equal(api.kind('بلك اسود'),'بلك');
  assert.equal(api.kind('بلوك اسود'),'بلك');
});

test('rejects a missing workbook/parser dependency explicitly',()=>{
  const api=parser();
  assert.throws(()=>api.parseWorkbook(null,XLSX),/Excel parser is not available/);
  assert.throws(()=>api.parseWorkbook({SheetNames:[],Sheets:{}},{}),/Excel parser is not available/);
});
