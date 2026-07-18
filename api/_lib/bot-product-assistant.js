import { select, insert } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { researchProductMarket } from './product-market-research.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=()=>new Date().toISOString();
const USE_ROLES=new Set(['admin','manager','accountant','mechanic','procurement','warehouse']);
export const canUseProductAssistant=identity=>Boolean(identity?.active&&USE_ROLES.has(identity.role));

async function getSession(chatId,userId){return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function setSession(chatId,userId,state,context={}){
  const old=await getSession(chatId,userId),aiHistory=old?.context?.aiHistory||[];
  const rows=await insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
  return rows?.[0];
}
async function logResearch(message,identity,result){
  return insert('audit_log',[{actor_type:'telegram',actor_id:String(identity?.user_id||identity?.external_id||message.from.id),action:'product_market_research',entity_type:'product_research',entity_id:'',details:{query:result.product,source_count:result.sources.length,search_count:result.searchCount||1,failed_scopes:result.failedScopes||0,sources:result.sources.map(x=>x.url),searched_at:result.searchedAt,requested_by:displayName(identity,message.from),source_message_id:String(message.message_id),chat_id:String(message.chat.id)},created_at:now()}]);
}
export function productAssistantButton(){return{text:'مساعد المنتجات والأسعار',callback_data:'proc:product'};}
export async function startProductAssistant(message,identity){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'مساعد المنتجات والأسعار متاح للمشتريات والورشة والإدارة والمحاسب.');
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_market_query',{startedAt:now()});
  return sendMessage(message.chat.id,'اكتب اسم الصنف أو رقم القطعة والمواصفات المتاحة. سأبحث بالتوازي داخل السعودية والخليج والمصادر العالمية. مثال:\nفلتر زيت Hino 500 رقم 15613-E0110\nرولمان بلي 6205 SKF\nإطار 12R22.5 بريدجستون');
}
export async function sendProductResearch(message,identity,query){
  if(!canUseProductAssistant(identity))return sendMessage(message.chat.id,'مساعد أسعار المنتجات غير متاح لدورك الحالي.');
  await sendMessage(message.chat.id,`أبحث الآن عن <b>${esc(query)}</b> في السوق السعودي والخليج والمصادر العالمية المتاحة...`);
  let result;try{result=await researchProductMarket(query);}catch(error){return sendMessage(message.chat.id,esc(error.message||'تعذر بحث الأسعار.'));}
  await logResearch(message,identity,result).catch(()=>{});
  await setSession(message.chat.id,identity.external_id||message.from.id,'product_results',{query:result.product,sources:result.sources,searchedAt:result.searchedAt,searchCount:result.searchCount||1,startedAt:now()});
  const buttons=result.sources.slice(0,18).map((source,index)=>[{text:`${index+1}. ${(source.title||'فتح المصدر').slice(0,42)}`,url:source.url}]);
  buttons.push([{text:'إنشاء طلب عرض سعر',callback_data:'supplier_rfq:start'},{text:'بحث عن صنف آخر',callback_data:'proc:product'}]);
  const searched=new Date(result.searchedAt).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}),scopeText=result.searchCount>=3?'السعودية والخليج والعالم':`${result.searchCount||1} نطاق بحث متاح`;
  return sendMessage(message.chat.id,`<b>بحث المنتجات والأسعار الموسع</b>\n\n${esc(result.text)}\n\nنطاق البحث: <b>${esc(scopeText)}</b>\nالمصادر المختلفة: <b>${result.sources.length}</b>\nوقت البحث: <b>${esc(searched)}</b>${result.failedScopes?`\nتعذر إكمال <b>${result.failedScopes}</b> نطاق، وعُرضت النتائج الناجحة.`:''}\nالأسعار المعروضة أسعار منشورة لحظة البحث وليست عرضًا ملزمًا. أكد التوفر والضريبة والشحن والمواصفة قبل الشراء.`.slice(0,3900),keyboard(buttons));
}
export async function continueProductAssistant(message,identity,session,text){
  if(session?.state!=='product_market_query')return false;
  const query=String(text||'').trim();
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(query)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء بحث المنتج.');return true;}
  if(query.length<2){await sendMessage(message.chat.id,'اكتب اسم الصنف أو رقم القطعة بصورة أوضح.');return true;}
  await sendProductResearch(message,identity,query);return true;
}
export async function handleProductTextCommand(message,identity,text){
  const raw=String(text||'').trim(),normalized=raw.toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
  const direct=raw.match(/^(?:سعر|اسعار|أسعار|ابحث عن سعر|بحث سعر|قارن اسعار|قارن أسعار|سعر السوق)\s+(.{2,})$/i);
  if(direct){await sendProductResearch(message,identity,direct[1]);return true;}
  if(/^(مساعد المنتجات|مساعد الاسعار|مساعد الأسعار|بحث المنتجات|اسعار المنتجات|أسعار المنتجات)$/.test(normalized)){await startProductAssistant(message,identity);return true;}
  return false;
}
