import { select, insert, upsert, patch, remove, rpc } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { requiredSelect } from './required-data.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const normalize=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const normalizeDigits=value=>String(value||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/٬/g,'');
const CLOSED=new Set(['collected','cancelled']);
const PROTECTED_DELETE=new Set(['invoiced','collected']);
const STATUS_LABEL={registered:'مسجل للمتابعة',confirmed:'مؤكد',scheduled:'مجدول للتوريد',in_production:'تحت التجهيز/الإنتاج',ready:'جاهز للتحميل',dispatched:'خرج للتوريد',delivered:'تم التوريد',invoiced:'تم إصدار الفاتورة',collected:'تم التحصيل',on_hold:'موقوف',cancelled:'ملغي'};
const TYPE_LABEL={block:'البلوك',concrete:'الخرسانة الجاهزة'};

const isSalesOperator=role=>['admin','block_sales','concrete_sales'].includes(role);
const canViewSales=role=>['admin','manager','accountant','block_sales','concrete_sales'].includes(role);
const roleSalesType=role=>role==='block_sales'?'block':role==='concrete_sales'?'concrete':'';
const referenceFrom=result=>String(Array.isArray(result)?result[0]?.next_document_no||result[0]||'':result||'');
const nextReference=async type=>referenceFrom(await rpc('next_document_no',{p_prefix:type==='block'?'BSO':'CSO'}));

async function setSession(chatId,userId,state,context={}){
  const old=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=context&limit=1`))?.[0];
  const aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}

async function writeSalesLog({identity,message,action,reference,order}){
  return insert('audit_log',[{
    actor_type:'telegram',
    actor_id:String(identity?.user_id||identity?.external_id||message.from.id),
    action,
    entity_type:`${order.sales_type}_sales_order`,
    entity_id:String(reference),
    details:{...order,reference_no:reference,sales_person_name:order.sales_person_name||displayName(identity,message.from),sales_person_role:identity?.role||'',telegram_user_id:String(message.from.id),chat_id:String(message.chat.id),source_message_id:String(message.message_id),event_at:now()},
    created_at:now()
  }]);
}

function salesOrderRow(order,message={},identity={}){
  const status=String(order.status||'registered'),stamp=now();
  return{
    reference_no:String(order.reference_no||''),sales_type:String(order.sales_type||''),customer_external_id:order.customer_external_id||order.customer_code||null,
    customer_name:String(order.customer_name||''),customer_phone:order.customer_phone||null,item:String(order.item||''),quantity:Number(order.quantity||0),quantity_text:order.quantity_text||null,
    unit:order.unit||null,unit_price:Number(order.unit_price||0),total_amount:Number(order.total_amount||0),delivery_date:order.delivery_date||null,delivery_text:order.delivery_text||null,
    location:order.location||null,payment_method:order.payment_method||null,notes:order.notes||null,status,sales_person_user_id:order.sales_person_user_id||order.created_by_user_id||identity.user_id||null,
    sales_person_name:order.sales_person_name||displayName(identity,message.from||{}),source_chat_id:String(order.source_chat_id||message.chat?.id||''),source_message_id:String(order.source_message_id||message.message_id||''),
    raw_order_text:order.raw_order_text||null,created_at:order.created_at||stamp,updated_at:order.updated_at||stamp,delivered_at:status==='delivered'?(order.delivered_at||stamp):(order.delivered_at||null),
    collected_at:status==='collected'?(order.collected_at||stamp):(order.collected_at||null),cancelled_at:status==='cancelled'?(order.cancelled_at||stamp):(order.cancelled_at||null),paid_amount:Number(order.paid_amount||0)
  };
}
async function persistSalesOrder(order,message={},identity={}){
  const row=salesOrderRow(order,message,identity);if(!row.reference_no)throw new Error('SALES_REFERENCE_REQUIRED');
  return(await upsert('sales_orders',[row],'reference_no'))?.[0]||row;
}

function salesMenu(role){
  const type=roleSalesType(role);
  const rows=[];
  if(type)rows.push([{text:`➕ أمر بيع ${TYPE_LABEL[type]}`,callback_data:`sales:new_${type}`}]);
  else if(role==='admin')rows.push([{text:'➕ أمر بيع بلوك',callback_data:'sales:new_block'},{text:'➕ أمر بيع خرسانة',callback_data:'sales:new_concrete'}]);
  if(isSalesOperator(role))rows.push([{text:'✏️ تحديث أمر بيع',callback_data:'sales:update'},{text:'📋 طلباتي المفتوحة',callback_data:'sales:mine'}]);
  rows.push([{text:'📊 حالة أوامر البيع',callback_data:'sales:summary'},{text:'⏰ الطلبات المتأخرة',callback_data:'sales:overdue'}]);
  rows.push([{text:'🗂 كل الطلبات المفتوحة',callback_data:'sales:open'}]);
  if(role==='admin')rows.push([{text:'حذف أمر بيع تجريبي',callback_data:'sales:delete'}]);
  return keyboard(rows);
}

export async function showSalesMenu(message,identity){
  const role=identity?.role||'pending';
  if(!canViewSales(role))return sendMessage(message.chat.id,'قائمة أوامر البيع متاحة لموظفي مبيعات البلوك والخرسانة ومدير المصنع والمحاسب ومدير النظام.');
  const name=displayName(identity,message.from),type=roleSalesType(role);
  const intro=type?`مرحبًا ${esc(name)}. سجل طلبات ${TYPE_LABEL[type]} قبل التنفيذ وتابع حالتها حتى التوريد والتحصيل:`:`مرحبًا ${esc(name)}. اختر تقرير أو متابعة أوامر البيع:`;
  return sendMessage(message.chat.id,intro,salesMenu(role));
}

function escapeRegExp(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function field(text,labels){
  const pattern=new RegExp(`(?:^|\\n)\\s*(?:${labels.map(escapeRegExp).join('|')})\\s*[:：-]\\s*(.+)`,`i`);
  return String(text||'').match(pattern)?.[1]?.trim()||'';
}
function numberFrom(value){
  const match=normalizeDigits(value).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
  return match?Number(match[0]):0;
}
function dateFrom(value){
  const text=normalizeDigits(value).trim();
  let match=text.match(/(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  if(match)return `${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
  match=text.match(/([0-3]?\d)[-\/]([01]?\d)[-\/](20\d{2})/);
  if(match)return `${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`;
  return '';
}
function parseOrder(text,salesType){
  const customer=field(text,['العميل','اسم العميل']);
  const customerCode=field(text,['كود العميل','رقم العميل']);
  const phone=field(text,['الجوال','رقم الجوال','الهاتف']);
  const item=field(text,['الصنف','المنتج','نوع البلوك','نوع الخرسانة']);
  const quantityText=field(text,['الكمية','الكميه']);
  const priceText=field(text,['سعر الوحدة','السعر','سعر الوحده']);
  const deliveryText=field(text,['موعد التوريد','تاريخ التوريد','التوريد']);
  const location=field(text,['الموقع','موقع التوريد','العنوان']);
  const payment=field(text,['طريقة الدفع','طريقه الدفع','الدفع']);
  const notes=field(text,['ملاحظات','الملاحظات']);
  const quantity=numberFrom(quantityText),unitPrice=numberFrom(priceText),deliveryDate=dateFrom(deliveryText);
  const unit=/متر|م٣|m3/i.test(quantityText)?'م³':/طن/.test(quantityText)?'طن':salesType==='block'?'حبة/قطعة':'م³';
  return {sales_type:salesType,customer_external_id:customerCode||null,customer_code:customerCode||null,customer_name:customer,customer_phone:phone,item,quantity,quantity_text:quantityText,unit,unit_price:unitPrice,total_amount:quantity&&unitPrice?quantity*unitPrice:0,delivery_date:deliveryDate,delivery_text:deliveryText,location,payment_method:payment,notes,raw_order_text:String(text||'').trim(),status:'registered'};
}
function missingFields(order){
  const missing=[];
  if(!order.customer_name)missing.push('اسم العميل');
  if(!order.item)missing.push('الصنف');
  if(!order.quantity)missing.push('الكمية');
  if(!order.delivery_date)missing.push('موعد التوريد بصيغة 2026-07-20');
  return missing;
}
function formatMoney(value){return Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});}
function orderSummary(order){
  return `<b>${esc(order.reference_no||'أمر بيع جديد')}</b> — ${esc(TYPE_LABEL[order.sales_type])}\nالعميل: <b>${esc(order.customer_name)}</b>${order.customer_external_id?` — كود <code>${esc(order.customer_external_id)}</code>`:''}${order.customer_phone?` — ${esc(order.customer_phone)}`:''}\nالصنف: ${esc(order.item)}\nالكمية: <b>${esc(order.quantity_text||`${order.quantity} ${order.unit}`)}</b>\nسعر الوحدة: <b>${order.unit_price?`${formatMoney(order.unit_price)} ر.س`:'غير محدد'}</b>\nالإجمالي التقديري: <b>${order.total_amount?`${formatMoney(order.total_amount)} ر.س`:'غير محدد'}</b>\nموعد التوريد: <b>${esc(order.delivery_text||order.delivery_date)}</b>\nالموقع: ${esc(order.location||'غير محدد')}\nالدفع: ${esc(order.payment_method||'غير محدد')}\nالحالة: <b>${esc(STATUS_LABEL[order.status]||order.status)}</b>${order.notes?`\nملاحظات: ${esc(order.notes)}`:''}`;
}

export async function startSalesAction(message,identity,action){
  const role=identity?.role||'pending',chatId=message.chat.id,userId=identity?.external_id||message.from.id;
  if(['summary','overdue','open','open_block','open_concrete','mine'].includes(action)){
    if(!canViewSales(role))return sendMessage(chatId,'ليست لديك صلاحية عرض أوامر البيع.');
    if(action==='summary')return sendExecutiveSalesStatus(chatId,identity);
    if(action==='overdue')return sendSalesOrdersList(chatId,identity,'overdue');
    if(action==='mine')return sendSalesOrdersList(chatId,identity,'mine');
    if(action==='open_block'||action==='open_concrete')return sendSalesOrdersList(chatId,identity,action);
    return sendSalesOrdersList(chatId,identity,'open');
  }
  if(action==='delete'){
    if(role!=='admin')return sendMessage(chatId,'الحذف التجريبي متاح لمدير النظام فقط. الأدوار الأخرى تستخدم حالة «ملغي».');
    await setSession(chatId,userId,'sales_delete_reference',{startedAt:now()});
    return sendMessage(chatId,'اكتب رقم أمر البيع التجريبي المطلوب حذفه. مثال: <code>BH-BSO-2026-00001</code>');
  }
  if(action==='update'){
    if(!isSalesOperator(role)&&role!=='manager')return sendMessage(chatId,'تحديث أوامر البيع متاح لموظفي المبيعات ومدير المصنع ومدير النظام.');
    await setSession(chatId,userId,'sales_update_order',{startedAt:now()});
    return sendMessage(chatId,'أرسل رقم أمر البيع ثم التحديث في رسالة واحدة. مثال:\nBH-BSO-2026-00015 خرج للتوريد إلى موقع العميل\n\nالحالات المفهومة: مؤكد، مجدول، تحت الإنتاج، جاهز، خرج للتوريد، تم التوريد، صدرت الفاتورة، تم التحصيل، موقوف، ملغي.');
  }
  if(action==='new_block'||action==='new_concrete'){
    if(!isSalesOperator(role))return sendMessage(chatId,'تسجيل أمر بيع متاح لموظف مبيعات البلوك أو الخرسانة ومدير النظام.');
    const salesType=action==='new_block'?'block':'concrete',ownType=roleSalesType(role);
    if(ownType&&ownType!==salesType)return sendMessage(chatId,`دورك مرتبط بمبيعات ${TYPE_LABEL[ownType]} فقط.`);
    await setSession(chatId,userId,'sales_new_order',{salesType,startedAt:now()});
    return sendMessage(chatId,`أرسل أمر بيع ${TYPE_LABEL[salesType]} في رسالة واحدة بهذا النموذج:\n\nالعميل: مؤسسة المثال\nكود العميل: 10021\nالجوال: 05xxxxxxxx\nالصنف: ${salesType==='block'?'بلوك 20 عادي':'خرسانة 350 مقاوم'}\nالكمية: ${salesType==='block'?'2000 حبة':'80 متر'}\nسعر الوحدة: ${salesType==='block'?'2.10':'245'}\nموعد التوريد: 2026-07-20 الساعة 8 صباحًا\nالموقع: نجران — حي ...\nطريقة الدفع: نقدي أو آجل\nملاحظات: ...\n\nاكتب «إلغاء» للخروج.`);
  }
}

async function saveDraftOrder(message,identity,session,text){
  const salesType=session.context?.salesType||roleSalesType(identity.role);
  if(!salesType)return sendMessage(message.chat.id,'تعذر تحديد قسم البيع. افتح قائمة المبيعات واختر بلوك أو خرسانة.');
  const order=parseOrder(text,salesType),missing=missingFields(order);
  if(missing.length)return sendMessage(message.chat.id,`البيانات التالية ناقصة أو غير واضحة:\n• ${missing.join('\n• ')}\n\nأعد إرسال النموذج كاملًا. لم يتم تسجيل الطلب.`);
  const reference=await nextReference(salesType);
  const draft={...order,reference_no:reference,created_at:now(),created_by_user_id:String(identity.user_id||''),sales_person_name:displayName(identity,message.from),sales_person_role:identity.role};
  await setSession(message.chat.id,identity.external_id||message.from.id,'sales_confirm_order',{draft,startedAt:now()});
  return sendMessage(message.chat.id,`<b>راجع أمر البيع قبل التسجيل</b>\n\n${orderSummary(draft)}\n\nلن يدخل سجل المتابعة إلا بعد التأكيد.`,keyboard([[{text:'تأكيد تسجيل أمر البيع',callback_data:`sales_confirm:${reference}`}],[{text:'إلغاء الأمر',callback_data:`sales_cancel:${reference}`}]]));
}

async function loadOrderEvents(reference=''){
  const refFilter=reference?`&entity_id=eq.${encodeURIComponent(reference)}`:'';
  return requiredSelect('audit_log',`action=in.(sales_order_created,sales_order_updated,sales_order_cancelled)&entity_type=in.(block_sales_order,concrete_sales_order)${refFilter}&select=action,entity_id,details,created_at&order=created_at.asc&limit=2000`,'سجل تدقيق أوامر البيع','SALES_AUDIT_READ_FAILED');
}
function reduceOrders(events=[]){
  const map=new Map();
  for(const event of events){
    const ref=String(event.entity_id||event.details?.reference_no||'');
    if(!ref)continue;
    map.set(ref,{...(map.get(ref)||{}),...(event.details||{}),reference_no:ref,last_event_at:event.created_at});
  }
  return [...map.values()];
}
async function loadSalesRows(reference=''){
  const filter=reference?`reference_no=eq.${encodeURIComponent(reference)}&`:'';
  return requiredSelect('sales_orders',`${filter}select=*&order=created_at.asc&limit=5000`,'جدول أوامر البيع','SALES_ORDERS_READ_FAILED');
}
async function syncLegacyOrders(reference=''){
  const events=reduceOrders(await loadOrderEvents(reference));if(!events.length)return[];
  const existing=await loadSalesRows(reference),known=new Set(existing.map(row=>String(row.reference_no))),failures=[];
  for(const order of events){
    if(known.has(String(order.reference_no)))continue;
    try{
      await persistSalesOrder(order,{chat:{id:order.chat_id||order.source_chat_id||''},message_id:order.source_message_id||'',from:{}},{user_id:order.created_by_user_id||null});
    }catch(error){failures.push({reference:order.reference_no,message:String(error?.message||'').slice(0,180)});}
  }
  if(failures.length)throw Object.assign(new Error(`تعذر ترحيل ${failures.length} أمر بيع قديم إلى الجدول الرئيسي. لم يصدر التقرير لتجنب عرض قائمة ناقصة.`),{status:503,code:'SALES_LEGACY_SYNC_FAILED',retryable:true,failures});
  return loadSalesRows(reference);
}
async function getOrder(reference){return(await loadSalesRows(reference))?.[0]||(await syncLegacyOrders(reference))?.[0]||reduceOrders(await loadOrderEvents(reference))[0]||null;}
async function getAllOrders(){const rows=await loadSalesRows();await syncLegacyOrders();const refreshed=await loadSalesRows();return refreshed.length?refreshed:rows.length?rows:reduceOrders(await loadOrderEvents());}

function statusFromUpdate(text=''){
  const t=normalize(text);
  if(/تم التحصيل|تحصل|سدد بالكامل/.test(t))return'collected';
  if(/صدر.*فاتور|تمت الفوتر|تم اصدار الفاتور/.test(t))return'invoiced';
  if(/تم التوريد|تم التسليم|وصل الموقع/.test(t))return'delivered';
  if(/خرج.*توريد|في الطريق|تم التحميل وخرج/.test(t))return'dispatched';
  if(/جاهز.*تحميل|جاهز للتوريد|تم التجهيز/.test(t))return'ready';
  if(/تحت الانتاج|جاري الانتاج|تحت التجهيز|جاري التجهيز/.test(t))return'in_production';
  if(/مجدول|تم تحديد الموعد|موعد التوريد/.test(t))return'scheduled';
  if(/مؤكد|تم التاكيد|اعتمد الطلب/.test(t))return'confirmed';
  if(/موقوف|تعليق|انتظار العميل/.test(t))return'on_hold';
  if(/ملغي|الغاء الطلب|العميل الغى/.test(t))return'cancelled';
  return'';
}
async function saveOrderUpdate(message,identity,text){
  const match=normalizeDigits(text).match(/BH-(?:BSO|CSO)-\d{4}-\d{5}/i);
  if(!match)return sendMessage(message.chat.id,'لم أجد رقم أمر بيع صحيح. أرسله مثل BH-BSO-2026-00015 ثم اكتب التحديث.');
  const reference=match[0].toUpperCase(),order=await getOrder(reference);
  if(!order)return sendMessage(message.chat.id,`لم أجد أمر البيع ${esc(reference)}.`);
  const ownType=roleSalesType(identity.role);
  if(ownType&&order.sales_type!==ownType)return sendMessage(message.chat.id,`هذا الطلب يتبع مبيعات ${TYPE_LABEL[order.sales_type]} وليس قسمك.`);
  const note=String(text).replace(match[0],'').trim()||'تحديث أمر البيع',nextStatus=statusFromUpdate(note)||order.status;
  const updated={...order,status:nextStatus,last_update_note:note,updated_at:now(),updated_by_user_id:String(identity.user_id||''),updated_by_name:displayName(identity,message.from)};
  await persistSalesOrder(updated,message,identity);
  await writeSalesLog({identity,message,action:nextStatus==='cancelled'?'sales_order_cancelled':'sales_order_updated',reference,order:updated});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  const accountingNote=nextStatus==='invoiced'?'\nتنبيه: تم تحديث حالة أمر البيع إلى «مفوتر». القيد المحاسبي الرسمي يرحّل من التقرير اليومي أو شاشة الاعتماد، وليس من تغيير الحالة وحده.':'';
  return sendMessage(message.chat.id,`تم تحديث أمر البيع <b>${esc(reference)}</b>.\nالحالة: <b>${esc(STATUS_LABEL[nextStatus]||nextStatus)}</b>\nالتحديث: ${esc(note)}${accountingNote}`);
}
async function requestTestDelete(message,identity,reference){
  if(identity.role!=='admin')return sendMessage(message.chat.id,'الحذف التجريبي متاح لمدير النظام فقط.');
  const order=await getOrder(reference);if(!order)return sendMessage(message.chat.id,`لم أجد أمر البيع ${esc(reference)}.`);
  if(PROTECTED_DELETE.has(order.status)||Number(order.paid_amount||0)>0)return sendMessage(message.chat.id,'لا يمكن حذف أمر مفوتر أو محصل. غيّر حالته إلى «ملغي» مع سبب، ويبقى الأثر الرقابي محفوظًا.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'sales_delete_confirm',{reference,order,startedAt:now()});
  return sendMessage(message.chat.id,`<b>حذف تجريبي نهائي</b>\n\n${orderSummary(order)}\n\nسيُحذف من جدول المبيعات وسجل العمليات وسجل التدقيق. اكتب حرفيًا:\n<code>تأكيد الحذف ${esc(reference)}</code>`);
}
async function hardDeleteTestOrder(message,identity,reference){
  const order=await getOrder(reference);if(!order)return sendMessage(message.chat.id,'أمر البيع غير موجود أو حُذف بالفعل.');
  if(identity.role!=='admin'||PROTECTED_DELETE.has(order.status)||Number(order.paid_amount||0)>0)return sendMessage(message.chat.id,'رفض الحذف لحماية البيانات المالية.');
  const results=await Promise.allSettled([
    remove('sales_orders',`reference_no=eq.${encodeURIComponent(reference)}`),
    remove('operational_records',`reference_no=eq.${encodeURIComponent(reference)}`),
    remove('audit_log',`entity_id=eq.${encodeURIComponent(reference)}&action=in.(sales_order_created,sales_order_updated,sales_order_cancelled)`),
    order.source_chat_id&&order.source_message_id?remove('telegram_messages',`chat_id=eq.${encodeURIComponent(String(order.source_chat_id))}&message_id=eq.${encodeURIComponent(String(order.source_message_id))}`):Promise.resolve([])
  ]);
  const failed=results.filter(row=>row.status==='rejected');
  try{await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);}catch(error){console.warn('[sales delete session cleanup]',String(error?.message||error).slice(0,180));}
  return sendMessage(message.chat.id,failed.length?`حُذف أمر البيع من السجلات الأساسية، لكن تعذر تنظيف ${failed.length} سجل مساعد. المرجع: <b>${esc(reference)}</b>`:`تم حذف أمر البيع التجريبي <b>${esc(reference)}</b> من المبيعات والموقع وسجل Telegram الداخلي. رسائل المحادثة القديمة نفسها قد تبقى داخل تطبيق Telegram.`);
}

export async function continueSalesSession(message,identity,session,text){
  const userId=identity.external_id||message.from.id,t=String(text||'').trim();
  if(/^(الغاء|إلغاء|الغي|الغى|تراجع|cancel)$/i.test(t)){
    await clearMaintenanceSession(message.chat.id,userId);
    await sendMessage(message.chat.id,'تم إلغاء عملية المبيعات الحالية.');
    return true;
  }
  if(session.state==='sales_new_order'){await saveDraftOrder(message,identity,session,t);return true;}
  if(session.state==='sales_update_order'){await saveOrderUpdate(message,identity,t);return true;}
  if(session.state==='sales_delete_reference'){
    const match=normalizeDigits(t).match(/BH-(?:BSO|CSO)-\d{4}-\d{5}/i);if(!match){await sendMessage(message.chat.id,'اكتب رقم أمر البيع كاملًا مثل BH-BSO-2026-00001.');return true;}
    await requestTestDelete(message,identity,match[0].toUpperCase());return true;
  }
  if(session.state==='sales_delete_confirm'){
    const reference=String(session.context?.reference||'');if(normalize(t)!==normalize(`تأكيد الحذف ${reference}`)){await sendMessage(message.chat.id,`للتأكيد اكتب: <code>تأكيد الحذف ${esc(reference)}</code> أو اكتب «إلغاء».`);return true;}
    await hardDeleteTestOrder(message,identity,reference);return true;
  }
  if(session.state==='sales_confirm_order'){
    await sendMessage(message.chat.id,'أمر البيع جاهز للتأكيد. استخدم زر «تأكيد تسجيل أمر البيع» أو اكتب «إلغاء».');
    return true;
  }
  return false;
}

export async function confirmSalesOrder(message,reference,identity){
  const session=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||message.from.id))}&select=*&limit=1`))?.[0];
  const draft=session?.state==='sales_confirm_order'?session.context?.draft:null;
  if(!draft||String(draft.reference_no)!==String(reference))return sendMessage(message.chat.id,'انتهت جلسة تأكيد أمر البيع. ابدأ أمرًا جديدًا من قائمة المبيعات.');
  const saved=await persistSalesOrder(draft,message,identity);
  await writeSalesLog({identity,message,action:'sales_order_created',reference,order:{...draft,...saved}});
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return sendMessage(message.chat.id,`تم تسجيل أمر البيع رسميًا في جدول المبيعات والموقع.\n\n${orderSummary({...draft,...saved})}\n\nيمكن تحديثه لاحقًا بكتابة «تحديث أمر بيع».`);
}
export async function cancelSalesDraft(message,identity){
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return sendMessage(message.chat.id,'تم إلغاء أمر البيع المؤقت ولم يدخل سجل المتابعة.');
}

function todayRiyadh(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(x=>x.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function scopedOrders(orders,identity,mode){
  const role=identity?.role||'',type=roleSalesType(role),userId=String(identity?.user_id||'');
  let rows=orders;
  if(type)rows=rows.filter(order=>order.sales_type===type);
  if(mode==='mine'&&userId)rows=rows.filter(order=>String(order.sales_person_user_id||order.created_by_user_id||'')===userId);
  return rows;
}
export async function sendSalesOrdersList(chatId,identity,mode='open'){
  const today=todayRiyadh();
  let orders=scopedOrders(await getAllOrders(),identity,mode);
  const product=mode==='open_concrete'?'concrete':mode==='open_block'?'block':'';
  if(product)orders=orders.filter(order=>order.sales_type===product);
  if(mode==='overdue')orders=orders.filter(order=>!CLOSED.has(order.status)&&order.delivery_date&&order.delivery_date<today);
  else orders=orders.filter(order=>!CLOSED.has(order.status));
  orders.sort((a,b)=>String(a.delivery_date||'9999').localeCompare(String(b.delivery_date||'9999')));
  if(!orders.length)return sendMessage(chatId,mode==='overdue'?'لا توجد أوامر بيع متأخرة ضمن صلاحيتك.':'لا توجد أوامر بيع مفتوحة ضمن صلاحيتك.');
  const title=mode==='overdue'?'أوامر البيع المتأخرة':mode==='mine'?'طلباتك المفتوحة':mode==='open_concrete'?'أوامر الخرسانة المفتوحة':mode==='open_block'?'أوامر البلوك المفتوحة':'أوامر البيع المفتوحة';
  const body=orders.slice(0,15).map((order,index)=>`${index+1}. ${orderSummary(order)}`).join('\n\n');
  return sendMessage(chatId,`<b>${title}</b> — ${orders.length}\n\n${body}`.slice(0,3900));
}

export async function sendExecutiveSalesStatus(chatId,identity){
  const today=todayRiyadh(),orders=scopedOrders(await getAllOrders(),identity,'summary');
  const open=orders.filter(order=>!CLOSED.has(order.status)),createdToday=orders.filter(order=>String(order.created_at||'').slice(0,10)===today),dueToday=open.filter(order=>order.delivery_date===today),overdue=open.filter(order=>order.delivery_date&&order.delivery_date<today),deliveredToday=orders.filter(order=>order.status==='delivered'&&String(order.updated_at||order.last_event_at||'').slice(0,10)===today);
  const totals={block:0,concrete:0};
  for(const order of createdToday)totals[order.sales_type]=(totals[order.sales_type]||0)+Number(order.total_amount||0);
  const employees=new Map();
  for(const order of orders){
    const name=order.sales_person_name||'موظف مبيعات',item=employees.get(name)||{block:0,concrete:0,open:0,overdue:0,total:0};
    item[order.sales_type]=(item[order.sales_type]||0)+1;
    if(!CLOSED.has(order.status))item.open++;
    if(!CLOSED.has(order.status)&&order.delivery_date&&order.delivery_date<today)item.overdue++;
    if(String(order.created_at||'').slice(0,10)===today)item.total+=Number(order.total_amount||0);
    employees.set(name,item);
  }
  let text=`<b>الحالة التنفيذية لأوامر البيع</b>\n\n<b>نشاط اليوم</b>\n• أوامر جديدة: <b>${createdToday.length}</b>\n• قيمة بلوك تقديرية: <b>${formatMoney(totals.block)} ر.س</b>\n• قيمة خرسانة تقديرية: <b>${formatMoney(totals.concrete)} ر.س</b>\n• توريدات مستحقة اليوم: <b>${dueToday.length}</b>\n• تم توريدها اليوم: <b>${deliveredToday.length}</b>\n\n<b>المتابعة المفتوحة</b>\n• إجمالي الطلبات المفتوحة: <b>${open.length}</b>\n• متأخرة عن موعد التوريد: <b>${overdue.length}</b>\n• خرجت للتوريد: <b>${open.filter(x=>x.status==='dispatched').length}</b>\n• تحت الإنتاج/التجهيز: <b>${open.filter(x=>x.status==='in_production').length}</b>\n• موقوفة: <b>${open.filter(x=>x.status==='on_hold').length}</b>`;
  if(employees.size){
    text+='\n\n<b>متابعة موظفي المبيعات</b>';
    for(const [name,item] of [...employees.entries()].slice(0,10))text+=`\n• <b>${esc(name)}</b>: بلوك ${item.block}، خرسانة ${item.concrete}، مفتوح ${item.open}، متأخر ${item.overdue}، قيمة اليوم ${formatMoney(item.total)} ر.س`;
  }
  const critical=[...overdue,...dueToday.filter(order=>!overdue.includes(order))].slice(0,8);
  if(critical.length){
    text+='\n\n<b>طلبات تحتاج متابعة</b>';
    for(const order of critical)text+=`\n• <b>${esc(order.reference_no)}</b> — ${esc(order.customer_name)} — ${esc(TYPE_LABEL[order.sales_type])}\n  موعد ${esc(order.delivery_date)} | ${esc(STATUS_LABEL[order.status]||order.status)} | ${esc(order.item)} ${esc(order.quantity_text)}`;
  }
  const actions=[];
  if(overdue.length)actions.push(`مراجعة ${overdue.length} طلب متأخر وتحديد سبب التأخير وموعد بديل.`);
  if(dueToday.length)actions.push(`تأكيد جاهزية الإنتاج والنقل لـ ${dueToday.length} توريد مستحق اليوم.`);
  if(open.some(x=>!x.unit_price))actions.push('استكمال الأسعار الناقصة قبل اعتماد الفواتير.');
  if(!actions.length)actions.push('لا يظهر تأخير حرج؛ استمر في تحديث الحالات حتى التوريد والتحصيل.');
  text+='\n\n<b>الإجراءات المقترحة</b>\n'+actions.map(action=>`• ${esc(action)}`).join('\n');
  text+='\n\nالملخص مبني على جدول أوامر البيع الفعلي، مع مزامنة السجلات القديمة من Telegram.';
  return sendMessage(chatId,text.slice(0,3900));
}

export async function handleSalesTextCommand(message,identity,text){
  const role=identity?.role||'pending',raw=String(text||'').trim(),t=normalize(text);
  if(/^\/(?:sales)(?:@\w+)?$/i.test(raw)||/^(قائمه المبيعات|قائمة المبيعات|موظف المبيعات|اوامر البيع|أوامر البيع)$/.test(t)){await showSalesMenu(message,identity);return true;}
  if(/^(حاله المبيعات|وضع المبيعات|وضع موظفي المبيعات|متابعه موظفي المبيعات|متابعة موظفي المبيعات|حاله اوامر البيع|حالة أوامر البيع)$/.test(t)){
    if(!canViewSales(role))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض حالة أوامر البيع.').then(()=>true);
    await sendExecutiveSalesStatus(message.chat.id,identity);return true;
  }
  if(/^(طلباتي المفتوحه|طلباتي المفتوحة|اوامري المفتوحه|أوامري المفتوحة)$/.test(t)){
    if(!isSalesOperator(role))return sendMessage(message.chat.id,'هذا الأمر مخصص لموظفي المبيعات.').then(()=>true);
    await sendSalesOrdersList(message.chat.id,identity,'mine');return true;
  }
  if(/^(الطلبات المتاخره|الطلبات المتأخرة|اوامر البيع المتاخره|أوامر البيع المتأخرة)$/.test(t)){
    if(!canViewSales(role))return sendMessage(message.chat.id,'ليست لديك صلاحية عرض الطلبات المتأخرة.').then(()=>true);
    await sendSalesOrdersList(message.chat.id,identity,'overdue');return true;
  }
  const deleteMatch=normalizeDigits(raw).match(/^(?:حذف|مسح)\s+(?:امر|أمر)\s+بيع(?:\s+تجريبي)?\s+(BH-(?:BSO|CSO)-\d{4}-\d{5})$/i);
  if(deleteMatch){await requestTestDelete(message,identity,deleteMatch[1].toUpperCase());return true;}
  const invoiceMatch=normalizeDigits(raw).match(/^(?:اصدار|إصدار|تسجيل)\s+فاتور[ةه]\s+(BH-(?:BSO|CSO)-\d{4}-\d{5})$/i);
  if(invoiceMatch){await saveOrderUpdate(message,identity,`${invoiceMatch[1]} تم إصدار الفاتورة`);return true;}
  if(/^(تحديث امر بيع|تحديث أمر بيع|تحديث طلب بيع)$/.test(t)){await startSalesAction(message,identity,'update');return true;}
  if(/^(حذف امر بيع تجريبي|حذف أمر بيع تجريبي|مسح امر بيع|مسح أمر بيع)$/.test(t)){await startSalesAction(message,identity,'delete');return true;}
  if(/^(امر بيع جديد|أمر بيع جديد|تسجيل طلب بيع|طلب بيع جديد)$/.test(t)){
    const type=roleSalesType(role);
    if(!type){await showSalesMenu(message,identity);return true;}
    await startSalesAction(message,identity,`new_${type}`);return true;
  }
  if(/^(امر بيع بلوك|أمر بيع بلوك|طلب بيع بلوك)$/.test(t)){await startSalesAction(message,identity,'new_block');return true;}
  if(/^(امر بيع خرسانه|أمر بيع خرسانة|طلب بيع خرسانه|طلب بيع خرسانة)$/.test(t)){await startSalesAction(message,identity,'new_concrete');return true;}
  return false;
}
