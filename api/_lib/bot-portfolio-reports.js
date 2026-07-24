import { select } from './supabase.js';
import { sendMessage, sendDocumentBuffer } from './telegram.js';
import { generateCustomerPortfolioPdfs } from './customer-portfolio-pdf.js';

const ALLOWED_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales']);
const collectionAmount=row=>Math.max(Number(row?.debit||0),Number(row?.credit||0));

function analysisFromCommitted(data){
  const sales=(data.sales||[]).map(row=>({
    row:row.source_row_no,
    invoice:row.invoice_no,
    kind:row.sales_type==='block'?'بلوك':'خرسانة',
    customerCode:row.customer_code,
    customer:row.customer_name,
    item:row.item_name,
    quantity:Number(row.quantity||0),
    amount:Number(row.amount||0)
  }));
  const collections=(data.cash||[])
    .filter(row=>row.is_customer_collection===true||String(row.is_customer_collection)==='true')
    .map(row=>({
      row:row.source_row_no,
      customerCode:row.account_code,
      customer:row.account_name,
      amount:collectionAmount(row),
      treasuryCode:row.treasury_code,
      treasuryName:row.treasury_name
    }));
  return{currentBatch:true,reportDate:data.batch.report_date,sales,collections};
}

async function latestApprovedReport(){
  const batch=(await select(
    'daily_report_batches',
    'status=eq.approved&select=id,report_date,original_name,approved_at,committed_at&order=report_date.desc,committed_at.desc.nullslast,approved_at.desc.nullslast&limit=1'
  ))?.[0];
  if(!batch)return null;
  const id=encodeURIComponent(String(batch.id));
  const[sales,cash]=await Promise.all([
    select('daily_report_sales_lines',`batch_id=eq.${id}&select=source_row_no,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,amount&order=source_row_no.asc&limit=3000`).catch(()=>[]),
    select('daily_report_cash_movements',`batch_id=eq.${id}&select=source_row_no,treasury_code,treasury_name,debit,credit,account_name,account_code,is_customer_collection&order=source_row_no.asc&limit=3000`).catch(()=>[])
  ]);
  return{batch,sales:sales||[],cash:cash||[]};
}

function requestedTypes(identity){
  if(identity?.role==='block_sales')return['block'];
  if(identity?.role==='concrete_sales')return['concrete'];
  return['block','concrete'];
}

export async function sendLatestPortfolioDeclarations(chatId,identity={}){
  if(!identity?.active||!ALLOWED_ROLES.has(String(identity.role||''))){
    return sendMessage(chatId,'إقرارات محفظة العملاء متاحة للإدارة والمحاسب ومسؤولي مبيعات البلوك والخرسانة فقط.');
  }
  const data=await latestApprovedReport();
  if(!data)return sendMessage(chatId,'لا يوجد تقرير يومي معتمد في قاعدة البيانات حتى الآن.');
  const types=requestedTypes(identity),date=data.batch.report_date;
  await sendMessage(chatId,`جارٍ إعداد إقرارات محفظة العملاء من أحدث يوم مرفوع ومعتمد فعليًا: <b>${date}</b>. لا يعتمد الإقرار على تاريخ اليوم.`);
  try{
    const reports=await generateCustomerPortfolioPdfs(
      analysisFromCommitted(data),
      data.batch.original_name||'التقرير اليومي',
      types,
      {reportDate:date,dailyOnly:true}
    );
    for(const report of reports){
      await sendDocumentBuffer(chatId,report.pdf,report.filename,'application/pdf',report.caption);
    }
    await sendMessage(chatId,`تم إرسال ${reports.length} إقرار من أحدث تقرير معتمد بتاريخ <b>${date}</b>.`);
    return reports;
  }catch(error){
    console.error('[telegram latest portfolio declarations]',{code:error?.code||null,status:Number(error?.status||error?.upstreamStatus||0),message:String(error?.message||'').slice(0,500)});
    return sendMessage(chatId,`تعذر إنشاء إقرارات محفظة العملاء مؤقتًا. السبب: ${String(error?.message||'تعذر إنشاء PDF').slice(0,300)}`);
  }
}
