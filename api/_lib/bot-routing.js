import { analyzeFactoryMessage } from './ai.js';
import { routeMessage, DEPARTMENT_LABELS } from './domain.js';
import { select, upsert, patch } from './supabase.js';
import { displayName, roleLabel } from './bot-profile.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const INTENTS=new Set(['greeting','thanks','report','maintenance','fuel','payroll','collection','sales','quotation','finance','department_message','general']);
async function getSession(chatId,userId){return (await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function remember(chatId,userId,userText,assistantText){
  const session=await getSession(chatId,userId),context=session?.context||{},history=Array.isArray(context.aiHistory)?context.aiHistory:[];
  const aiHistory=[...history,{user:String(userText).slice(0,1200),assistant:String(assistantText).slice(0,1200),at:new Date().toISOString()}].slice(-8);
  await upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state:session?.state||'idle',context:{...context,aiHistory},updated_at:new Date().toISOString()}],'channel,chat_id,external_user_id');
}
function fallbackReply(route,name,text=''){
  const d=route.destination||DEPARTMENT_LABELS.general,t=String(text).toLowerCase();
  if(route.intent==='thanks')return `العفو يا ${name}. أنا متابع معك.`;
  if(route.intent==='greeting')return `أهلًا يا ${name}. أنا جاهز. اكتب طلبك مباشرة أو اكتب «مساعدة».`;
  if(route.intent==='report')return `حاضر يا ${name}. سأعرض لك تقارير الإدارة المتاحة.`;
  if(route.intent==='maintenance')return `فهمت يا ${name}. هذه رسالة عطل ومسارها الورشة والصيانة.`;
  if(route.intent==='fuel')return `فهمت يا ${name}. الرسالة تخص الديزل والوقود ومسارها ${d}.`;
  if(route.intent==='payroll')return `فهمت يا ${name}. الموضوع يخص الرواتب أو شؤون الموظفين ومساره ${d}.`;
  if(route.intent==='collection')return `فهمت يا ${name}. هذه رسالة تحصيل ومسارها ${d}.`;
  if(route.intent==='sales')return `فهمت يا ${name}. هذه رسالة مبيعات ومسارها ${d}.`;
  if(route.intent==='quotation')return `فهمت يا ${name}. هذا عرض سعر ومساره ${d} للمراجعة قبل الاعتماد.`;
  if(route.intent==='finance')return `فهمت يا ${name}. هذه معاملة مالية ومسارها ${d}.`;
  if(/كيف حالك|عامل ايه|اخبارك/.test(t))return `أنا جاهز ومتصل بالنظام يا ${name}. قل لي ما الذي تريد متابعته في المصنع.`;
  return `فهمت كلامك يا ${name}. عندما يكون الطلب متعلقًا ببيانات المصنع سأحدد المسار والإجراء، أما الأسئلة العامة فسأجيبك مباشرة دون ترحيلها كمعاملة.`;
}
export async function interpretMessage({message,group,identity,text,stored}){
  const chatId=message.chat.id,name=displayName(identity,message.from),role=identity.role||'pending';
  const fallback=routeMessage(text,group.department,role),session=await getSession(chatId,message.from.id),history=session?.context?.aiHistory||[];
  let ai=null;
  try{ai=await analyzeFactoryMessage({text,userName:name,roleLabel:roleLabel(role),departmentLabel:DEPARTMENT_LABELS[group.department]||group.title||'غير محدد',history,fallbackRoute:fallback});}catch(error){console.error('[telegram ai]',error.message);}
  const route={...fallback,...(ai||{})};
  if(!INTENTS.has(route.intent))route.intent=fallback.intent;
  route.destination=String(route.destination||fallback.destination||DEPARTMENT_LABELS.general).slice(0,180);
  route.summary=String(route.summary||fallback.summary||text).slice(0,500);
  route.reply=String(route.reply||fallbackReply(route,name,text)).slice(0,1800);
  const operational=!['greeting','thanks','general'].includes(route.intent);
  if(stored?.id)await patch('telegram_messages',`id=eq.${encodeURIComponent(stored.id)}`,{related_entity_type:operational?`route_${String(route.intent).replace(/[^a-z_]/g,'')}`:'conversation'});
  await remember(chatId,message.from.id,text,route.reply);
  return {route,response:operational?`${esc(route.reply)}\n\n<b>المسار المقترح:</b> ${esc(route.destination)}\n<b>فهم الرسالة:</b> ${esc(route.summary)}\n<b>الحالة:</b> محفوظة في مركز الاتصال ولم تُرحّل نهائيًا بعد.`:esc(route.reply)};
}
