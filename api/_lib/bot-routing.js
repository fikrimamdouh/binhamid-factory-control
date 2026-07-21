import { analyzeFactoryMessage } from './ai.js';
import { routeMessage, DEPARTMENT_LABELS } from './domain.js';
import { select, upsert, patch } from './supabase.js';
import { displayName, roleLabel } from './bot-profile.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const INTENTS=new Set(['greeting','thanks','report','maintenance','fuel','payroll','collection','sales','quotation','finance','department_message','general']);
const salesTypeForRole=role=>role==='block_sales'?'block':role==='concrete_sales'?'concrete':'';
async function getSession(chatId,userId){return (await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;}
async function remember(chatId,userId,userText,assistantText){
  const session=await getSession(chatId,userId),context=session?.context||{},history=Array.isArray(context.aiHistory)?context.aiHistory:[];
  const aiHistory=[...history,{user:String(userText).slice(0,1200),assistant:String(assistantText).slice(0,1200),at:new Date().toISOString()}].slice(-8);
  await upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state:session?.state||'idle',context:{...context,aiHistory},updated_at:new Date().toISOString()}],'channel,chat_id,external_user_id');
}
async function startRoleSalesSession(chatId,userId,role,history=[]){
  const salesType=salesTypeForRole(role);if(!salesType)return'';
  const label=salesType==='block'?'البلوك':'الخرسانة الجاهزة',stamp=new Date().toISOString();
  await upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state:'guided_sales_customer',context:{aiHistory:Array.isArray(history)?history:[],salesType,source:'voice_or_natural_sales_intent',startedAt:stamp},updated_at:stamp}],'channel,chat_id,external_user_id');
  return `فهمت أنك تريد تسجيل أمر بيع ${label}. بدأت التسجيل الآن. اكتب اسم العميل فقط.`;
}
function fallbackReply(route,name,text='',aiError=null){
  const d=route.destination||DEPARTMENT_LABELS.general,t=String(text).toLowerCase();
  if(route.intent==='thanks')return `العفو يا ${name}.`;
  if(route.intent==='greeting')return `أهلًا يا ${name}. اكتب طلبك وسأرد على مضمونه مباشرة.`;
  if(route.intent==='report')return `طلبك متعلق بالتقارير. افتح قائمة التقارير وحدد تقرير المبيعات أو الورشة أو المدير حتى أعرض البيانات الصحيحة.`;
  if(route.intent==='maintenance')return `الرسالة تبدو بلاغ عطل. أرسل رقم اللوحة أو اسم المعدة ووصف العطل لفتح بلاغ الورشة بصورة صحيحة.`;
  if(route.intent==='fuel')return `الطلب متعلق بالديزل. يلزم رقم اللوحة والكمية أو قراءة العداد لتسجيل الحركة في ${d}.`;
  if(route.intent==='payroll')return `الطلب متعلق بالرواتب أو شؤون الموظفين. حدد اسم الموظف ونوع الطلب حتى يُفتح المسار الصحيح في ${d}.`;
  if(route.intent==='collection')return `هذه عملية تحصيل. يلزم العميل والمبلغ وطريقة السداد والخزينة حتى تُسجل في ${d}.`;
  if(route.intent==='sales')return `هذه عملية مبيعات. حدد البلوك أو الخرسانة، العميل، الصنف، الكمية والسعر لبدء التسجيل في ${d}.`;
  if(route.intent==='quotation')return `هذا طلب أو عرض سعر. أرسل الصنف والكمية والمواصفة أو الملف ليظهر في ${d} للمراجعة.`;
  if(route.intent==='finance')return `هذه معاملة مالية. حدد نوعها: قبض، صرف، فاتورة مورد، عهدة أو التزام، ثم أدخل المبلغ والطرف.`;
  if(route.intent==='department_message')return `الرسالة مرتبطة بـ ${d}. اذكر الإجراء المطلوب والبيانات الأساسية حتى أنفذه بدل حفظها كملاحظة عامة.`;
  if(/كيف حالك|عامل ايه|اخبارك/.test(t))return `أنا جاهز يا ${name}.`;
  console.error('[telegram ai unavailable]',{code:aiError?.code||'',status:Number(aiError?.status||0),message:String(aiError?.message||'').slice(0,240)});
  return 'تعذر تشغيل الفهم الذكي لهذه الرسالة الآن، لذلك لن أرسل ردًا عامًا أو أدّعي أنني فهمت. لم تُسجل أي معاملة من كلامك. أعد إرسال الطلب بعد نشر الإصلاح أو استخدم زر العملية المحددة من القائمة.';
}
export async function interpretMessage({message,group,identity,text,stored}){
  const chatId=message.chat.id,userId=message.from.id,name=displayName(identity,message.from),role=identity.role||'pending';
  const fallback=routeMessage(text,group.department,role),session=await getSession(chatId,userId),history=session?.context?.aiHistory||[];
  let ai=null,aiError=null;
  try{ai=await analyzeFactoryMessage({text,userName:name,roleLabel:roleLabel(role),departmentLabel:DEPARTMENT_LABELS[group.department]||group.title||'غير محدد',history,fallbackRoute:fallback});}catch(error){aiError=error;console.error('[telegram ai]',{code:error?.code||'',status:Number(error?.status||0),message:String(error?.message||'').slice(0,300)});}
  const route={...fallback,...(ai||{})};
  if(!INTENTS.has(route.intent))route.intent=fallback.intent;
  route.destination=String(route.destination||fallback.destination||DEPARTMENT_LABELS.general).slice(0,180);
  route.summary=String(route.summary||fallback.summary||text).slice(0,500);
  route.reply=String(route.reply||fallbackReply(route,name,text,aiError)).slice(0,1800);
  let directResponse='';
  if(route.intent==='sales'&&salesTypeForRole(role)){
    directResponse=await startRoleSalesSession(chatId,userId,role,history);
    route.destination=role==='block_sales'?'مبيعات البلوك':'مبيعات الخرسانة';
    route.summary=`بدء تسجيل أمر بيع ${role==='block_sales'?'بلوك':'خرسانة'} من رسالة طبيعية أو صوتية`;
  }
  const operational=!['greeting','thanks','general'].includes(route.intent);
  const response=directResponse|| (operational?`${esc(route.reply)}\n\n<b>المسار المقترح:</b> ${esc(route.destination)}\n<b>فهم الرسالة:</b> ${esc(route.summary)}\n<b>الحالة:</b> محفوظة في مركز الاتصال ولم تُرحّل نهائيًا بعد.`:esc(route.reply));
  if(stored?.id)await patch('telegram_messages',`id=eq.${encodeURIComponent(stored.id)}`,{related_entity_type:operational?`route_${String(route.intent).replace(/[^a-z_]/g,'')}`:'conversation',action_name:directResponse?'sales_guided_started':ai?'ai_answered':'ai_fallback',action_payload:{intent:route.intent,destination:route.destination,confidence:Number(route.confidence||0),ai_ok:Boolean(ai),error_code:aiError?.code||null}}).catch(()=>{});
  await remember(chatId,userId,text,response);
  return {route,response,aiOk:Boolean(ai),guidedSales:Boolean(directResponse)};
}
