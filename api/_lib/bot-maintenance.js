import { config } from './config.js';
import { select, upsert, patch } from './supabase.js';
import { sendMessage, keyboard, sendVoiceBuffer } from './telegram.js';
import { synthesize } from './ai.js';
import { allowed, extractPlate } from './domain.js';
import {
  assetLabel,cancelTelegramWorkshopOrder,confirmTelegramWorkshopOrder,createTelegramWorkshopDraft,
  searchWorkshopAssets
} from './workshop-telegram-service.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=()=>new Date().toISOString();
const SESSION_TTL_MS=10*60*1000;
const normalizeDigits=value=>String(value||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const isCancelText=value=>/^(الغاء|إلغاء|الغي|الغى|خلاص|تراجع|cancel|stop)$/i.test(String(value||'').trim());

function plateCandidate(value=''){
  const text=normalizeDigits(value).trim();
  if(extractPlate(text))return extractPlate(text);
  if(/^[0-9]{3,6}$/.test(text))return text;
  if(/^[A-Za-z\u0600-\u06FF]{1,5}\s*[0-9]{3,6}$/.test(text))return text;
  return '';
}
function userId(identity,message){return identity?.external_id||message?.from?.id;}

export async function getBotSession(chatId,externalUserId){
  return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(externalUserId))}&select=*&limit=1`))?.[0]||null;
}
async function setSession(chatId,externalUserId,state,context={}){
  const current=await getBotSession(chatId,externalUserId),aiHistory=current?.context?.aiHistory||[];
  return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(externalUserId),state,context:{aiHistory,...context},updated_at:now()}],'channel,chat_id,external_user_id');
}
export async function clearMaintenanceSession(chatId,externalUserId){
  const current=await getBotSession(chatId,externalUserId);
  return patch('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(externalUserId))}`,{state:'idle',context:{aiHistory:current?.context?.aiHistory||[]},updated_at:now()});
}
async function reply(chatId,text,voice=false,extra={}){
  const sent=await sendMessage(chatId,text,extra);
  if(voice&&config.openaiKey){try{const audio=await synthesize(text.replace(/<[^>]+>/g,''));if(audio)await sendVoiceBuffer(chatId,audio);}catch(error){console.error('tts',error.message);}}
  return sent;
}

async function createForAsset({message,identity,assetExternalId,text,voicePath='',kind='fault',inspectionReference=''}){
  try{
    const order=await createTelegramWorkshopDraft({message,identity,assetExternalId,problem:text,voicePath,faultCategory:kind==='inspection_issue'?'inspection':kind==='general_asset'?'general_asset':''});
    await setSession(message.chat.id,userId(identity,message),'confirm_maintenance',{maintenanceId:order.id,kind,inspectionReference,startedAt:now()});
    return reply(message.chat.id,`<b>تأكيد بلاغ عطل</b>\n\nأمر مؤقت: <b>${esc(order.reference_no)}</b>\nالأصل: <b>${esc(order.plate_snapshot||assetExternalId)}</b>\nالعطل: ${esc(text)}\nالحالة: مسودة ولم تُفتح رسميًا بعد.`,identity.role==='mechanic',keyboard([[{text:'تأكيد فتح أمر إصلاح',callback_data:`maint_confirm:${order.id}`}],[{text:'إلغاء البلاغ',callback_data:`maint_cancel:${order.id}`}]]));
  }catch(error){
    await clearMaintenanceSession(message.chat.id,userId(identity,message));
    return sendMessage(message.chat.id,`تعذر إنشاء مسودة أمر الصيانة.\nالسبب: ${esc(error.message||'خطأ غير معروف')}`);
  }
}

async function chooseAssetPrompt({message,identity,assets,text,voicePath='',kind='fault',inspectionReference='',prompt=''}){
  const externalUserId=userId(identity,message);
  await setSession(message.chat.id,externalUserId,'choose_vehicle',{problem:text,assetIds:assets.map(item=>item.external_id),voicePath,kind,inspectionReference,startedAt:now()});
  return reply(message.chat.id,prompt||'اختر الأصل الصحيح:',identity.role==='mechanic',keyboard(assets.slice(0,10).map(asset=>[{text:assetLabel(asset),callback_data:`vehicle:${asset.external_id}`}])));
}

export async function createMaintenanceDraft({chatId,messageId,identity,text,plate,voicePath}){
  const message={chat:{id:chatId},message_id:messageId,from:{id:identity.external_id}},query=plate||plateCandidate(text),matches=query?await searchWorkshopAssets(query,15):[];
  if(matches.length===1)return createForAsset({message,identity,assetExternalId:matches[0].external_id,text,voicePath});
  if(matches.length>1)return chooseAssetPrompt({message,identity,assets:matches,text,voicePath,prompt:'فهمت أنها رسالة صيانة، ووجدت أكثر من أصل مطابق. اختر الأصل الصحيح:'});
  const current=await getBotSession(chatId,identity.external_id),attempts=current?.state==='waiting_plate'?Number(current.context?.plateAttempts||1)+1:1;
  if(attempts>=3){await clearMaintenanceSession(chatId,identity.external_id);return reply(chatId,'لم أتمكن من مطابقة أصل مسجل بعد ثلاث محاولات، فأغلقت المسودة. يجب تسجيل الأصل في سجل الأصول أولًا، ولا يُنشأ أمر صيانة بوصف نصي فقط.',true);}
  await setSession(chatId,identity.external_id,'waiting_plate',{problem:text,plate:query,voicePath,plateAttempts:attempts,startedAt:current?.context?.startedAt||now()});
  return reply(chatId,query?'لم أجد أصلًا مطابقًا في سجل الأصول الموحد. أرسل رقم اللوحة أو الأصل الصحيح، أو اكتب «إلغاء».':'لم أجد رقم أصل واضحًا. أرسل اللوحة أو رقم الأصل أو الاسم المسجل، أو اكتب «إلغاء».',true);
}

export async function createGenericMaintenanceDraft({chatId,messageId,identity,text,target='أصل أو معدة بدون لوحة',kind='general_asset',voicePath='',inspectionReference=''}){
  if(kind==='spare_parts')return sendMessage(chatId,'طلب قطع الغيار يجب ربطه بأمر إصلاح مفتوح. اختر «طلب قطع غيار» من قائمة الورشة ثم اختر الأمر.');
  const message={chat:{id:chatId},message_id:messageId,from:{id:identity.external_id}},hint=String(target||text||'').split(/[—\-:\n]/)[0].trim(),matches=await searchWorkshopAssets(hint,15);
  if(matches.length===1)return createForAsset({message,identity,assetExternalId:matches[0].external_id,text,voicePath,kind,inspectionReference});
  if(matches.length)return chooseAssetPrompt({message,identity,assets:matches,text,voicePath,kind,inspectionReference,prompt:'اختر الأصل الفعلي المرتبط بهذا البلاغ:'});
  const recent=await searchWorkshopAssets('',10);
  if(recent.length)return chooseAssetPrompt({message,identity,assets:recent,text,voicePath,kind,inspectionReference,prompt:'لم أجد تطابقًا مباشرًا. اختر الأصل من سجل الأصول:'});
  await clearMaintenanceSession(chatId,identity.external_id);
  return sendMessage(chatId,'لا توجد أصول مسجلة في السجل الموحد. لم يُفتح أمر ناقص. يجب إضافة المعدة أو الأصل أولًا.');
}

export async function continueWaitingPlate(message,identity,session,text,voicePath=''){
  const chatId=message.chat.id,externalUserId=userId(identity,message),updatedAt=Date.parse(session.updated_at||session.context?.startedAt||0);
  if(isCancelText(text)){await clearMaintenanceSession(chatId,externalUserId);await sendMessage(chatId,'تم إلغاء طلب الصيانة المؤقت.');return{handled:true};}
  if(!updatedAt||Date.now()-updatedAt>SESSION_TTL_MS){await clearMaintenanceSession(chatId,externalUserId);return{handled:false,expired:true};}
  const query=plateCandidate(text)||String(text||'').trim();
  if(!query){await clearMaintenanceSession(chatId,externalUserId);return{handled:false,interrupted:true};}
  await createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:session.context?.problem||'بلاغ عطل',plate:query,voicePath:session.context?.voicePath||voicePath});
  return{handled:true};
}

export async function confirmMaintenance(message,id,identity,role){
  if(!allowed(role,'maintenance')&&!allowed(role,'approve'))return sendMessage(message.chat.id,'ليست لديك صلاحية تأكيد أمر الإصلاح.');
  try{
    const order=await confirmTelegramWorkshopOrder(message,identity,id);
    await clearMaintenanceSession(message.chat.id,userId(identity,message));
    return reply(message.chat.id,`تم فتح أمر الإصلاح رسميًا: <b>${esc(order.reference_no)}</b>\nالأصل: <b>${esc(order.plate_snapshot||order.asset_external_id)}</b>\nالحالة: تم الإبلاغ وبانتظار الفحص.`,role==='mechanic');
  }catch(error){return sendMessage(message.chat.id,`تعذر تأكيد الأمر: ${esc(error.message||'تم التعامل معه من قبل')}`);}
}
export async function cancelMaintenance(message,id,identity){
  try{await cancelTelegramWorkshopOrder(message,identity,id);await clearMaintenanceSession(message.chat.id,userId(identity,message));return sendMessage(message.chat.id,'تم إلغاء المسودة دون حذف سجل التدقيق.');}
  catch(error){return sendMessage(message.chat.id,`تعذر الإلغاء: ${esc(error.message||'حالة الأمر تغيرت')}`);}
}
export async function chooseVehicle(message,id,from,identity){
  const session=await getBotSession(message.chat.id,from.id);
  if(session?.state!=='choose_vehicle'||!session.context?.assetIds?.includes(id))return sendMessage(message.chat.id,'انتهت جلسة اختيار الأصل. ابدأ البلاغ من جديد.');
  return createForAsset({message:{...message,from},identity,assetExternalId:id,text:session.context?.problem||'بلاغ عطل',voicePath:session.context?.voicePath||'',kind:session.context?.kind||'fault',inspectionReference:session.context?.inspectionReference||''});
}
