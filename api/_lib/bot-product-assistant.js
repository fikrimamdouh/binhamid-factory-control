import { select, insert } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { researchProductMarket } from './product-market-research-fast.js';
import { identifyProductImage } from './product-image-identification.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const USE_ROLES=new Set(['admin','manager','accountant','mechanic','procurement','warehouse']);
export const canUseProductAssistant=identity=>Boolean(identity?.active&&USE_ROLES.has(identity.role));
const copyable=value=>esc(value).replace(/(\+?\d[\d\s().-]{6,}\d)/g,'<code>$1</code>');
const money=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});

async function getSession(chatId,userId){return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function setSession(chatId,userId,state,context={}){
  const old=await getSession(chatId,userId),aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}
async function logResearch(message,identity,result){
  return insert('audit_log',[{actor_type:'telegram',actor_id:String(identity?.user_id||identity?.external_id||message.from.id),action:'product_market_research',entity_type:'product_research',entity_id:'',details:{query:result.product,source_count:result.sources.length,search_count:result.searchCount||1,failed_scopes:result.failedScopes||0,price_level:result.priceLevel||null,sources:result.sources.map(x=>x.url),searched_at:result.searchedAt,requested_by:displayName(identity,message.from),source_message_id:String(message.message_id),chat_id:String(message.chat.id)},created_at:now()}]);
}
function priceHeadline(level){
  const band=level?.overall;
  if(!level?.available||!band)return '<b>السعر:</b> لم يظهر سعر منشور كافٍ؛ يلزم طلب عرض سعر مباشر.';
  return `<b>سعر القطعة في السوق الآن:</b> نحو <b>${money(band.typical)} ر.س</b>\nالنطاق المرصود: <b>${money(band.min)}–${money(band.max)} ر.س</b> من <b>${band.sampleCount}</b> أسعار — الثقة <b>${esc(band.confidence)}</b>`;
}
export function productAssistantButton(){return{text:'مساعد المنتجات والأسعار',callback_data:'proc:product'};}
export async function startProductAssistant(message,identity){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'مساعد المنتجات والأسعار متاح للمشتريات والورشة والإدارة والمحاسب.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_market_query',{startedAt:now()});
  return sendMessage(message.chat.id,'اكتب اسم الصنف أو رقم القطعة والمواصفات المتاحة. سأعطيك السعر المعتاد، أقل وأعلى سعر منشور، ثم الموردين. مثال:\nفلتر زيت Hino 500 رقم 15613-E0110\nرولمان بلي 6205 SKF\nإطار 12R22.5 بريدجستون',keyboard([[{text:'البحث بصورة القطعة',callback_data:'proc:product_image'}]]));
}
export async function startProductImageAssistant(message,identity){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'البحث بصورة القطعة غير متاح لدورك الحالي.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_image_waiting',{startedAt:now()});
  return sendMessage(message.chat.id,'أرسل صورة القطعة أو الملصق. سأفحصها مرتين تلقائيًا عند ضعف القراءة، ثم أبحث عن السعر المعتاد وأفضل العروض. وجود اسم المعدة أو رقم جزئي في وصف الصورة يحسن النتيجة.');
}
export async function sendProductResearch(message,identity,query){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'مساعد أسعار المنتجات غير متاح لدورك الحالي.');
  await sendMessage(message.chat.id,`أبحث الآن عن <b>${esc(query)}</b> في جولة سريعة تبدأ بالسوق السعودي ثم تتوسع للخليج والعالم عند الحاجة...`);
  let result;
  try{result=await researchProductMarket(query);}
  catch(error){return sendMessage(message.chat.id,`<b>تعذر إكمال بحث السعر.</b>\n${esc(error.message||'تعذر بحث الأسعار.')}\n\nاكتب رقم القطعة والماركة بصورة أدق أو استخدم صورة الملصق.`,keyboard([[{text:'إعادة البحث بالاسم',callback_data:'proc:product'},{text:'البحث بصورة القطعة',callback_data:'proc:product_image'}]]));}
  await logResearch(message,identity,result).catch(()=>{});
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_results',{query:result.product,sources:result.sources,searchedAt:result.searchedAt,searchCount:result.searchCount||1,scopeLabel:result.scopeLabel||'',priceLevel:result.priceLevel||null,startedAt:now()});
  const buttons=result.sources.slice(0,18).map((source,index)=>[{text:`${index+1}. ${(source.title||'فتح المصدر').slice(0,42)}`,url:source.url}]);
  buttons.push([{text:'إنشاء طلب عرض سعر',callback_data:'supplier_rfq:start'},{text:'بحث بصورة أخرى',callback_data:'proc:product_image'}],[{text:'بحث عن صنف آخر',callback_data:'proc:product'}]);
  const searched=new Date(result.searchedAt).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}),scopeText=result.scopeLabel||'السعودية والخليج والعالم';
  return sendMessage(message.chat.id,`${priceHeadline(result.priceLevel)}\n\n<b>تفاصيل بحث المنتجات والأسعار</b>\n\n${copyable(result.text)}\n\nنطاق البحث: <b>${esc(scopeText)}</b>\nالمصادر المختلفة: <b>${result.sources.length}</b>\nوقت البحث: <b>${esc(searched)}</b>${result.failedScopes?`\nتعذر إكمال <b>${result.failedScopes}</b> نطاق، وعُرضت النتائج الناجحة.`:''}\nالرقم المعروض هو سعر سوق مرصود وليس عرض شراء ملزم. أكد رقم القطعة والضريبة والشحن والتوفر قبل الاعتماد.`.slice(0,3900),keyboard(buttons));
}
export async function handleProductImage(message,identity,buffer,mimeType='image/jpeg'){
  if(!canUseProductAssistant(identity))return false;
  await sendMessage(message.chat.id,'تم استلام صورة القطعة. جارٍ فحص الشكل والكتابة والأرقام ثم تشغيل بحث السعر...');
  let identified;try{identified=await identifyProductImage(buffer,mimeType,message.caption||'');}catch(error){await sendMessage(message.chat.id,esc(error.message||'تعذر تحليل صورة القطعة.'));return true;}
  const confidence={high:'عالية',medium:'متوسطة',low:'محدودة'}[identified.confidence]||identified.confidence,passes=identified.analysisPasses>1?'تمت إعادة الفحص تلقائيًا مرتين.':'تم الفحص مرة واحدة.';
  await sendMessage(message.chat.id,`<b>نتيجة قراءة الصورة</b>\nالقطعة: <b>${esc(identified.identification)}</b>\nالأكواد المؤكدة: ${copyable(identified.codes)}\nدرجة الثقة: <b>${esc(confidence)}</b>\n${esc(passes)}\nعبارة البحث: <code>${esc(identified.query)}</code>${identified.needsMoreDetail?'\nلم يظهر رقم كامل، لذلك سيعتمد البحث على الوصف البصري والأكواد الجزئية بدل رفض الصورة.':''}`);
  await sendProductResearch(message,identity,identified.query);return true;
}
export async function continueProductAssistant(message,identity,session,text){
  if(session?.state==='product_image_waiting'){await sendMessage(message.chat.id,'أرسل صورة القطعة نفسها، أو اكتب «إلغاء».');return true;}
  if(session?.state!=='product_market_query')return false;
  const query=String(text||'').trim();
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(query)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء بحث المنتج.');return true;}
  if(query.length<2){await sendMessage(message.chat.id,'اكتب اسم الصنف أو رقم القطعة بصورة أوضح.');return true;}
  await sendProductResearch(message,identity,query);return true;
}
export async function handleProductTextCommand(message,identity,text){
  const raw=String(text||'').trim(),normalized=raw.toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
  const direct=raw.match(/^(?:سعر|اسعار|أسعار|ابحث عن سعر|بحث سعر|قارن اسعار|قارن أسعار|سعر السوق|القطعه دي سعرها|القطعة دي سعرها)\s+(.{2,})$/i);
  if(direct){await sendProductResearch(message,identity,direct[1]);return true;}
  if(/^(بحث بالصوره|بحث بالصورة|ابحث بالصوره|ابحث بالصورة|صوره قطعه|صورة قطعة|بحث صوره قطعه|بحث صورة قطعة)$/.test(normalized)){await startProductImageAssistant(message,identity);return true;}
  if(/^(مساعد المنتجات|مساعد الاسعار|مساعد الأسعار|بحث المنتجات|اسعار المنتجات|أسعار المنتجات)$/.test(normalized)){await startProductAssistant(message,identity);return true;}
  return false;
}
