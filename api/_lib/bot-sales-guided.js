import { select, insert, rpc } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const normalizeDigits=value=>String(value||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/٬/g,'');
const TYPE_LABEL={block:'البلوك',concrete:'الخرسانة الجاهزة'};
const ITEMS={
  block:[['block10','بلوك 10'],['block15','بلوك 15'],['block20','بلوك 20'],['insulated','بلوك معزول']],
  concrete:[['c250','خرسانة 250'],['c300','خرسانة 300'],['c350','خرسانة 350'],['resistant','خرسانة مقاومة']]
};
const ITEM_MAP=Object.fromEntries(Object.values(ITEMS).flat());

async function setSession(chatId,userId,state,context={}){
  const old=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=context&limit=1`))?.[0];
  const aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}
async function currentSession(chatId,userId){return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
const referenceFrom=result=>String(Array.isArray(result)?result[0]?.next_document_no||result[0]||'':result||'');
const nextReference=async type=>referenceFrom(await rpc('next_document_no',{p_prefix:type==='block'?'BSO':'CSO'}));
const dateKey=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);};
const numberFrom=value=>{const m=normalizeDigits(value).replace(/,/g,'').match(/\d+(?:\.\d+)?/);return m?Number(m[0]):0;};

function itemKeyboard(type){
  const rows=[];const items=ITEMS[type]||[];
  for(let i=0;i<items.length;i+=2)rows.push(items.slice(i,i+2).map(([code,label])=>({text:label,callback_data:`gs_item:${code}`})));
  rows.push([{text:'صنف آخر',callback_data:'gs_item:other'}]);
  return keyboard(rows);
}
function quantityKeyboard(type){
  const values=type==='block'?[500,1000,2000,5000]:[10,20,40,60,100];
  const rows=[];for(let i=0;i<values.length;i+=3)rows.push(values.slice(i,i+3).map(value=>({text:String(value),callback_data:`gs_qty:${value}`})));
  rows.push([{text:'كمية أخرى',callback_data:'gs_qty:other'}]);return keyboard(rows);
}
function deliveryKeyboard(){return keyboard([[{text:'اليوم',callback_data:'gs_date:0'},{text:'غدًا',callback_data:'gs_date:1'},{text:'بعد غد',callback_data:'gs_date:2'}],[{text:'تاريخ آخر',callback_data:'gs_date:other'}]]);}
function paymentKeyboard(){return keyboard([[{text:'نقدي',callback_data:'gs_pay:cash'},{text:'تحويل',callback_data:'gs_pay:transfer'}],[{text:'آجل',callback_data:'gs_pay:credit'},{text:'يحدد لاحقًا',callback_data:'gs_pay:later'}]]);}

export async function startGuidedSales(message,identity,type){
  const role=identity?.role||'',own=role==='block_sales'?'block':role==='concrete_sales'?'concrete':'';
  if(!['admin','block_sales','concrete_sales'].includes(role))return sendMessage(message.chat.id,'تسجيل أمر البيع متاح لموظفي المبيعات ومدير النظام.');
  if(own&&own!==type)return sendMessage(message.chat.id,`دورك مخصص لمبيعات ${TYPE_LABEL[own]} فقط.`);
  await setSession(message.chat.id,identity.external_id||message.from.id,'guided_sales_customer',{salesType:type,startedAt:now()});
  return sendMessage(message.chat.id,`بدء أمر بيع ${TYPE_LABEL[type]}.\n\nاكتب اسم العميل فقط.`);
}

async function askItem(message,identity,context){
  await setSession(message.chat.id,identity.external_id||message.from.id,'guided_sales_item',context);
  return sendMessage(message.chat.id,'اختر الصنف:',itemKeyboard(context.salesType));
}
async function askQuantity(message,identity,context){
  await setSession(message.chat.id,identity.external_id||message.from.id,'guided_sales_quantity',context);
  return sendMessage(message.chat.id,`اختر الكمية${context.salesType==='block'?' بالقطعة':' بالمتر المكعب'}:`,quantityKeyboard(context.salesType));
}
async function askPrice(message,identity,context){
  await setSession(message.chat.id,identity.external_id||message.from.id,'guided_sales_price',context);
  return sendMessage(message.chat.id,'اكتب سعر الوحدة بالأرقام، أو اضغط «يحدد لاحقًا».',keyboard([[{text:'يحدد لاحقًا',callback_data:'gs_price:later'}]]));
}
async function askDelivery(message,identity,context){
  await setSession(message.chat.id,identity.external_id||message.from.id,'guided_sales_delivery',context);
  return sendMessage(message.chat.id,'اختر موعد التوريد:',deliveryKeyboard());
}
async function askPayment(message,identity,context){
  await setSession(message.chat.id,identity.external_id||message.from.id,'guided_sales_payment',context);
  return sendMessage(message.chat.id,'اختر طريقة الدفع:',paymentKeyboard());
}
async function askLocation(message,identity,context){
  await setSession(message.chat.id,identity.external_id||message.from.id,'guided_sales_location',context);
  return sendMessage(message.chat.id,'اكتب موقع التوريد أو اسم المشروع.');
}
async function prepareConfirmation(message,identity,context){
  const reference=await nextReference(context.salesType),quantity=Number(context.quantity||0),price=Number(context.unitPrice||0);
  const draft={reference_no:reference,sales_type:context.salesType,customer_name:context.customer,item:context.item,quantity,quantity_text:`${quantity} ${context.salesType==='block'?'قطعة':'م³'}`,unit:context.salesType==='block'?'قطعة':'م³',unit_price:price,total_amount:quantity*price,delivery_date:context.deliveryDate,delivery_text:context.deliveryDate,location:context.location,payment_method:context.payment,status:'registered',created_at:now(),created_by_user_id:String(identity.user_id||''),sales_person_name:displayName(identity,message.from),sales_person_role:identity.role,raw_order_text:'تم الإدخال بالمعالج المبسط'};
  await setSession(message.chat.id,identity.external_id||message.from.id,'sales_confirm_order',{draft,startedAt:now()});
  const text=`<b>مراجعة أمر البيع</b>\n\nالمرجع: <b>${esc(reference)}</b>\nالقسم: ${esc(TYPE_LABEL[draft.sales_type])}\nالعميل: <b>${esc(draft.customer_name)}</b>\nالصنف: ${esc(draft.item)}\nالكمية: <b>${esc(draft.quantity_text)}</b>\nسعر الوحدة: <b>${price?`${price.toLocaleString('en-US')} ر.س`:'يحدد لاحقًا'}</b>\nالإجمالي التقديري: <b>${price?`${draft.total_amount.toLocaleString('en-US')} ر.س`:'غير محدد'}</b>\nموعد التوريد: <b>${esc(draft.delivery_date)}</b>\nطريقة الدفع: ${esc(draft.payment_method)}\nالموقع: ${esc(draft.location)}\n\nراجع البيانات ثم أكد.`;
  return sendMessage(message.chat.id,text,keyboard([[{text:'تأكيد تسجيل أمر البيع',callback_data:`sales_confirm:${reference}`}],[{text:'إلغاء',callback_data:`sales_cancel:${reference}`}]]));
}

export async function continueGuidedSales(message,identity,session,text){
  const t=String(text||'').trim(),context=session.context||{};
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(t)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء أمر البيع المؤقت.');return true;}
  if(session.state==='guided_sales_customer'){
    if(t.length<2){await sendMessage(message.chat.id,'اكتب اسم عميل واضح.');return true;}
    await askItem(message,identity,{...context,customer:t});return true;
  }
  if(session.state==='guided_sales_item_other'){
    if(t.length<2){await sendMessage(message.chat.id,'اكتب اسم الصنف.');return true;}
    await askQuantity(message,identity,{...context,item:t});return true;
  }
  if(session.state==='guided_sales_quantity_other'){
    const quantity=numberFrom(t);if(!quantity){await sendMessage(message.chat.id,'اكتب الكمية بالأرقام.');return true;}
    await askPrice(message,identity,{...context,quantity});return true;
  }
  if(session.state==='guided_sales_price'){
    const unitPrice=numberFrom(t);if(!unitPrice){await sendMessage(message.chat.id,'اكتب سعر الوحدة بالأرقام، أو اضغط «يحدد لاحقًا».');return true;}
    await askDelivery(message,identity,{...context,unitPrice});return true;
  }
  if(session.state==='guided_sales_delivery_other'){
    const value=normalizeDigits(t),m=value.match(/(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/);if(!m){await sendMessage(message.chat.id,'اكتب التاريخ بصيغة 2026-07-20.');return true;}
    await askPayment(message,identity,{...context,deliveryDate:`${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`});return true;
  }
  if(session.state==='guided_sales_location'){
    if(t.length<2){await sendMessage(message.chat.id,'اكتب موقعًا واضحًا.');return true;}
    await prepareConfirmation(message,identity,{...context,location:t});return true;
  }
  return false;
}

export async function handleGuidedSalesCallback(message,from,identity,action,value){
  const session=await currentSession(message.chat.id,identity.external_id||from.id),context=session?.context||{};
  if(action==='gs_item'){
    if(session?.state!=='guided_sales_item')return sendMessage(message.chat.id,'انتهت خطوة اختيار الصنف. ابدأ أمر بيع جديد.');
    if(value==='other'){await setSession(message.chat.id,identity.external_id||from.id,'guided_sales_item_other',context);return sendMessage(message.chat.id,'اكتب اسم الصنف.');}
    return askQuantity({...message,from},identity,{...context,item:ITEM_MAP[value]||value});
  }
  if(action==='gs_qty'){
    if(session?.state!=='guided_sales_quantity')return sendMessage(message.chat.id,'انتهت خطوة الكمية. ابدأ أمر بيع جديد.');
    if(value==='other'){await setSession(message.chat.id,identity.external_id||from.id,'guided_sales_quantity_other',context);return sendMessage(message.chat.id,'اكتب الكمية بالأرقام.');}
    return askPrice({...message,from},identity,{...context,quantity:Number(value)});
  }
  if(action==='gs_price'){
    if(session?.state!=='guided_sales_price')return sendMessage(message.chat.id,'انتهت خطوة السعر. ابدأ أمر بيع جديد.');
    return askDelivery({...message,from},identity,{...context,unitPrice:0});
  }
  if(action==='gs_date'){
    if(session?.state!=='guided_sales_delivery')return sendMessage(message.chat.id,'انتهت خطوة موعد التوريد. ابدأ أمر بيع جديد.');
    if(value==='other'){await setSession(message.chat.id,identity.external_id||from.id,'guided_sales_delivery_other',context);return sendMessage(message.chat.id,'اكتب التاريخ بصيغة 2026-07-20.');}
    return askPayment({...message,from},identity,{...context,deliveryDate:dateKey(Number(value))});
  }
  if(action==='gs_pay'){
    if(session?.state!=='guided_sales_payment')return sendMessage(message.chat.id,'انتهت خطوة الدفع. ابدأ أمر بيع جديد.');
    const labels={cash:'نقدي',transfer:'تحويل',credit:'آجل',later:'يحدد لاحقًا'};
    return askLocation({...message,from},identity,{...context,payment:labels[value]||value});
  }
  return false;
}
