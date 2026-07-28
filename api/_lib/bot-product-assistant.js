import { select, insert } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { identifyProductImage } from './product-image-identification.js';
import { researchProductMarket } from './product-market-research-fast.js';
import { researchProductMarketFree } from './product-market-research-free.js';
import { directBusinessSearchCity, sendDeepBusinessResults } from './bot-business-directory-flow.js';
import { config } from './config.js';

async function researchPrices(query,city){
  const DEADLINE=Date.now()+45000;
  const providers=[];
  if(config.openaiKey)providers.push(['openai',()=>researchProductMarket(query,{city})]);
  if(config.geminiKey)providers.push(['gemini',remaining=>researchProductMarketFree(query,{city,budgetMs:remaining})]);
  if(!providers.length)throw Object.assign(new Error('بحث الأسعار غير مفعّل. اضبط OPENAI_API_KEY أو GEMINI_API_KEY.'),{status:503,code:'PRICE_RESEARCH_NOT_CONFIGURED'});
  let lastError=null;
  for(const[name,run]of providers){
    const remaining=DEADLINE-Date.now();
    if(remaining<6000)break;
    try{return await run(remaining);}
    catch(error){lastError=error;console.warn('[price research provider]',{provider:name,message:String(error?.message||'').slice(0,200)});}
  }
  throw lastError||Object.assign(new Error('تعذر بحث الأسعار الآن.'),{status:502,code:'PRICE_RESEARCH_FAILED'});
}

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const USE_ROLES=new Set(['admin','manager','accountant','mechanic','procurement','warehouse']);
export const canUseProductAssistant=identity=>Boolean(identity?.active&&USE_ROLES.has(identity.role));
const copyable=value=>esc(value).replace(/(\+?\d[\d\s().-]{6,}\d)/g,'<code>$1</code>');
const MARKET_HINT=/سعر|اسعار|أسعار|ثمن|تكلفه|تكلفة|قطعه|قطعة|قطع غيار|عمود|كردان|فلتر|رولمان|بلي|سير|بطاري|كاوتش|كفر|اطار|إطار|خرطوم|هيدروليك|طلمب|مضخ|موتور|محرك|صمام|بلف|ترس|جربوكس|جير|كلتش|فرامل|مسمار|صامول|لحام|كمبروسر|زيت|شحم|بوهيه|بويه|دهان|حديد|صاج|رمان|بلية|بليه|bearing|filter|pump|motor|gear|shaft|spare part/i;
const NON_MARKET_HINT=/تقرير|اقرار|إقرار|كشف حساب|رصيد|تحصيل|سداد|فاتور|عميل|خزين|بنك|ديزل|وقود|حضور|انصراف|اعتماد|خطاب|ميزاني|مديوني|محفظه|محفظة/i;
const GENERIC_PRODUCT_COMMAND=/^(?:مساعد المنتجات|مساعد الاسعار|مساعد الأسعار|بحث المنتجات|اسعار المنتجات|أسعار المنتجات|بحث قطعه|بحث قطعة|بحث سعر|طلب عرض سعر|طلب اسعار|طلب أسعار|طلبات الاسعار المفتوحه|طلبات الأسعار المفتوحة)$/i;

async function getSession(chatId,userId){return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function setSession(chatId,userId,state,context={}){
  const old=await getSession(chatId,userId),aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}

function stripSearchNoise(value=''){
  return String(value||'').trim()
    .replace(/^[\s:،,-]+|[\s؟?!.,،؛:]+$/g,'')
    .replace(/^(?:(?:انا|إنا)\s+)?(?:(?:محتاج|عاوز|عايز|اريد|أريد|ابغى|أبغى)\s+)?(?:(?:انك|إنك|عاوزك|عايزك|محتاجك|اريدك|أريدك|ابغاك|أبغاك)\s+)?(?:(?:تبحث|ابحث|إبحث|دور|دوّر|فتش|فتّش|شوف|هات|هاتلي|هات لي|جيب|جيبلي|جيب لي)\s*)?(?:لي|لنا)?\s*(?:عن|على|في)?\s*/i,'')
    .replace(/^(?:السعر|سعر|اسعار|أسعار|ثمن|تكلفة|تكلفه|قارن\s+اسعار|قارن\s+أسعار|سعر\s+السوق)\s*(?:لـ?|عن|على)?\s*/i,'')
    .replace(/^(?:انا|إنا)\s+(?:محتاج|عاوز|عايز|اريد|أريد|ابغى|أبغى)\s*/i,'')
    .replace(/\s+(?:في\s+)?(?:نجران|خميس\s+مشيط|الرياض|جده|جدة|الدمام|كل\s+السعوديه|كل\s+السعودية|السعودية|السعوديه)\s*$/i,'')
    .replace(/\s+(?:لو سمحت|من فضلك|بالله|كده|كذا)$/i,'')
    .trim();
}

export function extractProductMarketQuery(text=''){
  const raw=String(text||'').replace(/\s+/g,' ').trim();
  if(!raw||GENERIC_PRODUCT_COMMAND.test(raw))return'';
  if(NON_MARKET_HINT.test(raw)&&!/سعر|اسعار|أسعار|قطعه|قطعة|قطع غيار/i.test(raw))return'';
  if(!MARKET_HINT.test(raw))return'';
  const query=stripSearchNoise(raw);
  return query.length>=2?query.slice(0,300):'';
}

export function productAssistantButton(){return{text:'بحث أسعار وقطع',callback_data:'proc:product'};}
export async function startProductAssistant(message,identity){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'بحث الأسعار والقطع والموردين متاح للمشتريات والورشة والإدارة والمحاسب.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_market_query',{startedAt:now(),source:'direct_market_search'});
  return sendMessage(message.chat.id,'اكتب اسم القطعة أو الصنف ورقمه والماركة والمقاس المتاح لديك. سأبحث مباشرة عن الأسعار المنشورة، ثم المحلات والموردين وأرقام الاتصال.\n\nأمثلة:\nعمود كردان بطول 50 سم\nفلتر زيت Hino 500 رقم 15613-E0110\nرولمان بلي 6205 SKF',keyboard([[{text:'البحث بصورة القطعة',callback_data:'proc:product_image'}]]));
}

export async function startProductImageAssistant(message,identity){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'البحث بصورة القطعة غير متاح لدورك الحالي.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_image_waiting',{startedAt:now()});
  return sendMessage(message.chat.id,'أرسل صورة القطعة أو الملصق. سأستخرج الاسم والرقم ثم أبحث تلقائيًا عن الأسعار والموردين.');
}

function cleanResearchText(value=''){
  return String(value||'')
    .replace(/https?:\/\/\S+/g,'')
    .replace(/يلزم طلب عرض سعر مباشر\.?/gi,'لم يظهر سعر منشور موثوق؛ راجع الموردين والمحلات أدناه.')
    .replace(/اطلب عرض سعر من الموردين أدناه للحصول على السعر الفعلي\.?/gi,'راجع الموردين والمحلات أدناه لمعرفة السعر المتاح حاليًا.')
    .replace(/[ \t]{2,}/g,' ')
    .trim();
}

export async function sendProductResearch(message,identity,query,city='كل السعودية'){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'بحث الأسعار والقطع والموردين غير متاح لدورك الحالي.');
  const clean=String(query||'').trim();
  if(clean.length<2)return sendMessage(message.chat.id,'اكتب اسم الصنف أو رقم القطعة بصورة أوضح.');
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id).catch(()=>{});
  await sendMessage(message.chat.id,`<b>جارٍ البحث عن أسعار وموردين: ${esc(clean)}</b>\n<i>أفحص الأسعار المنشورة والمتاجر والموردين والمحلات.</i>`,{disable_voice_reply:true});

  const supplierPromise=sendDeepBusinessResults(message,identity,clean,city).catch(error=>{
    console.warn('[product supplier research]',{message:String(error?.message||error).slice(0,220)});
    return[];
  });
  let research=null;
  try{research=await researchPrices(clean,city);}
  catch(error){
    console.warn('[product price research]',{message:String(error?.message||error).slice(0,220)});
    await sendMessage(message.chat.id,'لم يكتمل رصد أسعار منشورة موثوقة الآن. يستمر البحث عن المحلات والموردين وأرقام الاتصال.');
  }

  if(research){
    const priced=cleanResearchText(research.text||'');
    const body=['<b>أسعار السوق المنشورة</b>','━━━━━━━━━━━━━━━',`<b>${esc(clean)}</b>`,'',esc(priced).slice(0,3000),'━━━━━━━━━━━━━━━','<i>الأسعار المنشورة استرشادية وقد تتغير حسب المواصفة والتوفر والشحن.</i>'].filter(Boolean).join('\n');
    await sendMessage(message.chat.id,body.slice(0,3900));
  }

  const businesses=await supplierPromise;
  return{research,businesses};
}

export async function handleProductImage(message,identity,buffer,mimeType='image/jpeg'){
  if(!canUseProductAssistant(identity))return false;
  await sendMessage(message.chat.id,'تم استلام صورة القطعة. جارٍ قراءة الاسم والأرقام...',{disable_voice_reply:true});
  let identified;
  try{identified=await identifyProductImage(buffer,mimeType,message.caption||'');}
  catch(error){await sendMessage(message.chat.id,esc(error.message||'تعذر تحليل صورة القطعة.'));return true;}
  const confidence={high:'عالية',medium:'متوسطة',low:'محدودة'}[identified.confidence]||identified.confidence;
  const query=String(identified.query||identified.identification||identified.codes||'').trim();
  if(query.length<2){await sendMessage(message.chat.id,'لم أستطع استخراج اسم أو رقم كافٍ من الصورة. أرسل صورة أوضح للملصق أو اكتب رقم القطعة.');return true;}
  const body=[
    '<b>قراءة الصورة</b>','━━━━━━━━━━━━━━━',
    `القطعة: <b>${esc(identified.identification)}</b>`,
    identified.brand?`الماركة: <b>${esc(identified.brand)}</b>`:null,
    identified.equipment?`المعدة: <b>${esc(identified.equipment)}</b>`:null,
    `الأكواد: ${copyable(identified.codes||'لم يظهر رقم كامل')}`,
    `الثقة: <b>${esc(confidence)}</b>`,
    '━━━━━━━━━━━━━━━','سأبدأ البحث بالبيانات الظاهرة في الصورة.'
  ].filter(Boolean).join('\n');
  await sendMessage(message.chat.id,body);
  await sendProductResearch(message,identity,query,directBusinessSearchCity(message.caption||'',query));
  return true;
}

export async function continueProductAssistant(message,identity,session,text){
  if(session?.state==='product_image_waiting'){
    if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(String(text||'').trim())){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء البحث.');return true;}
    await sendMessage(message.chat.id,'أرسل صورة القطعة نفسها، أو اكتب «إلغاء».');return true;
  }
  if(!['product_market_query','supplier_search_query'].includes(session?.state))return false;
  const query=String(text||'').trim();
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(query)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء البحث.');return true;}
  const clean=extractProductMarketQuery(query)||stripSearchNoise(query)||query;
  await sendProductResearch(message,identity,clean,directBusinessSearchCity(query,clean));return true;
}

export async function handleProductTextCommand(message,identity,text){
  const raw=String(text||'').trim(),normalized=raw.toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
  if(/^(بحث بالصوره|بحث بالصورة|ابحث بالصوره|ابحث بالصورة|صوره قطعه|صورة قطعة|بحث صوره قطعه|بحث صورة قطعة)$/.test(normalized)){await startProductImageAssistant(message,identity);return true;}
  if(GENERIC_PRODUCT_COMMAND.test(normalized)){await startProductAssistant(message,identity);return true;}
  const query=extractProductMarketQuery(raw);
  if(!query)return false;
  await sendProductResearch(message,identity,query,directBusinessSearchCity(raw,query));return true;
}
