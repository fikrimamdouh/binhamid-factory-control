import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectCumulativeDailyReport } from '../api/_lib/daily-cumulative-report-data.js';
import { cumulativeDepartmentHtml } from '../api/_lib/daily-cumulative-pdf.js';
import { integrationCatalogText } from '../api/_lib/bot-integrations.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

function projection(){
  return projectCumulativeDailyReport({
    reportDate:'2026-07-18',latestApprovedDate:'2026-07-17',
    storedSales:[
      {reference_no:'B-1',sales_type:'block',customer_external_id:'A',customer_name:'عميل أ',item:'بلوك',quantity:100,total_amount:100,paid_amount:20,status:'registered',delivery_date:'2026-07-01'},
      {reference_no:'C-1',sales_type:'concrete',customer_external_id:'A',customer_name:'عميل أ',item:'خرسانة',quantity:10,total_amount:200,paid_amount:50,status:'registered',delivery_date:'2026-07-02'},
      {reference_no:'B-2',sales_type:'block',customer_external_id:'B',customer_name:'عميل ب',item:'بلوك',quantity:50,total_amount:50,paid_amount:0,status:'registered',delivery_date:'2026-07-03'}
    ],
    dailySales:[
      {invoice:'101',kind:'بلوك',customerCode:'C',customer:'عميل ج',item:'بلوك 20',quantity:70,amount:70},
      {invoice:'102',kind:'خرسانة',customerCode:'D',customer:'عميل د',item:'خرسانة C30',quantity:5,amount:120}
    ],
    dailyCollections:[
      {customerCode:'A',customer:'عميل أ',amount:100},
      {customerCode:'B',customer:'عميل ب',amount:25}
    ]
  });
}

test('current collections settle old invoices globally by FIFO then split to block and concrete',()=>{
  const data=projection(),blockA=data.departments.block.rows.find(row=>row.code==='A'),concreteA=data.departments.concrete.rows.find(row=>row.code==='A');
  assert.equal(blockA.openingBalance,80);
  assert.equal(blockA.currentSales,0);
  assert.equal(blockA.currentApplied,80);
  assert.equal(blockA.closingBalance,0);
  assert.equal(concreteA.openingBalance,150);
  assert.equal(concreteA.currentApplied,20);
  assert.equal(concreteA.closingBalance,130);
});

test('daily report includes old customers, new customers, current sales and projected closing balances',()=>{
  const data=projection(),block=data.departments.block.rows;
  assert.ok(block.some(row=>row.code==='B'&&row.openingBalance===50&&row.currentApplied===25&&row.closingBalance===25));
  assert.ok(block.some(row=>row.code==='C'&&row.openingBalance===0&&row.currentSales===70&&row.closingBalance===70));
  assert.equal(data.departments.concrete.rows.find(row=>row.code==='D').closingBalance,120);
  assert.equal(data.latestApprovedDate,'2026-07-17');
});

test('PDF HTML states cumulative formula and draft approval boundary',()=>{
  const data=projection(),html=cumulativeDepartmentHtml({type:'block',data:data.departments.block,sourceFile:'ملخص العمل اليومي.xlsx',reportDate:data.reportDate,latestApprovedDate:data.latestApprovedDate});
  assert.match(html,/تقرير البلوك التراكمي/);
  assert.match(html,/الرصيد السابق/);
  assert.match(html,/تحصيل موزع اليوم/);
  assert.match(html,/مسودة تراكميّة قبل الاعتماد/);
  assert.match(html,/FIFO/);
  assert.match(html,/عميل أ/);
});

test('Telegram Excel flow generates both cumulative PDF files without approving the report',async()=>{
  const source=await read('api/_lib/bot-files.js');
  assert.match(source,/generateCumulativeDailyPdfs/);
  assert.match(source,/application\/pdf/);
  assert.match(source,/result\?\.recognizedDaily/);
  assert.match(source,/لا تصبح الحركة جزءًا من الرصيد الرسمي|بعد اعتماد الملف تصبح الحركة جزءًا من الرصيد الرسمي/);
  assert.doesNotMatch(source,/commit_daily_report/);
});

test('integration catalog lists key names but never prints configured secret values',async()=>{
  const text=integrationCatalogText();
  for(const name of ['SUPABASE_URL','TELEGRAM_BOT_TOKEN','OPENAI_API_KEY','GOOGLE_PLACES_API_KEY','PDF_API_URL','BACKUP_ENCRYPTION_KEY'])assert.ok(text.includes(name),`missing ${name}`);
  assert.match(text,/الحضور والانصراف/);
  assert.match(text,/حالة الأسطول من حضور السائقين/);
  assert.match(text,/ليست تتبع GPS أو Traccar/);
  assert.match(text,/لا يحتاج API Key إضافيًا/);
  const source=await read('api/_lib/bot-integrations.js');
  assert.doesNotMatch(source,/GPS_API_BASE_URL|GPS_PROVIDER|Traccar مفتوح المصدر/);
  assert.doesNotMatch(source,/config\.openaiKey\}/);
  assert.doesNotMatch(source,/config\.telegramToken\}/);
  assert.doesNotMatch(source,/config\.supabaseKey\}/);
});

test('PDF service supports Gotenberg Chromium conversion and validates the PDF header',async()=>{
  const source=await read('api/_lib/pdf-service.js');
  assert.match(source,/forms\/chromium\/convert\/html/);
  assert.match(source,/preferCssPageSize/);
  assert.match(source,/%PDF-/);
  assert.match(source,/PDF_SERVICE_NOT_CONFIGURED/);
});
