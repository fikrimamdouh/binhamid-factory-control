import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { classifyFile } from '../api/_lib/domain.js';
import { parseDailyWorkbook } from '../api/_lib/daily-summary-parser.js';
import { reportDestination, reportTypeLabel } from '../api/_lib/bot-profile.js';

function workbookFixture(){
  const rows=[
    ['المبيعات'],
    ['رقم الفاتورة','الكمية','كود العميل','اسم العميل','الصنف','المديونية'],
    [18354,700,'C-101','عميل البلوك','بلك أسود 20',1260],
    [18355,12.5,'C-202','عميل الخرسانة','خرسانة جاهزة',2500],
    ['حركة الخزن'],
    ['','الخزن','','الخزينة',101,'نقدية'],
    ['التاريخ','رقم الإذن','اسم الحساب','نوع الحساب','رقم الحساب','مدين','دائن','نوع الحركة'],
    ['2026-07-17','R-1','عميل البلوك','عميل','C-101',500,0,'استلام تحصيل عميل']
  ];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Sheet1');
  return workbook;
}

test('daily report is identified from content even with a Telegram-generated file name',()=>{
  const analysis=parseDailyWorkbook(workbookFixture(),XLSX);
  const type=classifyFile('4_5967379367234379408.xlsx','unassigned',['Sheet1'],analysis.contentText);
  assert.equal(type,'daily_movement');
  assert.equal(reportTypeLabel(type),'التقرير اليومي للمبيعات والتحصيل والمخزون');
  assert.equal(reportDestination(type),'التقرير اليومي — مراجعة واعتماد المبيعات والتحصيل والمخزون');
});

test('daily workbook parser produces sales and collection summary before approval',()=>{
  const analysis=parseDailyWorkbook(workbookFixture(),XLSX);
  assert.equal(analysis.summary.invoiceCount,2);
  assert.equal(analysis.summary.salesTotal,3760);
  assert.equal(analysis.summary.blockQuantity,700);
  assert.equal(analysis.summary.blockSales,1260);
  assert.equal(analysis.summary.concreteQuantity,12.5);
  assert.equal(analysis.summary.concreteSales,2500);
  assert.equal(analysis.summary.collectionCount,1);
  assert.equal(analysis.summary.collectionTotal,500);
});
