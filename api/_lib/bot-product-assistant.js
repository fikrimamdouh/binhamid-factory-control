import { select, insert } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { identifyProductImage } from './product-image-identification.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const USE_ROLES=new Set(['admin','manager','accountant','mechanic','procurement','warehouse']);
export const canUseProductAssistant=identity=>Boolean(identity?.active&&USE_ROLES.has(identity.role));
const copyable=value=>esc(value).replace(/(\+?\d[\d\s().-]{6,}\d)/g,'<code>$1</code>');

function supplierCityKeyboard(){return keyboard([
  [{text:'نجران',callback_data:'supplier_city:najran'},{text:'خميس مشيط',callback_data:'supplier_city:khamis'}],
  [{text:'الرياض',callback_data:'supplier_city:riyadh'},{text:'جدة',callback_data:'supplier_city:jeddah'}],
  [{text:'الدمام',callback_data:'supplier_city:dammam'},{text:'كل السعودية',callback_data:'supplier_city:saudi'}],
  [{text:'مدينة أخرى',callback_data:'supplier_city:other'}]
]);}

async function getSession(chatId,userId){return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function setSession(chatId,userId,state,context={}){
  const old=await getSession(chatId,userId),aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}

export function productAssistantButton(){return{text:'بحث قطعة ومورد',callback_data:'proc:product'};}
export async function startProductAssistant(message,identity){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'بحث قطع الغيار والموردين متاح للمشتريات والورشة والإدارة والمحاسب.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'supplier_search_query',{startedAt:now(),source:'workshop_product'});
  return sendMessage(message.chat.id,'اكتب اسم القطعة أو رقمها والماركة إن وجدت. سأعرض الموردين وأرقام الاتصال داخل البوت فقط، دون فتح مواقع خارجية أو تخمين سعر.\n\nأمثلة:\nفلتر زيت Hino 500 رقم 15613-E0110\nرولمان بلي 6205 SKF\nإطار 12R22.5 بريدجستون',keyboard([[{text:'البحث بصورة القطعة',callback_data:'proc:product_image'}]]));
}

export async function startProductImageAssistant(message,identity){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'البحث بصورة القطعة غير متاح لدورك الحالي.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_image_waiting',{startedAt:now()});
  return sendMessage(message.chat.id,'أرسل صورة القطعة أو الملصق. سأستخرج الاسم أو الرقم، ثم تختار المدينة لعرض الموردين وأرقام الاتصال داخل البوت.');
}

export async function sendProductResearch(message,identity,query){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'بحث قطع الغيار والموردين غير متاح لدورك الحالي.');
  const clean=String(query||'').trim();
  if(clean.length<2)return sendMessage(message.chat.id,'اكتب اسم الصنف أو رقم القطعة بصورة أوضح.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'supplier_search_city',{query:clean,startedAt:now(),source:'direct_product_query'});
  return sendMessage(message.chat.id,`القطعة: <b>${esc(clean)}</b>\n\nاختر مدينة البحث. ستظهر أسماء الموردين وأرقام الجوال داخل البوت، والسعر يُؤكد بالاتصال حتى لا يُعرض رقم غير موثوق.`,supplierCityKeyboard());
}

export async function handleProductImage(message,identity,buffer,mimeType='image/jpeg'){
  if(!canUseProductAssistant(identity))return false;
  await sendMessage(message.chat.id,'تم استلام صورة القطعة. جارٍ قراءة الاسم والأرقام...');
  let identified;try{identified=await identifyProductImage(buffer,mimeType,message.caption||'');}catch(error){await sendMessage(message.chat.id,esc(error.message||'تعذر تحليل صورة القطعة.'));return true;}
  const confidence={high:'عالية',medium:'متوسطة',low:'محدودة'}[identified.confidence]||identified.confidence;
  const query=String(identified.query||identified.identification||identified.codes||'').trim();
  if(query.length<2){await sendMessage(message.chat.id,'لم أستطع استخراج اسم أو رقم كافٍ من الصورة. أرسل صورة أوضح للملصق أو اكتب رقم القطعة.');return true;}
  await setSession(message.chat.id,identity.external_id||message.from.id,'supplier_search_city',{query,startedAt:now(),source:'product_image',identification:identified.identification,codes:identified.codes});
  return sendMessage(message.chat.id,`<b>نتيجة قراءة الصورة</b>\nالقطعة: <b>${esc(identified.identification)}</b>\nالأكواد: ${copyable(identified.codes||'لم يظهر رقم كامل')}\nدرجة الثقة: <b>${esc(confidence)}</b>\nعبارة البحث: <code>${esc(query)}</code>\n\nاختر المدينة لعرض الموردين وأرقام الاتصال داخل البوت:`,supplierCityKeyboard());
}

export async function continueProductAssistant(message,identity,session,text){
  if(session?.state==='product_image_waiting'){await sendMessage(message.chat.id,'أرسل صورة القطعة نفسها، أو اكتب «إلغاء».');return true;}
  if(session?.state!=='product_market_query')return false;
  const query=String(text||'').trim();
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(query)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء البحث.');return true;}
  await sendProductResearch(message,identity,query);return true;
}

export async function handleProductTextCommand(message,identity,text){
  const raw=String(text||'').trim(),normalized=raw.toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
  const direct=raw.match(/^(?:سعر|اسعار|أسعار|ابحث عن سعر|بحث سعر|قارن اسعار|قارن أسعار|سعر السوق|القطعه دي سعرها|القطعة دي سعرها)\s+(.{2,})$/i);
  if(direct){await sendProductResearch(message,identity,direct[1]);return true;}
  if(/^(بحث بالصوره|بحث بالصورة|ابحث بالصوره|ابحث بالصورة|صوره قطعه|صورة قطعة|بحث صوره قطعه|بحث صورة قطعة)$/.test(normalized)){await startProductImageAssistant(message,identity);return true;}
  if(/^(مساعد المنتجات|مساعد الاسعار|مساعد الأسعار|بحث المنتجات|اسعار المنتجات|أسعار المنتجات|بحث قطعه|بحث قطعة)$/.test(normalized)){await startProductAssistant(message,identity);return true;}
  return false;
}
