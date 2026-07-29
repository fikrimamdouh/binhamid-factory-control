import * as XLSX from 'xlsx';
import { erpTelegramRecipients } from './erp-telegram-delivery.js';
import { select } from './supabase.js';
import { sendDocumentBuffer,sendMessage } from './telegram.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const qty=value=>Math.round((Number(value||0)+Number.EPSILON)*1000)/1000;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function isoDay(value){
  const date=new Date(`${value}T12:00:00Z`);
  if(Number.isNaN(date.getTime()))throw new Error('Invalid report end date');
  return date;
}
function dayText(date){return date.toISOString().slice(0,10);}
function previousDays(endDate,count=3){
  const end=isoDay(endDate),days=[];
  for(let offset=count-1;offset>=0;offset--){const value=new Date(end);value.setUTCDate(end.getUTCDate()-offset);days.push(dayText(value));}
  return days;
}
function inFilter(values){return encodeURIComponent(`(${values.map(value=>`"${String(value).replaceAll('\\','\\\\').replaceAll('"','\\"')}"`).join(',')})`);}
function setSheetOptions(sheet,widths=[]){
  sheet['!cols']=widths.map(width=>({wch:width}));
  sheet['!views']=[{rightToLeft:true}];
  return sheet;
}
function addSheet(workbook,name,rows,widths){
  const sheet=XLSX.utils.json_to_sheet(rows,{skipHeader:false});
  setSheetOptions(sheet,widths);
  XLSX.utils.book_append_sheet(workbook,sheet,name);
}

export async function loadThreeDaySalesCollections(endDate){
  const dates=previousDays(endDate,3);
  const batches=await select('daily_report_batches',`report_date=in.${inFilter(dates)}&status=eq.approved&select=id,report_date,summary,committed_at&order=report_date.asc&limit=10`).catch(()=>[]);
  const byDate=new Map((batches||[]).map(row=>[String(row.report_date),row]));
  const batchIds=(batches||[]).map(row=>row.id).filter(Boolean);
  let sales=[],collections=[];
  if(batchIds.length){
    const encoded=inFilter(batchIds);
    [sales,collections]=await Promise.all([
      select('daily_report_sales_lines',`batch_id=in.${encoded}&select=batch_id,source_row_no,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,unit,amount&order=batch_id.asc,source_row_no.asc&limit=20000`).catch(()=>[]),
      select('daily_report_cash_movements',`batch_id=in.${encoded}&is_customer_collection=eq.true&select=batch_id,source_row_no,treasury_code,treasury_name,account_code,account_name,debit,payment_method,voucher_no,movement_date_text&order=batch_id.asc,source_row_no.asc&limit=20000`).catch(()=>[])
    ]);
  }
  const dateByBatch=new Map((batches||[]).map(row=>[row.id,String(row.report_date)]));
  const salesRows=(sales||[]).map(row=>({
    التاريخ:dateByBatch.get(row.batch_id)||'',
    'رقم الفاتورة':clean(row.invoice_no,120),
    القطاع:row.sales_type==='block'?'بلوك':row.sales_type==='concrete'?'خرسانة':clean(row.sales_type,40),
    'رقم العميل':clean(row.customer_code,120),
    'اسم العميل':clean(row.customer_name,500),
    الصنف:clean(row.item_name,500),
    الكمية:qty(row.quantity),
    الوحدة:clean(row.unit,50),
    المبلغ:money(row.amount)
  }));
  const collectionRows=(collections||[]).map(row=>({
    التاريخ:clean(row.movement_date_text,10)||dateByBatch.get(row.batch_id)||'',
    'رقم السند':clean(row.voucher_no,120),
    'رقم الخزينة':clean(row.treasury_code,40),
    الخزينة:clean(row.treasury_name,200),
    'رقم العميل':clean(row.account_code,120),
    'اسم العميل':clean(row.account_name,500),
    الطريقة:clean(row.payment_method,80),
    المبلغ:money(row.debit)
  }));
  const summary=dates.map(date=>{
    const daySales=salesRows.filter(row=>row['التاريخ']===date),dayCollections=collectionRows.filter(row=>row['التاريخ']===date);
    return{
      التاريخ:date,
      الحالة:byDate.has(date)?'معتمد':'لا يوجد تقرير معتمد',
      'عدد الفواتير':daySales.length,
      'مبيعات البلوك':money(daySales.filter(row=>row.القطاع==='بلوك').reduce((sum,row)=>sum+row.المبلغ,0)),
      'مبيعات الخرسانة':money(daySales.filter(row=>row.القطاع==='خرسانة').reduce((sum,row)=>sum+row.المبلغ,0)),
      'إجمالي المبيعات':money(daySales.reduce((sum,row)=>sum+row.المبلغ,0)),
      'عدد السدادات':dayCollections.length,
      'إجمالي السداد':money(dayCollections.reduce((sum,row)=>sum+row.المبلغ,0))
    };
  });
  return{dates,batches:batches||[],summary,salesRows,collectionRows};
}

export function buildThreeDayWorkbook(data){
  const workbook=XLSX.utils.book_new();
  addSheet(workbook,'الملخص',data.summary,[14,22,14,18,20,18,14,18]);
  addSheet(workbook,'المبيعات',data.salesRows.length?data.salesRows:[{التاريخ:'لا توجد بيانات'}],[14,16,14,16,34,28,14,12,16]);
  addSheet(workbook,'السداد',data.collectionRows.length?data.collectionRows:[{التاريخ:'لا توجد بيانات'}],[14,16,14,25,16,34,14,16]);
  return XLSX.write(workbook,{type:'buffer',bookType:'xlsx',compression:true});
}

export async function sendThreeDaySalesCollectionsReport(endDate){
  const data=await loadThreeDaySalesCollections(endDate),buffer=buildThreeDayWorkbook(data),recipients=erpTelegramRecipients(),errors=[];
  const start=data.dates[0],finish=data.dates.at(-1),filename=`تقرير-المبيعات-والسداد-${start}-إلى-${finish}.xlsx`;
  const totals=data.summary.reduce((out,row)=>{out.sales+=Number(row['إجمالي المبيعات']||0);out.collections+=Number(row['إجمالي السداد']||0);out.invoices+=Number(row['عدد الفواتير']||0);out.receipts+=Number(row['عدد السدادات']||0);return out;},{sales:0,collections:0,invoices:0,receipts:0});
  const missing=data.summary.filter(row=>row.الحالة!=='معتمد').map(row=>row.التاريخ);
  const text=`<b>تقرير المبيعات والسداد — آخر 3 أيام</b>\nالفترة: <b>${esc(start)} إلى ${esc(finish)}</b>\nعدد الفواتير: <b>${totals.invoices}</b>\nإجمالي المبيعات: <b>${money(totals.sales).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س</b>\nعدد السدادات: <b>${totals.receipts}</b>\nإجمالي السداد: <b>${money(totals.collections).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س</b>${missing.length?`\nتنبيه: لا يوجد تقرير معتمد للأيام: ${esc(missing.join('، '))}`:''}`;
  let messagesSent=0,documentsSent=0;
  for(const chatId of recipients){
    try{await sendMessage(chatId,text);messagesSent++;}catch(error){errors.push(`message:${chatId}:${clean(error?.message||error,240)}`);}
    try{await sendDocumentBuffer(chatId,buffer,filename,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',`المبيعات والسداد من ${start} إلى ${finish}`);documentsSent++;}catch(error){errors.push(`document:${chatId}:${clean(error?.message||error,240)}`);}
  }
  return{recipients,messagesSent,documentsSent,filename,summary:data.summary,errors};
}
