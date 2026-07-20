import { select, insert, rpc } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { canUseProductAssistant, continueProductAssistant, handleProductTextCommand, startProductAssistant, startProductImageAssistant } from './bot-product-assistant.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const CITY_LABELS={najran:'نجران',riyadh:'الرياض',jeddah:'جدة',dammam:'الدمام',khamis:'خميس مشيط',saudi:'كل السعودية'};
const URGENCY={normal:'عادي',urgent:'عاجل',critical:'حرج'};
const USE_ROLES=new Set(['admin','manager','accountant','mechanic','procurement','warehouse']);
const CREATE_ROLES=new Set(['admin','manager','mechanic','procurement','warehouse']);
const canUse=role=>USE_ROLES.has(String(role||''));
const canCreate=role=>CREATE_ROLES.has(String(role||''));
const referenceFrom=result=>String(Array.isArray(result)?result[0]?.next_document_no||result[0]||'':result||'');
const nextReference=async()=>referenceFrom(await rpc('next_document_no',{p_prefix:'RFQ'}));
const normalize=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();

async function setSession(chatId,userId,state,context={}){
  const old=(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=context&limit=1`))?.[0];
  const aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}
async function currentSession(chatId,userId){return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}

export function procurementMenu(){return keyboard([
  [{text:'بحث قطعة ومورد',callback_data:'proc:product'},{text:'البحث بصورة القطعة',callback_data:'proc:product_image'}],
  [{text:'بحث دليل الموردين',callback_data:'proc:search'},{text:'طلب عرض سعر',callback_data:'proc:rfq'}],
  [{text:'طلبات الأسعار المفتوحة',callback_data:'proc:open'}]
]);}
export async function showProcurementMenu(message,identity){
  if(!canUse(identity?.role))return sendMessage(message.chat.id,'بحث قطع الغيار والموردين متاح للمشتريات والمخزن والورشة والإدارة والمحاسب.');
  return sendMessage(message.chat.id,'اختر العملية. نتائج البحث تظهر داخل البوت فقط: اسم المورد، رقم الاتصال والعنوان. يبدأ البحث بالقطعة نفسها ثم يتوسع تلقائيًا إلى المحلات المتخصصة ومحلات قطع الغيار العامة.',procurementMenu());
}

function cityKeyboard(){return keyboard([
  [{text:'نجران',callback_data:'supplier_city:najran'},{text:'خميس مشيط',callback_data:'supplier_city:khamis'}],
  [{text:'الرياض',callback_data:'supplier_city:riyadh'},{text:'جدة',callback_data:'supplier_city:jeddah'}],
  [{text:'الدمام',callback_data:'supplier_city:dammam'},{text:'كل السعودية',callback_data:'supplier_city:saudi'}],
  [{text:'مدينة أخرى',callback_data:'supplier_city:other'}]
]);}
function quantityKeyboard(){return keyboard([
  [{text:'1',callback_data:'rfq_qty:1'},{text:'2',callback_data:'rfq_qty:2'},{text:'4',callback_data:'rfq_qty:4'}],
  [{text:'6',callback_data:'rfq_qty:6'},{text:'10',callback_data:'rfq_qty:10'},{text:'كمية أخرى',callback_data:'rfq_qty:other'}]
]);}
function urgencyKeyboard(){return keyboard([[{text:'عادي',callback_data:'rfq_urgency:normal'},{text:'عاجل',callback_data:'rfq_urgency:urgent'},{text:'حرج',callback_data:'rfq_urgency:critical'}]]);}

export async function startProcurementAction(message,identity,action){
  const role=identity?.role||'',userId=identity?.external_id||message.from.id;
  if(action==='product')return startProductAssistant(message,identity);
  if(action==='product_image')return startProductImageAssistant(message,identity);
  if(action==='open')return sendOpenQuoteRequests(message.chat.id,identity);
  if(!canCreate(role))return sendMessage(message.chat.id,'إنشاء البحث وطلب عرض السعر متاح للمشتريات والمخزن والورشة والإدارة.');
  if(action==='search'){
    await setSession(message.chat.id,userId,'supplier_search_query',{startedAt:now()});
    return sendMessage(message.chat.id,'اكتب رقم القطعة أو اسمها بوضوح. إذا لم يجد الدليل متجرًا يذكر رقم القطعة، سيوسع البحث تلقائيًا إلى المحلات المتخصصة ثم محلات قطع الغيار العامة.\n\nمثال:\nرولمان بلي 6205\nفلتر زيت Hino 500\nرقم القطعة 15613-E0110');
  }
  if(action==='rfq'){
    await setSession(message.chat.id,userId,'rfq_item',{startedAt:now()});
    return sendMessage(message.chat.id,'اكتب اسم القطعة أو رقمها فقط.');
  }
}

function categorySearchTerm(query){
  const value=normalize(query);
  if(/رولمان|بلي|بليه|بلية|bearing|bearings|620\d|621\d|622\d|630\d|631\d|632\d/.test(value))return'محلات رولمان بلي ومحامل وسيور صناعية bearings';
  if(/فلتر|فلاتر|filter/.test(value))return'محلات فلاتر وقطع غيار سيارات وشاحنات ومعدات';
  if(/اطار|اطارات|كفر|كفرات|tire|tyre/.test(value))return'محلات إطارات وكفرات سيارات وشاحنات ومعدات';
  if(/هيدروليك|hydraulic|خرطوم|ليات/.test(value))return'محلات هيدروليك وخراطيم وقطع غيار معدات';
  if(/بطاري|دينمو|سلف|كهرب|alternator|starter/.test(value))return'محلات كهرباء سيارات وبطاريات وقطع غيار';
  if(/سير|سيور|belt/.test(value))return'محلات سيور صناعية ومحامل وقطع غيار';
  if(/فرامل|تيل|brake/.test(value))return'محلات فرامل وتيل وقطع غيار سيارات وشاحنات';
  if(/محرك|مكين|engine|بستم|شنبر/.test(value))return'محلات قطع غيار محركات سيارات وشاحنات ومعدات';
  return'محلات قطع غيار صناعية وسيارات وشاحنات ومعدات ثقيلة';
}

export function supplierSearchQueries(query,city){
  const location=city==='كل السعودية'?'السعودية':`${city} السعودية`;
  const category=categorySearchTerm(query);
  return [...new Set([
    `${query} ${location}`,
    `${category} ${location}`,
    `محلات قطع غيار صناعية وسيارات وشاحنات ومعدات ثقيلة ${location}`
  ])];
}

async function searchPlacesText(textQuery,apiKey,matchRank){
  const fieldMask='places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.businessStatus';
  const response=await fetch('https://places.googleapis.com/v1/places:searchText',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':fieldMask},
    body:JSON.stringify({textQuery,pageSize:20,languageCode:'ar',regionCode:'SA',includePureServiceAreaBusinesses:true}),
    signal:AbortSignal.timeout(9000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error('تعذر الوصول إلى دليل الموردين الآن.'),{status:Number(response.status)||502,code:'SUPPLIER_DIRECTORY_FAILED'});
  return (data.places||[]).map(place=>({
    id:place.id||'',
    name:place.displayName?.text||'مورد',
    address:place.formattedAddress||'',
    phone:place.internationalPhoneNumber||place.nationalPhoneNumber||'',
    rating:Number(place.rating||0),
    reviews:Number(place.userRatingCount||0),
    businessStatus:place.businessStatus||'',
    matchRank
  }));
}

async function searchPlaces(query,city){
  const apiKey=process.env.GOOGLE_PLACES_API_KEY||process.env.PLACES_DIRECTORY_KEY||'';
  if(!apiKey)throw Object.assign(new Error('دليل الموردين غير مفعّل على الخادم. لم يتم عرض أرقام غير مؤكدة.'),{code:'NOT_CONFIGURED'});
  const searchQueries=supplierSearchQueries(query,city);
  const attempts=await Promise.allSettled(searchQueries.map((textQuery,index)=>searchPlacesText(textQuery,apiKey,index)));
  const successful=attempts.filter(item=>item.status==='fulfilled');
  if(!successful.length)throw Object.assign(new Error('تعذر الوصول إلى دليل الموردين الآن. لم يتم عرض أرقام غير مؤكدة.'),{code:'SUPPLIER_DIRECTORY_FAILED'});
  const byId=new Map();
  for(const attempt of successful){
    for(const place of attempt.value){
      if(place.businessStatus==='CLOSED_PERMANENTLY')continue;
      const key=place.id||`${normalize(place.name)}|${normalize(place.address)}`;
      const existing=byId.get(key);
      if(!existing||place.matchRank<existing.matchRank||(!existing.phone&&place.phone))byId.set(key,{...existing,...place,matchRank:Math.min(existing?.matchRank??99,place.matchRank)});
    }
  }
  const found=[...byId.values()];
  const withPhones=found.filter(row=>row.phone);
  const usable=(withPhones.length?withPhones:found).sort((a,b)=>Number(Boolean(b.phone))-Number(Boolean(a.phone))||a.matchRank-b.matchRank||b.rating-a.rating||b.reviews-a.reviews);
  return {places:usable.slice(0,18),searchQueries,expanded:usable.some(row=>row.matchRank>0)};
}
async function logSearch(message,identity,query,city,count,searchQueries=[]){return insert('audit_log',[{actor_type:'telegram',actor_id:String(identity?.user_id||identity?.external_id||message.from.id),action:'supplier_public_search',entity_type:'supplier_search',entity_id:'',details:{query,city,result_count:count,search_queries:searchQueries,requested_by:displayName(identity,message.from),source_message_id:String(message.message_id),chat_id:String(message.chat.id)},created_at:now()}]);}

async function sendSupplierResults(message,identity,query,city){
  await sendMessage(message.chat.id,`جارٍ البحث عن موردين للقطعة: <b>${esc(query)}</b> في <b>${esc(city)}</b>...\nسأبحث عن القطعة نفسها ثم المحلات المتخصصة ومحلات قطع الغيار العامة.`);
  let result;try{result=await searchPlaces(query,city);}catch(error){return sendMessage(message.chat.id,`<b>تعذر إكمال البحث.</b>\n${esc(error.message||'تعذر الوصول إلى دليل الموردين.')}\n\nجرّب مرة أخرى أو اختر «كل السعودية».`,keyboard([[{text:'بحث في كل السعودية',callback_data:'supplier_city:saudi'},{text:'بحث عن قطعة أخرى',callback_data:'proc:product'}]]));}
  const {places,searchQueries,expanded}=result;
  await logSearch(message,identity,query,city,places.length,searchQueries).catch(()=>{});
  await setSession(message.chat.id,identity.external_id||message.from.id,'supplier_results',{query,city,places,searchQueries,startedAt:now()});
  if(!places.length)return sendMessage(message.chat.id,'لم يعثر دليل الأعمال على محلات في هذه المدينة حتى بعد توسيع البحث إلى محلات قطع الغيار العامة. جرّب «كل السعودية» أو مدينة قريبة.',keyboard([[{text:'بحث في كل السعودية',callback_data:'supplier_city:saudi'},{text:'بحث في مدينة أخرى',callback_data:'supplier_city:other'}]]));
  const chunks=[];for(let i=0;i<places.length;i+=6)chunks.push(places.slice(i,i+6));
  for(let chunkIndex=0;chunkIndex<chunks.length;chunkIndex++){
    const chunk=chunks[chunkIndex],buttons=[];let text=`<b>نتائج الموردين — ${chunkIndex+1}/${chunks.length}</b>\nالقطعة: <b>${esc(query)}</b>\nالنطاق: <b>${esc(city)}</b>\nإجمالي المحلات: <b>${places.length}</b>${expanded?'\nتم توسيع البحث تلقائيًا إلى المحلات المتخصصة ومحلات قطع الغيار العامة؛ توفر القطعة يتأكد بالاتصال.':''}\n\n`;
    chunk.forEach((place,localIndex)=>{
      const index=chunkIndex*6+localIndex+1;
      const matchLabel=place.matchRank===0?'نتيجة مرتبطة بالقطعة':place.matchRank===1?'محل متخصص محتمل':'محل قطع غيار عام';
      text+=`${index}. <b>${esc(place.name)}</b>\nنوع النتيجة: ${esc(matchLabel)}\nرقم الاتصال: ${place.phone?`<code>${esc(place.phone)}</code>`:'غير منشور'}\nالعنوان: ${esc(place.address||'غير متاح')}${place.rating?`\nالتقييم: ${place.rating} (${place.reviews})`:''}\nتوفر القطعة المطلوبة: <b>يتأكد بالاتصال</b>\nالسعر: <b>يتأكد بالاتصال</b>\n\n`;
    });
    if(chunkIndex===chunks.length-1)buttons.push([{text:'إنشاء طلب عرض سعر',callback_data:'supplier_rfq:start'},{text:'بحث عن قطعة أخرى',callback_data:'proc:product'}],[{text:'بحث في مدينة أخرى',callback_data:'supplier_city:other'},{text:'كل السعودية',callback_data:'supplier_city:saudi'}]);
    text+='اضغط مطولًا على رقم الاتصال داخل المربع لنسخه. ظهور المحل لا يعني أن القطعة متوفرة؛ يجب الاتصال والتأكد.';
    await sendMessage(message.chat.id,text.slice(0,3900),keyboard(buttons));
  }
  return places;
}

export async function continueProcurementSession(message,identity,session,text){
  if(['product_market_query','product_image_waiting'].includes(session?.state))return continueProductAssistant(message,identity,session,text);
  const userId=identity.external_id||message.from.id,t=String(text||'').trim(),context=session.context||{};
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(t)){await clearMaintenanceSession(message.chat.id,userId);await sendMessage(message.chat.id,'تم إلغاء العملية الحالية.');return true;}
  if(!canCreate(identity?.role))return false;
  if(session.state==='supplier_search_query'){
    if(t.length<2){await sendMessage(message.chat.id,'اكتب رقم قطعة أو اسمًا أوضح.');return true;}
    await setSession(message.chat.id,userId,'supplier_search_city',{query:t,startedAt:now()});
    await sendMessage(message.chat.id,'اختر مدينة البحث:',cityKeyboard());return true;
  }
  if(session.state==='supplier_search_custom_city'){
    if(t.length<2){await sendMessage(message.chat.id,'اكتب اسم مدينة واضحًا.');return true;}
    await sendSupplierResults(message,identity,context.query,t);return true;
  }
  if(session.state==='rfq_item'){
    if(t.length<2){await sendMessage(message.chat.id,'اكتب اسم القطعة أو رقمها.');return true;}
    await setSession(message.chat.id,userId,'rfq_quantity',{item:t,startedAt:now()});
    await sendMessage(message.chat.id,'اختر الكمية:',quantityKeyboard());return true;
  }
  if(session.state==='rfq_quantity_custom'){
    const qty=Number(String(t).replace(/[^0-9.]/g,''));if(!qty){await sendMessage(message.chat.id,'اكتب الكمية بالأرقام.');return true;}
    await setSession(message.chat.id,userId,'rfq_urgency',{...context,quantity:qty});await sendMessage(message.chat.id,'اختر درجة الاستعجال:',urgencyKeyboard());return true;
  }
  return false;
}

async function createQuoteRequest(message,identity,context,urgency){
  const reference=await nextReference(),details={reference_no:reference,item:context.item||context.query,quantity:Number(context.quantity||1),urgency,urgency_label:URGENCY[urgency]||urgency,city:context.city||'',status:'open',requested_by_name:displayName(identity,message.from),requested_by_user_id:String(identity.user_id||''),chat_id:String(message.chat.id),source_message_id:String(message.message_id),created_at:now()};
  await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity?.user_id||identity?.external_id||message.from.id),action:'supplier_quote_request',entity_type:'request_for_quotation',entity_id:reference,details,created_at:now()}]);
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return sendMessage(message.chat.id,`تم تسجيل طلب عرض السعر.\n\nالمرجع: <b>${esc(reference)}</b>\nالقطعة: <b>${esc(details.item)}</b>\nالكمية: <b>${details.quantity}</b>\nالاستعجال: <b>${esc(details.urgency_label)}</b>\nالحالة: <b>مفتوح للبحث والتواصل مع الموردين</b>.`);
}

export async function handleProcurementCallback(message,from,identity,action,value){
  const userId=identity.external_id||from.id,session=await currentSession(message.chat.id,userId),context=session?.context||{};
  if(action==='proc')return startProcurementAction({...message,from},identity,value);
  if(action==='supplier_city'){
    if(value==='other'){
      const query=context.query||context.item;if(!query)return sendMessage(message.chat.id,'ابدأ البحث من قائمة الموردين أولًا.');
      await setSession(message.chat.id,userId,'supplier_search_custom_city',{...context,query});return sendMessage(message.chat.id,'اكتب اسم المدينة.');
    }
    const query=context.query||context.item;if(!query)return sendMessage(message.chat.id,'ابدأ البحث من قائمة الموردين أولًا.');
    return sendSupplierResults({...message,from},identity,query,CITY_LABELS[value]||value);
  }
  if(action==='supplier_rfq'){
    if(value!=='start'||!context.query)return sendMessage(message.chat.id,'انتهت نتيجة البحث. ابدأ بحثًا جديدًا.');
    await setSession(message.chat.id,userId,'rfq_quantity',{item:context.query,city:context.city||'',startedAt:now()});return sendMessage(message.chat.id,'اختر الكمية المطلوبة:',quantityKeyboard());
  }
  if(action==='rfq_qty'){
    if(session?.state!=='rfq_quantity')return sendMessage(message.chat.id,'انتهت خطوة الكمية. ابدأ طلب عرض سعر جديد.');
    if(value==='other'){await setSession(message.chat.id,userId,'rfq_quantity_custom',context);return sendMessage(message.chat.id,'اكتب الكمية بالأرقام.');}
    await setSession(message.chat.id,userId,'rfq_urgency',{...context,quantity:Number(value)});return sendMessage(message.chat.id,'اختر درجة الاستعجال:',urgencyKeyboard());
  }
  if(action==='rfq_urgency'){
    if(session?.state!=='rfq_urgency')return sendMessage(message.chat.id,'انتهت خطوة الاستعجال. ابدأ طلبًا جديدًا.');
    return createQuoteRequest({...message,from},identity,context,value);
  }
  return false;
}

export async function sendOpenQuoteRequests(chatId,identity){
  if(!canUse(identity?.role))return sendMessage(chatId,'ليست لديك صلاحية عرض طلبات الأسعار.');
  const logs=await select('audit_log','action=eq.supplier_quote_request&entity_type=eq.request_for_quotation&select=entity_id,details,created_at&order=created_at.desc&limit=50');
  if(!logs?.length)return sendMessage(chatId,'لا توجد طلبات عروض أسعار مسجلة.');
  const body=logs.slice(0,15).map((row,index)=>`${index+1}. <b>${esc(row.entity_id)}</b> — ${esc(row.details?.item||'قطعة')}\nالكمية: ${esc(row.details?.quantity||1)} | الاستعجال: ${esc(row.details?.urgency_label||'عادي')}\nبواسطة: ${esc(row.details?.requested_by_name||'مسؤول الورشة')}`).join('\n\n');
  return sendMessage(chatId,`<b>طلبات عروض الأسعار المفتوحة</b>\n\n${body}`.slice(0,3900));
}

export async function handleProcurementTextCommand(message,identity,text){
  if(canUseProductAssistant(identity)&&await handleProductTextCommand(message,identity,text))return true;
  const t=normalize(text);
  if(/^(بحث مورد|بحث عن مورد|بحث عن قطعه|بحث عن قطعة|ابحث عن قطعه|ابحث عن قطعة|قائمه الموردين|قائمة الموردين)$/.test(t)){await startProcurementAction(message,identity,'product');return true;}
  if(/^(طلب عرض سعر|طلب اسعار|طلب أسعار)$/.test(t)){await startProcurementAction(message,identity,'rfq');return true;}
  if(/^(طلبات الاسعار المفتوحه|طلبات الأسعار المفتوحة)$/.test(t)){await sendOpenQuoteRequests(message.chat.id,identity);return true;}
  return false;
}
