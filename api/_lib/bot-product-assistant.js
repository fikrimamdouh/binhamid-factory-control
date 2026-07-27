import { select, insert } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { identifyProductImage } from './product-image-identification.js';
import { researchProductMarket } from './product-market-research-fast.js';

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

export async function sendProductResearch(message,identity,query,city='نجران'){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'بحث قطع الغيار والموردين غير متاح لدورك الحالي.');
  const clean=String(query||'').trim();
  if(clean.length<2)return sendMessage(message.chat.id,'اكتب اسم الصنف أو رقم القطعة بصورة أوضح.');
  // محرك أسعار السوق كان مبنيًا وغير موصول إطلاقًا، فكان المستخدم يُحال دائمًا إلى
  // «السعر يتأكد بالاتصال». الآن يُستدعى فعليًا ويُعرض السعر المعتاد ونطاقه ومصادره.
  await sendMessage(message.chat.id,`💰 <b>جارٍ البحث عن أسعار: ${esc(clean)}</b>\n<i>أبحث في المتاجر المنشورة… قد يستغرق نصف دقيقة.</i>`);
  let research;
  try{research=await researchProductMarket(clean,{city});}
  catch(error){
    await sendMessage(message.chat.id,`⚠️ ${esc(error?.message||'تعذر بحث الأسعار الآن.')}`);
    await setSession(message.chat.id,identity.external_id||message.from.id,'supplier_search_city',{query:clean,startedAt:now(),source:'price_research_failed'});
    return sendMessage(message.chat.id,'أعرض لك الموردين للاتصال بهم مباشرة — اختر المدينة:',supplierCityKeyboard());
  }
  // لا روابط ولا مصادر خارجية: كل شيء يبقى داخل البوت. تُعرض الأرقام فقط،
  // وأي رابط يظهر داخل نص المحرك يُجرَّد قبل الإرسال.
  const priced=String(research.text||'').replace(/https?:\/\/\S+/g,'').replace(/[ \t]{2,}/g,' ').trim();
  const body=['💰 <b>أسعار السوق</b>','━━━━━━━━━━━━━━━',`🔩 <b>${esc(clean)}</b>`,'',esc(priced).slice(0,2800),
    '━━━━━━━━━━━━━━━','<i>الأسعار استرشادية؛ السعر النهائي بعرض سعر رسمي.</i>'].filter(Boolean).join('\n');
  await sendMessage(message.chat.id,body.slice(0,3900));
  await setSession(message.chat.id,identity.external_id||message.from.id,'supplier_search_city',{query:clean,startedAt:now(),source:'price_research'});
  return sendMessage(message.chat.id,'لعرض موردين محليين وأرقامهم — اختر المدينة:',supplierCityKeyboard());
}


export async function handleProductImage(message,identity,buffer,mimeType='image/jpeg'){
  if(!canUseProductAssistant(identity))return false;
  await sendMessage(message.chat.id,'تم استلام صورة القطعة. جارٍ قراءة الاسم والأرقام...');
  let identified;try{identified=await identifyProductImage(buffer,mimeType,message.caption||'');}catch(error){await sendMessage(message.chat.id,esc(error.message||'تعذر تحليل صورة القطعة.'));return true;}
  const confidence={high:'عالية',medium:'متوسطة',low:'محدودة'}[identified.confidence]||identified.confidence;
  const query=String(identified.query||identified.identification||identified.codes||'').trim();
  if(query.length<2){await sendMessage(message.chat.id,'لم أستطع استخراج اسم أو رقم كافٍ من الصورة. أرسل صورة أوضح للملصق أو اكتب رقم القطعة.');return true;}
  await setSession(message.chat.id,identity.external_id||message.from.id,'supplier_search_city',{query,startedAt:now(),source:'product_image',identification:identified.identification,codes:identified.codes});
  // نعرض الماركة والمعدة صراحةً — فهما ما يحدد جودة النتائج — ونطلبهما إن غابتا
  // بدل إرسال المستخدم إلى بحث عام لا يفيده في الشراء.
  const missing=[!identified.brand?'الماركة':null,!identified.equipment?'نوع المعدة':null].filter(Boolean);
  const body=[
    '📷 <b>قراءة الصورة</b>',
    '━━━━━━━━━━━━━━━',
    `🔩 القطعة: <b>${esc(identified.identification)}</b>`,
    identified.brand?`🏷️ الماركة: <b>${esc(identified.brand)}</b>`:null,
    identified.equipment?`🚜 المعدة: <b>${esc(identified.equipment)}</b>`:null,
    `🔢 الأكواد: ${copyable(identified.codes||'لم يظهر رقم كامل')}`,
    `📊 الثقة: <b>${esc(confidence)}</b>`,
    '━━━━━━━━━━━━━━━',
    missing.length
      ?`✍️ اكتب <b>${esc(missing.join(' و'))}</b> لنتائج أدق (مثال: «شيول فولفو») — أو اختر المدينة مباشرة:`
      :'اختر مدينة البحث:'
  ].filter(Boolean).join('\n');
  return sendMessage(message.chat.id,body,supplierCityKeyboard());
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
