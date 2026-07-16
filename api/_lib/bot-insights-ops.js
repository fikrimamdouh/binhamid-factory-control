import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { esc, formatAmount, norm } from './bot-enterprise-store.js';

const INVENTORY_ROLES=new Set(['admin','manager','accountant','warehouse','procurement','mechanic']);
const DEBT_ROLES=new Set(['admin','manager','accountant','collector','block_sales','concrete_sales']);
const CAPACITY_ROLES=new Set(['admin','manager','concrete_sales']);
const number=value=>Number(value||0)||0;
const dateOf=value=>String(value||'').slice(0,10);
async function safeSelect(table,query){try{return await select(table,query)||[];}catch{return[];}}
async function state(){return(await safeSelect('app_state','key=eq.primary&select=payload,updated_at,revision&limit=1'))?.[0]||null;}
export async function sendInventoryRisks(chatId,identity){
  if(!identity?.active||!INVENTORY_ROLES.has(identity.role))return sendMessage(chatId,'ليست لديك صلاحية عرض تحليل المخزون.');
  const items=await safeSelect('inventory_items','active=eq.true&select=item_name,sku,quantity_on_hand,minimum_quantity,unit,updated_at&order=quantity_on_hand.asc&limit=3000');
  if(items.length){
    const negative=items.filter(item=>number(item.quantity_on_hand)<0),zero=items.filter(item=>number(item.quantity_on_hand)===0),low=items.filter(item=>number(item.quantity_on_hand)>0&&number(item.minimum_quantity)>0&&number(item.quantity_on_hand)<=number(item.minimum_quantity));
    let text=`<b>مؤشرات المخزون المركزي</b>\n\nأصناف برصيد سالب: <b>${negative.length}</b>\nأصناف برصيد صفري: <b>${zero.length}</b>\nأصناف عند أو تحت الحد الأدنى: <b>${low.length}</b>`;
    const critical=[...negative,...zero,...low].slice(0,20);if(critical.length)text+=`\n\n<b>تحتاج متابعة</b>\n${critical.map(item=>`• ${esc(item.item_name)}${item.sku?` (${esc(item.sku)})`:''}: ${esc(item.quantity_on_hand)} ${esc(item.unit||'')} — الحد ${esc(item.minimum_quantity)}`).join('\n')}`;
    return sendMessage(chatId,text.slice(0,3900));
  }
  const logs=await safeSelect('audit_log','action=eq.enterprise_operation_created&entity_type=in.(inventory,purchase)&select=entity_id,details,created_at&order=created_at.desc&limit=1000'),balances=new Map(),low=[];
  for(const row of [...logs].reverse()){const details=row.details||{},item=String(details.item||'').trim();if(!item)continue;const current=balances.get(item)||0;if(details.subtype==='receive')balances.set(item,current+number(details.quantity));else if(details.subtype==='issue')balances.set(item,current-number(details.quantity));else if(details.subtype==='count')balances.set(item,number(details.quantity));if(details.subtype==='low_stock')low.push(details);}
  const negative=[...balances].filter(([,value])=>value<0),zero=[...balances].filter(([,value])=>value===0),critical=[...negative.map(([item,value])=>`${item}: ${value}`),...low.slice(-10).map(item=>`${item.item}: رصيد ${item.quantity} والحد ${item.expected}`)].slice(0,20);
  let text=`<b>مؤشرات المخزون</b>\n\nأصناف برصيد سالب: <b>${negative.length}</b>\nأصناف برصيد صفري: <b>${zero.length}</b>\nتنبيهات انخفاض مسجلة: <b>${low.length}</b>`;if(critical.length)text+=`\n\n<b>تحتاج مراجعة</b>\n${critical.map(item=>`• ${esc(item)}`).join('\n')}`;return sendMessage(chatId,text.slice(0,3900));
}
export async function sendDebtAnalysis(chatId,identity){
  if(!identity?.active||!DEBT_ROLES.has(identity.role))return sendMessage(chatId,'ليست لديك صلاحية عرض تحليل مديونية العملاء.');
  const [orders,collections,customersTable]=await Promise.all([
    safeSelect('sales_orders','status=not.in.(cancelled,rejected)&select=customer_name,total_amount,collected_at,status,created_at&limit=5000'),
    safeSelect('collection_events','status=not.eq.rejected&select=customer_name,amount,status,occurred_at&limit=5000'),
    safeSelect('customers','active=eq.true&select=customer_name,credit_limit,payment_days&limit=2000')
  ]);
  const map=new Map(),customerMeta=new Map(customersTable.map(item=>[norm(item.customer_name),item]));
  for(const order of orders){const key=norm(order.customer_name);if(!key)continue;const row=map.get(key)||{name:order.customer_name,sales:0,collections:0};row.sales+=number(order.total_amount);map.set(key,row);}
  for(const payment of collections){const key=norm(payment.customer_name);if(!key)continue;const row=map.get(key)||{name:payment.customer_name,sales:0,collections:0};row.collections+=number(payment.amount);map.set(key,row);}
  let debts=[...map.entries()].map(([key,row])=>{const meta=customerMeta.get(key)||{};return{...row,balance:row.sales-row.collections,limit:number(meta.credit_limit),days:number(meta.payment_days)};}).filter(item=>item.balance>0).sort((a,b)=>b.balance-a.balance);
  if(!debts.length){
    const snapshot=await state(),legacy=snapshot?.payload?.legacy||{};debts=(legacy.cli||[]).map(item=>({name:item.customerName||item.customer_name||item.name||item.clientName||'عميل',balance:number(item.balance??item.debt??item.outstanding??item.remaining),limit:number(item.creditLimit??item.credit_limit),days:number(item.overdueDays??item.delayDays)})).filter(item=>item.balance>0).sort((a,b)=>b.balance-a.balance);
  }
  if(!debts.length)return sendMessage(chatId,'لا توجد مديونيات موجبة واضحة في البيانات التشغيلية الحالية.');
  const total=debts.reduce((sum,item)=>sum+item.balance,0),overLimit=debts.filter(item=>item.limit>0&&item.balance>item.limit),late=debts.filter(item=>item.days>0);
  return sendMessage(chatId,`<b>تحليل مديونية العملاء</b>\n\nإجمالي المديونية التشغيلية: <b>${formatAmount(total)} ر.س</b>\nعدد العملاء المدينين: <b>${debts.length}</b>\nمتجاوزو الحد الائتماني: <b>${overLimit.length}</b>\nعملاء لديهم مدة ائتمان مسجلة: <b>${late.length}</b>\n\n<b>أعلى العملاء</b>\n${debts.slice(0,10).map((item,index)=>`${index+1}. ${esc(item.name)} — <b>${formatAmount(item.balance)} ر.س</b>`).join('\n')}\n\nالحساب مبني على أوامر البيع والتحصيلات المسجلة، ويلزم مطابقته مع الحسابات المعتمدة.`.slice(0,3900));
}
export async function sendConcreteCapacity(chatId,identity){
  if(!identity?.active||!CAPACITY_ROLES.has(identity.role))return sendMessage(chatId,'ليست لديك صلاحية عرض تحليل طاقة الخرسانة.');
  let orders=await safeSelect('sales_orders','sales_type=eq.concrete&status=not.in.(cancelled,rejected,collected)&select=reference_no,quantity,delivery_date,status&limit=3000');
  if(!orders.length){
    const logs=await safeSelect('audit_log','action=in.(sales_order_created,sales_order_updated)&entity_type=eq.concrete_sales_order&select=entity_id,details,created_at&order=created_at.desc&limit=1000'),map=new Map();for(const row of [...logs].reverse())map.set(String(row.entity_id),{...(map.get(String(row.entity_id))||{}),...row.details});orders=[...map.values()];
  }
  const capacity=number(process.env.CONCRETE_DAILY_CAPACITY_M3||300),groups=new Map();for(const order of orders){if(['cancelled','collected','rejected'].includes(order.status))continue;const date=dateOf(order.delivery_date);if(!date)continue;groups.set(date,(groups.get(date)||0)+number(order.quantity));}
  const risks=[...groups].filter(([,quantity])=>quantity>capacity).sort();if(!risks.length)return sendMessage(chatId,`لا توجد أيام تتجاوز الطاقة اليومية المحددة حاليًا (${capacity} م³).`);
  return sendMessage(chatId,`<b>تعارضات طاقة الخرسانة</b>\nالطاقة اليومية المحددة: <b>${capacity} م³</b>\n\n${risks.map(([date,quantity])=>`• ${date}: <b>${quantity} م³</b> — تجاوز ${quantity-capacity} م³`).join('\n')}\n\nراجع توقيت الصبات والمضخات قبل الاعتماد.`);
}
