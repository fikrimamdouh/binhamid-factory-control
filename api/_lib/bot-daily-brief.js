// الملخّص اليومي المصمَّم: يُبنى من آخر تقرير معتمد ويُقارن بالتقرير الذي قبله.
// يُرسل تلقائيًا فور الاعتماد (دفع) ويُستخدم أيضًا كصدر «تقرير اليوم» (سحب)، فيقرأ
// المشغّل الصورة كاملة في ثوانٍ بدل تصفح الأزرار.
import { select } from './supabase.js';
import { compose, title, section, line, sub, note, alert, trend, money, qty, arabicDate, esc, warmAck, RULE } from './bot-format.js';

const num=value=>Number(value||0);
const collected=row=>Math.max(num(row?.debit),num(row?.credit));

async function batchTotals(batchId){
  const id=encodeURIComponent(String(batchId||''));
  if(!id)return null;
  const[sales,cash,inventory]=await Promise.all([
    select('daily_report_sales_lines',`batch_id=eq.${id}&select=sales_type,customer_code,customer_name,item_name,quantity,amount&limit=5000`).catch(()=>[]),
    select('daily_report_cash_movements',`batch_id=eq.${id}&select=debit,credit,is_customer_collection&limit=3000`).catch(()=>[]),
    select('daily_report_inventory_snapshots',`batch_id=eq.${id}&select=item_name,unit,issued_quantity,closing_quantity&limit=1000`).catch(()=>[])
  ]);
  const totals={sales:0,block:0,concrete:0,blockQty:0,concreteQty:0,collections:0,invoices:(sales||[]).length};
  const byCustomer=new Map();
  for(const row of sales||[]){
    const amount=num(row.amount);totals.sales+=amount;
    if(row.sales_type==='block'){totals.block+=amount;totals.blockQty+=num(row.quantity);}
    else if(row.sales_type==='concrete'){totals.concrete+=amount;totals.concreteQty+=num(row.quantity);}
    const key=String(row.customer_code||row.customer_name||'').trim()||'—';
    const entry=byCustomer.get(key)||{name:row.customer_name||key,amount:0};
    entry.amount+=amount;byCustomer.set(key,entry);
  }
  for(const row of cash||[])totals.collections+=collected(row);
  return{totals,topCustomers:[...byCustomer.values()].sort((a,b)=>b.amount-a.amount).slice(0,3),inventory:inventory||[]};
}

// أصناف على وشك النفاد: تغطية = الرصيد الختامي ÷ المنصرف اليومي. تُحسب فقط عند وجود
// انصراف فعلي، فلا تُطلق تنبيهات وهمية لأصناف ساكنة.
function stockWarnings(inventory){
  const rows=[];
  for(const item of inventory||[]){
    const issued=num(item.issued_quantity),closing=num(item.closing_quantity);
    if(closing<0){rows.push({name:item.item_name,text:'رصيد سالب'});continue;}
    if(issued<=0)continue;
    const days=closing/issued;
    if(days<=3)rows.push({name:item.item_name,text:`تغطية ${days<1?'أقل من يوم':`${days.toFixed(1)} يوم`}`});
  }
  return rows.slice(0,4);
}

export async function loadDailyBrief(){
  const batches=await select('daily_report_batches','status=eq.approved&select=id,report_date,original_name,committed_at,approved_at&order=committed_at.desc.nullslast,approved_at.desc.nullslast,report_date.desc&limit=6').catch(()=>[]);
  if(!batches?.length)return null;
  const current=batches[0],previous=batches.find(row=>String(row.report_date||'')!==String(current.report_date||''))||null;
  const[now,before]=await Promise.all([batchTotals(current.id),previous?batchTotals(previous.id):Promise.resolve(null)]);
  if(!now)return null;
  return{batch:current,previousBatch:previous,...now,previousTotals:before?.totals||null};
}

export function renderDailyBrief(brief,identity=null){
  if(!brief)return compose(title('📊','التقرير اليومي'),note('لا يوجد تقرير معتمد بعد.'));
  const greeting=identity?warmAck(identity):null;
  const{batch,totals,topCustomers,inventory,previousTotals,previousBatch}=brief;
  const gap=totals.sales-totals.collections;
  const head=[
    greeting,
    title('📊',`تقرير ${arabicDate(batch.report_date)}`),
    RULE,
    line('💰','المبيعات',money(totals.sales),'ر.س'),
    totals.concrete?sub('🏗️','خرسانة',money(totals.concrete),`${qty(totals.concreteQty)} م³`):null,
    totals.block?sub('🧱','بلوك',money(totals.block),`${qty(totals.blockQty)} وحدة`):null,
    line('🧾','التحصيل',money(totals.collections),'ر.س'),
    line(gap>0?'📉':'📈','الفجوة',money(Math.abs(gap)),gap>0?'ر.س غير محصّلة':'ر.س تحصيل زائد'),
    line('🧮','الفواتير',qty(totals.invoices))
  ];
  const compare=previousTotals?[
    RULE,
    section('📈',`مقابل ${arabicDate(previousBatch?.report_date)}`),
    `   المبيعات ${trend(totals.sales,previousTotals.sales)}`,
    `   التحصيل ${trend(totals.collections,previousTotals.collections)}`
  ]:null;
  const top=topCustomers?.length?[
    section('🔝','أعلى العملاء'),
    ...topCustomers.map((row,index)=>`   ${index+1}. ${esc(row.name)} — <b>${money(row.amount)}</b>`)
  ]:null;
  const warnings=stockWarnings(inventory);
  const stock=warnings.length?[section('📦','تنبيهات المخزون'),...warnings.map(row=>`   ${alert(`${row.name} — ${row.text}`)}`)]:null;
  const tail=[RULE,note(`المصدر: ${batch.original_name||'التقرير اليومي'}`)];
  return compose(head,compare,top,stock,tail);
}

export async function buildDailyBriefMessage(identity=null){
  return renderDailyBrief(await loadDailyBrief(),identity);
}
