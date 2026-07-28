import { insert,select } from './supabase.js';
import { sendMessage,keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { searchComprehensiveBusinessDirectory } from './bot-business-directory.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const CITY_LABELS={najran:'نجران',riyadh:'الرياض',jeddah:'جدة',dammam:'الدمام',khamis:'خميس مشيط',saudi:'كل السعودية'};
const DEEP_STATES=new Set(['business_search_query','business_search_city','business_search_custom_city','business_search_results']);
const DIRECT_SEARCH_PATTERNS=[
  /^(?:(?:انا|إنا)\s+)?(?:(?:محتاج|عاوز|اريد|أريد|ابغى|أبغى)\s+)?(?:(?:انك|إنك)\s+)?(?:تبحث|ابحث|إبحث|دور|دوّر|تدور|فتش|فتّش)\s*(?:لي|لنا)?\s*(?:عن|على|في)?\s+(.{2,})$/i,
  /^(?:فين|وين)\s+(?:الاقي|ألاقي|اجد|أجد|احصل|أحصل)\s*(?:على)?\s+(.{2,})$/i,
  /^(?:هات|هاتلي|هات لي|جيب|جيبلي|جيب لي)\s+(?:(?:شركات|محلات|مصانع|موردين|وكلاء|موزعين)\s*)?(?:عن|لـ?|بتوع)?\s*(.{2,})$/i
];
const PROCUREMENT_HINT=/عمود|كردان|قطعه|قطعة|فلتر|رولمان|بلي|سير|بطاري|كاوتش|كفر|اطار|إطار|خرطوم|هيدروليك|طلمب|مضخ|موتور|محرك|صمام|بلف|ترس|جربوكس|جير|كلتش|فرامل|مسمار|صامول|لحام|كمبروسر|شركة|شركه|مصنع|مورد|وكيل|موزع|محل|ورشه|ورشة|اشتري|شراء|سعر/i;
const NON_MARKET_HINT=/تقرير|اقرار|إقرار|كشف حساب|رصيد|تحصيل|سداد|فاتور|عميل|خزين|بنك|ديزل|وقود|حضور|انصراف|اعتماد|خطاب|ميزاني|مديوني|محفظه|محفظة/i;
const CITY_PATTERNS=[
  ['نجران',/\b(?:في\s+)?نجران\b/i],['خميس مشيط',/\b(?:في\s+)?خميس\s+مشيط\b/i],['الرياض',/\b(?:في\s+)?الرياض\b/i],['جدة',/\b(?:في\s+)?جده|جدة\b/i],['الدمام',/\b(?:في\s+)?الدمام\b/i],['كل السعودية',/\b(?:في\s+)?كل\s+السعوديه|السعودية|السعوديه\b/i]
];

function trimSearchQuery(value=''){
  return clean(value,300).replace(/^[\s:،,-]+|[\s؟?!.,،؛:]+$/g,'').replace(/\s+(?:لو سمحت|من فضلك|بالله|كده|كذا)$/i,'').trim();
}
export function extractDirectBusinessSearchQuery(text=''){
  const raw=clean(text,600).replace(/\s+/g,' ').trim();
  if(!raw)return'';
  for(const pattern of DIRECT_SEARCH_PATTERNS){const match=raw.match(pattern),query=trimSearchQuery(match?.[1]);if(query)return query;}
  const need=raw.match(/^(?:محتاج|عاوز|اريد|أريد|ابغى|أبغى)\s+(.{2,})$/i),query=trimSearchQuery(need?.[1]);
  if(query&&PROCUREMENT_HINT.test(query)&&!NON_MARKET_HINT.test(query))return query;
  return'';
}
export function directBusinessSearchCity(text='',query=''){
  const raw=clean(text,600);
  for(const[city,pattern]of CITY_PATTERNS)if(pattern.test(raw))return city;
  return'كل السعودية';
}

function callable(phone){
  const raw=String(phone||'').replace(/[^\d+]/g,'');
  if(!raw)return'';
  if(raw.startsWith('+'))return raw;
  if(raw.startsWith('00'))return`+${raw.slice(2)}`;
  if(raw.startsWith('05')&&raw.length===10)return`+966${raw.slice(1)}`;
  if(raw.startsWith('966'))return`+${raw}`;
  return raw;
}
function sourceLabel(type,origin){
  if(origin==='combined')return'مصدر رسمي + دليل أماكن';
  return({official_company:'موقع الشركة',official_registry:'سجل رسمي',chamber:'غرفة تجارية',industry_directory:'دليل صناعي',business_directory:'دليل أعمال',marketplace:'منصة متخصصة',social:'صفحة موثقة',google_places:'دليل الأماكن'}[type]||'مصدر ويب منشور');
}
function confidenceLabel(value){return({high:'مرتفعة',medium:'متوسطة',low:'محدودة'}[String(value||'').toLowerCase()]||'محدودة');}
function resultCard(row,index){
  const tel=callable(row.phone),phone=tel?`📞 <a href="tel:${esc(tel)}">${esc(row.phone)}</a>`:'📞 الهاتف غير منشور';
  const rating=row.rating?`⭐ ${Number(row.rating).toFixed(1)}${row.reviews?` (${row.reviews})`:''}`:'';
  return[
    `<b>${index}. ${esc(row.name)}</b>${rating?` — ${rating}`:''}`,
    row.category?`🏷️ ${esc(row.category)}`:null,
    phone,
    row.address?`📍 ${esc(row.address)}`:row.city?`📍 ${esc(row.city)}`:null,
    `🔎 ${esc(sourceLabel(row.sourceType,row.origin))} — ثقة ${esc(confidenceLabel(row.confidence))}`,
    row.evidence?`<i>${esc(row.evidence).slice(0,180)}</i>`:null
  ].filter(Boolean).join('\n');
}
function cityKeyboard(){return keyboard([
  [{text:'نجران',callback_data:'supplier_city:najran'},{text:'خميس مشيط',callback_data:'supplier_city:khamis'}],
  [{text:'الرياض',callback_data:'supplier_city:riyadh'},{text:'جدة',callback_data:'supplier_city:jeddah'}],
  [{text:'الدمام',callback_data:'supplier_city:dammam'},{text:'كل السعودية',callback_data:'supplier_city:saudi'}],
  [{text:'مدينة أخرى',callback_data:'supplier_city:other'}]
]);}
async function getSession(chatId,userId){return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function setSession(chatId,userId,state,context={}){
  const old=await getSession(chatId,userId),aiHistory=old?.context?.aiHistory||[];
  return(await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'}))?.[0];
}

export const isDeepBusinessState=state=>DEEP_STATES.has(String(state||''));

export async function startDeepBusinessSearch(message,identity){
  const userId=identity?.external_id||message.from.id;
  await setSession(message.chat.id,userId,'business_search_query',{startedAt:now()});
  return sendMessage(message.chat.id,'<b>بحث شامل عن الشركات والمحلات</b>\n\nاكتب النشاط أو المنتج أو الخدمة. سأبحث في المواقع الرسمية، الشركات والمصانع والوكلاء والموزعين، الأدلة الصناعية والتجارية، المنصات المتخصصة، ثم دليل الأماكن.\n\nمثال: شركات مضخات الخرسانة وقطع غيارها');
}

async function logSearch(message,identity,query,city,result){
  return insert('audit_log',[{actor_type:'telegram',actor_id:String(identity?.user_id||identity?.external_id||message.from.id),action:'deep_business_search',entity_type:'business_directory',entity_id:'',details:{query,city,result_count:result.businesses.length,sources_used:result.sourcesUsed,web_source_count:result.webSources.length,google_query_count:result.googleQueries.length,chat_id:String(message.chat.id),message_id:String(message.message_id||'')},created_at:now()}]);
}

export async function sendDeepBusinessResults(message,identity,query,city){
  await sendMessage(message.chat.id,`جارٍ البحث المتعمق عن <b>${esc(query)}</b> في <b>${esc(city)}</b>...\nأفحص الشركات والمصانع والوكلاء والأدلة المتخصصة، وليس خرائط Google فقط.`);
  let result;
  try{result=await searchComprehensiveBusinessDirectory(query,{city});}
  catch(error){return sendMessage(message.chat.id,`<b>تعذر إكمال البحث الشامل.</b>\n${esc(error?.message||'تعذر الوصول إلى مصادر دليل الأعمال.')}`,keyboard([[{text:'إعادة البحث',callback_data:'proc:search'}]]));}
  await logSearch(message,identity,query,city,result).catch(()=>{});
  await setSession(message.chat.id,identity?.external_id||message.from.id,'business_search_results',{query,city,businesses:result.businesses.slice(0,30),sourcesUsed:result.sourcesUsed,startedAt:now()});
  if(!result.businesses.length)return sendMessage(message.chat.id,'لم أجد جهة منشورة يمكن التحقق منها. وسّع المدينة أو اكتب النشاط والماركة بصورة أدق.',keyboard([[{text:'بحث في كل السعودية',callback_data:'supplier_city:saudi'},{text:'بحث جديد',callback_data:'proc:search'}]]));
  const chunks=[];for(let index=0;index<result.businesses.length;index+=5)chunks.push(result.businesses.slice(index,index+5));
  for(let page=0;page<chunks.length;page++){
    const start=page*5,header=[
      `<b>نتائج البحث الشامل: ${esc(query)}</b>`,
      `📍 ${esc(city)} — <b>${result.businesses.length}</b> جهة${chunks.length>1?` — صفحة ${page+1}/${chunks.length}`:''}`,
      page===0&&result.sourcesUsed.length?`المصادر: ${esc(result.sourcesUsed.join(' + '))}`:null,
      page===0&&result.scopeNote?`<i>${esc(result.scopeNote).slice(0,350)}</i>`:null,
      '━━━━━━━━━━━━━━━'
    ].filter(Boolean).join('\n');
    const body=chunks[page].map((row,index)=>resultCard(row,start+index+1)).join('\n\n');
    const last=page===chunks.length-1,buttons=last?[[{text:'بحث جديد',callback_data:'proc:search'},{text:'مدينة أخرى',callback_data:'supplier_city:other'}]]:[];
    await sendMessage(message.chat.id,`${header}\n${body}${last?'\n━━━━━━━━━━━━━━━\n<i>النتائج المنشورة لا تعني حصر السوق بالكامل؛ تحقق بالاتصال والسجل التجاري قبل التعاقد.</i>':''}`.slice(0,3900),keyboard(buttons));
  }
  return result.businesses;
}

export async function handleDirectBusinessSearch(message,identity,text){
  const query=extractDirectBusinessSearchQuery(text);
  if(!query)return false;
  const userId=identity?.external_id||message.from.id,city=directBusinessSearchCity(text,query);
  await clearMaintenanceSession(message.chat.id,userId).catch(()=>{});
  await sendDeepBusinessResults(message,identity,query,city);
  return true;
}

export async function continueDeepBusinessSearch(message,identity,session,text){
  if(!isDeepBusinessState(session?.state))return false;
  const value=clean(text,300),userId=identity?.external_id||message.from.id,context=session?.context||{};
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,'تم إلغاء البحث.');return true;}
  if(session.state==='business_search_query'){
    if(value.length<2){await sendMessage(message.chat.id,'اكتب نشاطًا أو منتجًا أو خدمة بصورة أوضح.');return true;}
    await setSession(message.chat.id,userId,'business_search_city',{query:value,startedAt:now()});
    await sendMessage(message.chat.id,'اختر نطاق البحث:',cityKeyboard());return true;
  }
  if(session.state==='business_search_city'){
    if(value.length<2){await sendMessage(message.chat.id,'اختر المدينة من الأزرار، أو اكتب تفاصيل إضافية للنشاط.');return true;}
    const merged=`${context.query||''} ${value}`.trim().slice(0,300);
    await setSession(message.chat.id,userId,'business_search_city',{...context,query:merged,startedAt:now()});
    await sendMessage(message.chat.id,`تم تدقيق الطلب: <b>${esc(merged)}</b>\nاختر نطاق البحث:`,cityKeyboard());return true;
  }
  if(session.state==='business_search_custom_city'){
    if(value.length<2){await sendMessage(message.chat.id,'اكتب اسم مدينة واضحًا.');return true;}
    await sendDeepBusinessResults(message,identity,context.query,value);return true;
  }
  return false;
}

export async function handleDeepBusinessCallback(message,from,identity,action,value){
  const session=await getSession(message.chat.id,identity?.external_id||from.id),context=session?.context||{};
  if(action==='proc'&&value==='search'){await startDeepBusinessSearch({...message,from},identity);return true;}
  if(action!=='supplier_city'||!isDeepBusinessState(session?.state))return false;
  if(value==='other'){
    if(!context.query){await startDeepBusinessSearch({...message,from},identity);return true;}
    await setSession(message.chat.id,identity?.external_id||from.id,'business_search_custom_city',context);
    await sendMessage(message.chat.id,'اكتب اسم المدينة أو المنطقة.');return true;
  }
  if(!context.query){await startDeepBusinessSearch({...message,from},identity);return true;}
  await sendDeepBusinessResults({...message,from},identity,context.query,CITY_LABELS[value]||value);return true;
}
