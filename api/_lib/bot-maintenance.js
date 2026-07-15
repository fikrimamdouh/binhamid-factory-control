import { config } from './config.js';
import { select, insert, upsert, patch, rpc } from './supabase.js';
import { sendMessage, keyboard, sendVoiceBuffer } from './telegram.js';
import { synthesize } from './ai.js';
import { allowed, extractPlate } from './domain.js';

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
function referenceFrom(result){return String(Array.isArray(result)?result[0]?.next_document_no||result[0]||'':result||'');}
async function nextReference(prefix){return referenceFrom(await rpc('next_document_no',{p_prefix:prefix}));}

export async function getBotSession(chatId,userId){
  return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;
}
async function setSession(chatId,userId,state,context={}){
  const current=await getBotSession(chatId,userId),aiHistory=current?.context?.aiHistory||[];
  return upsert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],'channel,chat_id,external_user_id');
}
export async function clearMaintenanceSession(chatId,userId){
  const current=await getBotSession(chatId,userId);
  return patch('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}`,{state:'idle',context:{aiHistory:current?.context?.aiHistory||[]},updated_at:now()});
}
async function reply(chatId,text,voice=false,extra={}){
  const sent=await sendMessage(chatId,text,extra);
  if(voice&&config.openaiKey){try{const audio=await synthesize(text.replace(/<[^>]+>/g,''));if(audio)await sendVoiceBuffer(chatId,audio);}catch(error){console.error('tts',error.message);}}
  return sent;
}
async function findVehicle(plate){
  const rows=await select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,driver_external_id&limit=1000'),p=String(plate||'').replace(/\s+/g,'').toLowerCase();
  return(rows||[]).filter(v=>[v.plate_no,v.asset_no].some(x=>String(x||'').replace(/\s+/g,'').toLowerCase().includes(p)||p.includes(String(x||'').replace(/\s+/g,'').toLowerCase())));
}

export async function createMaintenanceDraft({chatId,messageId,identity,text,plate,voicePath}){
  const matches=plate?await findVehicle(plate):[];
  if(plate&&matches.length>1){
    await setSession(chatId,identity.external_id,'choose_vehicle',{problem:text,plate,vehicleIds:matches.map(x=>x.external_id),voicePath,startedAt:now()});
    return reply(chatId,'فهمت أن الرسالة بلاغ صيانة. وجدت أكثر من مركبة مطابقة؛ اختر المركبة الصحيحة:',true,keyboard(matches.slice(0,8).map(v=>[{text:`${v.plate_no||v.asset_no} — ${v.vehicle_type||v.make||'مركبة'}`,callback_data:`vehicle:${v.external_id}`}])));
  }
  if(!plate||!matches.length){
    const current=await getBotSession(chatId,identity.external_id),attempts=current?.state==='waiting_plate'?Number(current.context?.plateAttempts||1)+1:1;
    if(attempts>=3){
      await clearMaintenanceSession(chatId,identity.external_id);
      return reply(chatId,'لم أتمكن من مطابقة اللوحة بعد ثلاث محاولات، فأغلقت البلاغ المؤقت. للأصل أو المعدة بلا لوحة استخدم «قائمة الورشة» ثم «بلاغ أصل بدون لوحة».',true);
    }
    await setSession(chatId,identity.external_id,'waiting_plate',{problem:text,plate,voicePath,plateAttempts:attempts,startedAt:current?.context?.startedAt||now()});
    return reply(chatId,plate?'اللوحة غير موجودة في السجل. أرسل رقم اللوحة الصحيح فقط، أو اكتب «إلغاء»، أو افتح بلاغ أصل بدون لوحة.':'رقم اللوحة غير واضح. أرسل الرقم أو آخر أربعة أرقام فقط، أو اكتب «إلغاء»، أو افتح بلاغ أصل بدون لوحة.',true);
  }
  const vehicle=matches[0],reference=await nextReference('RO');
  const rows=await insert('maintenance_orders',[{
    reference_no:reference,vehicle_external_id:vehicle.external_id,plate_snapshot:vehicle.plate_no||vehicle.asset_no,problem:text,status:'draft',
    priority:/حرج|خطر|فرامل|متوقف/.test(text)?'urgent':'normal',vehicle_stopped:/متوقف|واقفة|مش هتشتغل|لا تعمل/.test(text),
    reported_by:identity.user_id,source_channel:'telegram',source_chat_id:String(chatId),source_message_id:String(messageId),voice_path:voicePath||null,reported_at:now()
  }]),order=rows?.[0];
  await setSession(chatId,identity.external_id,'confirm_maintenance',{maintenanceId:order.id,startedAt:now()});
  return reply(chatId,`فهمت البلاغ وسجلته مؤقتًا في مسار الورشة.\n\n<b>تأكيد بلاغ عطل</b>\nأمر مؤقت: <b>${esc(order.reference_no)}</b>\nالمركبة: <b>${esc(vehicle.plate_no||vehicle.asset_no)}</b>\nالعطل: ${esc(text)}\nالحالة: لم يُفتح رسميًا بعد.`,true,keyboard([[{text:'تأكيد فتح أمر إصلاح',callback_data:`maint_confirm:${order.id}`}],[{text:'إلغاء البلاغ',callback_data:`maint_cancel:${order.id}`}]]));
}

export async function createGenericMaintenanceDraft({chatId,messageId,identity,text,target='أصل أو معدة بدون لوحة',kind='general_asset',voicePath='',inspectionReference=''}){
  const spareParts=kind==='spare_parts',reference=await nextReference(spareParts?'SPR':'RO');
  const diagnosis=spareParts?'طلب قطع غيار وتسعير':kind==='inspection_issue'?`نتيجة فحص ${inspectionReference||''}`:'بلاغ أصل أو معدة بدون لوحة';
  const rows=await insert('maintenance_orders',[{
    reference_no:reference,vehicle_external_id:null,plate_snapshot:String(target||'أصل أو طلب عام').slice(0,180),problem:String(text||'').trim(),diagnosis,
    status:'draft',priority:/عاجل|حرج|خطر|متوقف|ضروري/.test(String(text))?'urgent':'normal',vehicle_stopped:/متوقف|لا تعمل|واقف|واقفه|واقفة/.test(String(text)),
    reported_by:identity.user_id,source_channel:'telegram',source_chat_id:String(chatId),source_message_id:String(messageId),voice_path:voicePath||null,reported_at:now()
  }]),order=rows?.[0];
  await setSession(chatId,identity.external_id,spareParts?'confirm_spare_parts':'confirm_maintenance',{maintenanceId:order.id,kind,inspectionReference,startedAt:now()});
  if(spareParts){
    return reply(chatId,`<b>تأكيد طلب قطع غيار وتسعير</b>\n\nالمرجع المؤقت: <b>${esc(order.reference_no)}</b>\nالارتباط: <b>${esc(target)}</b>\nالطلب: ${esc(text)}\n\nلا يلزم رقم لوحة. بعد التأكيد يظهر الطلب ضمن طلبات الأسعار المفتوحة.`,false,keyboard([[{text:'تأكيد طلب الأسعار',callback_data:`parts_confirm:${order.id}`}],[{text:'إلغاء الطلب',callback_data:`maint_cancel:${order.id}`}]]));
  }
  return reply(chatId,`<b>تأكيد أمر إصلاح لأصل بدون لوحة</b>\n\nالمرجع المؤقت: <b>${esc(order.reference_no)}</b>\nالأصل: <b>${esc(target)}</b>\nالعطل أو الملاحظة: ${esc(text)}\n\nبعد التأكيد سيظهر كأمر إصلاح رسمي في سجل الورشة.`,false,keyboard([[{text:'تأكيد فتح أمر الإصلاح',callback_data:`maint_confirm:${order.id}`}],[{text:'إلغاء البلاغ',callback_data:`maint_cancel:${order.id}`}]]));
}

export async function continueWaitingPlate(message,identity,session,text,voicePath=''){
  const chatId=message.chat.id,userId=identity.external_id||message.from.id,updatedAt=Date.parse(session.updated_at||session.context?.startedAt||0);
  if(isCancelText(text)){await clearMaintenanceSession(chatId,userId);await sendMessage(chatId,'تم إلغاء طلب الصيانة المؤقت. يمكنك إرسال أي طلب آخر الآن.');return{handled:true};}
  if(!updatedAt||Date.now()-updatedAt>SESSION_TTL_MS){await clearMaintenanceSession(chatId,userId);return{handled:false,expired:true};}
  const plate=plateCandidate(text);
  if(!plate){await clearMaintenanceSession(chatId,userId);return{handled:false,interrupted:true};}
  await createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:session.context?.problem||'بلاغ عطل',plate,voicePath:session.context?.voicePath||voicePath});
  return{handled:true};
}

export async function confirmMaintenance(message,id,identity,role){
  if(!allowed(role,'maintenance')&&!allowed(role,'approve'))return sendMessage(message.chat.id,'ليست لديك صلاحية تأكيد أمر الإصلاح.');
  const rows=await patch('maintenance_orders',`id=eq.${encodeURIComponent(id)}&status=eq.draft`,{status:'reported',confirmed_at:now(),confirmed_by:identity.user_id,updated_at:now()}),order=rows?.[0];
  if(!order)return sendMessage(message.chat.id,'تم التعامل مع البلاغ من قبل أو لم يعد متاحًا.');
  await insert('maintenance_updates',[{maintenance_id:id,status:'reported',note:'تم تأكيد فتح أمر الإصلاح من Telegram',created_by:identity.user_id,source_channel:'telegram',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)}]);
  await clearMaintenanceSession(message.chat.id,identity.external_id);
  return reply(message.chat.id,`تم فتح أمر الإصلاح رسميًا: <b>${esc(order.reference_no)}</b>\nالأصل: <b>${esc(order.plate_snapshot||'أصل بدون لوحة')}</b>\nالحالة: بانتظار الفحص والتشخيص.`,role==='mechanic');
}
export async function cancelMaintenance(message,id,identity){
  const rows=await patch('maintenance_orders',`id=eq.${encodeURIComponent(id)}&status=eq.draft`,{status:'cancelled',cancelled_at:now(),cancelled_by:identity.user_id,updated_at:now()});
  await clearMaintenanceSession(message.chat.id,identity.external_id);
  return sendMessage(message.chat.id,rows?.length?'تم إلغاء الطلب المؤقت.':'تعذر الإلغاء لأن حالة الطلب تغيرت.');
}
export async function chooseVehicle(message,id,from,identity){
  const session=await getBotSession(message.chat.id,from.id);
  if(session?.state!=='choose_vehicle')return sendMessage(message.chat.id,'انتهت جلسة اختيار المركبة. أرسل البلاغ مرة أخرى.');
  const vehicles=await select('vehicles',`external_id=eq.${encodeURIComponent(id)}&select=plate_no,asset_no&limit=1`);
  return createMaintenanceDraft({chatId:message.chat.id,messageId:message.message_id,identity,text:session.context?.problem||'بلاغ عطل',plate:vehicles?.[0]?.plate_no||vehicles?.[0]?.asset_no,voicePath:session.context?.voicePath||''});
}
