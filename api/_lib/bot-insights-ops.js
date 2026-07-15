import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { esc, formatAmount } from './bot-enterprise-store.js';
const number=value=>Number(value||0)||0;
const dateOf=value=>String(value||'').slice(0,10);
async function state(){return(await select('app_state','key=eq.primary&select=payload,updated_at,revision&limit=1'))?.[0]||null;}
export async function sendInventoryRisks(chatId){
  const logs=await select('audit_log','action=eq.enterprise_operation_created&entity_type=in.(inventory,purchase)&select=entity_id,details,created_at&order=created_at.desc&limit=1000'),balances=new Map(),low=[];
  for(const row of [...(logs||[])].reverse()){const details=row.details||{},item=String(details.item||'').trim();if(!item)continue;const current=balances.get(item)||0;if(details.subtype==='receive')balances.set(item,current+number(details.quantity));else if(details.subtype==='issue')balances.set(item,current-number(details.quantity));else if(details.subtype==='count')balances.set(item,number(details.quantity));if(details.subtype==='low_stock')low.push(details);}
  const negative=[...balances].filter(([,value])=>value<0),zero=[...balances].filter(([,value])=>value===0);
  let text=`<b>مؤشرات المخزون</b>\n\nأصناف برصيد سالب: <b>${negative.length}</b>\nأصناف برصيد صفري: <b>${zero.length}</b>\nتنبيهات انخفاض مسجلة: <b>${low.length}</b>`;
  const critical=[...negative.map(([item,value])=>`${item}: ${value}`),...low.slice(-10).map(item=>`${item.item}: رصيد ${item.quantity} والحد ${item.expected}`)].slice(0,20);if(critical.length)text+=`\n\n<b>تحتاج مراجعة</b>\n${critical.map(item=>`• ${esc(item)}`).join('\n')}`;
  text+='\n\nالرصيد مبني على الحركات المسجلة عبر البوت ولا يستبدل جرد البرنامج الرئيسي.';return sendMessage(chatId,text.slice(0,3900));
}
export async function sendDebtAnalysis(chatId){
  const row=await state();if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية لتحليل العملاء.');
  const legacy=row.payload?.legacy||{},customers=(legacy.cli||[]).map(item=>({name:item.customerName||item.customer_name||item.name||item.clientName||'عميل',balance:number(item.balance??item.debt??item.outstanding??item.remaining),limit:number(item.creditLimit??item.credit_limit),days:number(item.overdueDays??item.delayDays)})).filter(item=>item.balance>0).sort((a,b)=>b.balance-a.balance);
  if(!customers.length)return sendMessage(chatId,'لا توجد مديونيات موجبة واضحة في نسخة العملاء المتزامنة.');
  const total=customers.reduce((sum,item)=>sum+item.balance,0),overLimit=customers.filter(item=>item.limit>0&&item.balance>item.limit),late=customers.filter(item=>item.days>0);
  return sendMessage(chatId,`<b>تحليل مديونية العملاء</b>\n\nإجمالي المديونية: <b>${formatAmount(total)} ر.س</b>\nعدد العملاء المدينين: <b>${customers.length}</b>\nمتجاوزو الحد الائتماني: <b>${overLimit.length}</b>\nعملاء لديهم أيام تأخير: <b>${late.length}</b>\n\n<b>أعلى العملاء</b>\n${customers.slice(0,10).map((item,index)=>`${index+1}. ${esc(item.name)} — <b>${formatAmount(item.balance)} ر.س</b>${item.days?` — ${item.days} يوم تأخير`:''}`).join('\n')}`.slice(0,3900));
}
export async function sendConcreteCapacity(chatId){
  const logs=await select('audit_log','action=in.(sales_order_created,sales_order_updated)&entity_type=eq.concrete_sales_order&select=entity_id,details,created_at&order=created_at.desc&limit=1000'),map=new Map();
  for(const row of [...(logs||[])].reverse())map.set(String(row.entity_id),{...(map.get(String(row.entity_id))||{}),...row.details});
  const capacity=number(process.env.CONCRETE_DAILY_CAPACITY_M3||300),groups=new Map();for(const order of map.values()){if(['cancelled','collected'].includes(order.status))continue;const date=dateOf(order.delivery_date);if(!date)continue;groups.set(date,(groups.get(date)||0)+number(order.quantity));}
  const risks=[...groups].filter(([,quantity])=>quantity>capacity).sort();if(!risks.length)return sendMessage(chatId,`لا توجد أيام تتجاوز الطاقة اليومية المحددة حاليًا (${capacity} م³).`);
  return sendMessage(chatId,`<b>تعارضات طاقة الخرسانة</b>\nالطاقة اليومية المحددة: <b>${capacity} م³</b>\n\n${risks.map(([date,quantity])=>`• ${date}: <b>${quantity} م³</b> — تجاوز ${quantity-capacity} م³`).join('\n')}\n\nراجع توقيت الصبات والمضخات قبل الاعتماد.`);
}
