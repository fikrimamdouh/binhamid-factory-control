import { verifyTelegram } from '../_lib/auth.js';
import { config } from '../_lib/config.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { select, insert, upsert, patch, rpc, uploadObject } from '../_lib/supabase.js';
import { sendMessage, answerCallback, downloadTelegramFile } from '../_lib/telegram.js';
import { inferDepartment, sha256, extractPlate, isFaultMessage, allowed } from '../_lib/domain.js';
import { enrichIdentity, displayName } from '../_lib/bot-profile.js';
import { interpretMessage } from '../_lib/bot-routing.js';
import { reportKeyboard, sendReport } from '../_lib/bot-reports.js';
import { handleExcel, handleAttachment } from '../_lib/bot-files.js';
import { getBotSession, createMaintenanceDraft, continueWaitingPlate, confirmMaintenance, cancelMaintenance, chooseVehicle } from '../_lib/bot-maintenance.js';
import { handleBuiltInCommand } from '../_lib/bot-commands.js';
import { transcribeTelegramVoice, voiceFailureMessage } from '../_lib/bot-voice.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=()=>new Date().toISOString();
async function ensureGroup(chat){
  if(!chat||!['group','supergroup'].includes(chat.type))return{chat_id:String(chat?.id||''),department:'private',active:true,status:'private',title:'المحادثة الخاصة'};
  const id=String(chat.id),old=(await select('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];
  if(old){const rows=await patch('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}`,{title:chat.title||old.title,last_seen_at:now(),updated_at:now()});return rows?.[0]||old;}
  return(await insert('telegram_groups',[{chat_id:id,title:chat.title||'مجموعة تيليجرام',department:inferDepartment(chat.title),active:false,status:'pending',last_seen_at:now()}]))?.[0];
}
async function ensureIdentity(from){
  const raw=await rpc('register_telegram_identity',{p_external_id:String(from.id),p_username:String(from.username||''),p_full_name:[from.first_name,from.last_name].filter(Boolean).join(' ')||String(from.id),p_make_owner:Boolean(config.telegramOwnerId&&String(from.id)===config.telegramOwnerId)});
  return enrichIdentity(raw,from);
}
async function storeMessage(updateId,message,group,identity){
  const type=message.voice?'voice':message.document?'document':message.photo?'photo':message.text?'text':'other';
  const row={update_id:String(updateId),chat_id:String(message.chat.id),message_id:String(message.message_id),group_id:group?.id||null,sender_user_id:identity?.user_id||null,sender_external_id:String(message.from?.id||''),message_type:type,text:message.text||message.caption||'',file_id:message.voice?.file_id||message.document?.file_id||message.photo?.at(-1)?.file_id||null,file_name:message.document?.file_name||null,mime_type:message.document?.mime_type||message.voice?.mime_type||null,raw:{message},created_at:new Date((message.date||Date.now()/1000)*1000).toISOString()};
  return(await upsert('telegram_messages',[row],'update_id'))?.[0]||row;
}
async function handleText(message,group,identity,text,voicePath='',stored=null){
  const chatId=message.chat.id,role=identity.role||'pending',active=Boolean(identity.active),t=String(text||'').trim(),name=displayName(identity,message.from);
  if(await handleBuiltInCommand({message,identity,text:t}))return;
  if(!active)return sendMessage(chatId,`مرحبًا ${esc(name)}. فهمت رسالتك وسجلتها، لكن حسابك غير معتمد لتنفيذ الإجراءات. أرسل رقمك من /whoami إلى مدير النظام.`);
  if(['group','supergroup'].includes(message.chat.type)&&!group.active)return sendMessage(chatId,'فهمت الرسالة وسجلتها، لكن المجموعة لم تعتمد بعد. يجب تحديد قسمها قبل التوجيه النهائي.');
  const session=await getBotSession(chatId,message.from.id);
  if(session?.state==='waiting_plate')return continueWaitingPlate(message,identity,session,t,voicePath);
  if(/^(تقارير|تقرير|ملخص)$/i.test(t)||/اعرض.*تقارير/.test(t)){if(!allowed(role,'report'))return sendMessage(chatId,'فهمت أنك تطلب التقارير، لكن الإجراء متاح لمدير المصنع ومدير النظام فقط.');return sendMessage(chatId,`حاضر ${esc(name)}. اختر التقرير المطلوب:`,reportKeyboard());}
  if((group.department==='workshop'||role==='mechanic'||role==='admin')&&isFaultMessage(t)){if(!allowed(role,'maintenance')&&!allowed(role,'approve'))return sendMessage(chatId,'فهمت أنها رسالة صيانة، لكن دورك لا يسمح بفتح بلاغات الورشة.');return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:t,plate:extractPlate(t),voicePath});}
  const smart=await interpretMessage({message,group,identity,text:t,stored});
  if(smart.route.intent==='report'&&allowed(role,'report'))return sendMessage(chatId,`${smart.response}\n\nاختر التقرير المطلوب:`,reportKeyboard());
  if(smart.route.intent==='maintenance'&&(allowed(role,'maintenance')||allowed(role,'approve')))return createMaintenanceDraft({chatId,messageId:message.message_id,identity,text:t,plate:extractPlate(t),voicePath});
  return sendMessage(chatId,smart.response);
}
async function handleCallback(update){
  const q=update.callback_query,message=q.message,identity=await ensureIdentity(q.from),role=identity.role||'pending';await answerCallback(q.id);
  if(!identity.active)return sendMessage(message.chat.id,'حسابك غير معتمد لتنفيذ هذا الإجراء.');
  const[action,id]=String(q.data||'').split(':');
  if(action==='report'){if(!allowed(role,'report'))return sendMessage(message.chat.id,'ليست لديك صلاحية طلب التقرير.');return sendReport(message.chat.id,id);}
  if(action==='maint_confirm')return confirmMaintenance(message,id,identity,role);
  if(action==='maint_cancel')return cancelMaintenance(message,id,identity);
  if(action==='vehicle')return chooseVehicle(message,id,q.from,identity);
  if(action==='approve'){if(!allowed(role,'approve'))return sendMessage(message.chat.id,'الاعتماد متاح للمدير ومدير النظام فقط.');const result=await rpc('decide_approval',{p_approval_id:id,p_decision:'approved',p_decided_by:identity.user_id,p_note:'اعتماد من Telegram'});return sendMessage(message.chat.id,`تم تسجيل الاعتماد الرسمي.\nالمرجع: <b>${esc(Array.isArray(result)?result[0]?.reference_no||id:id)}</b>`);}
  if(action==='reject'){if(!allowed(role,'approve'))return sendMessage(message.chat.id,'الرفض متاح للمدير ومدير النظام فقط.');await rpc('decide_approval',{p_approval_id:id,p_decision:'rejected',p_decided_by:identity.user_id,p_note:'رفض من Telegram'});return sendMessage(message.chat.id,'تم تسجيل الرفض الرسمي.');}
}
async function handleMessage(update){
  const message=update.message||update.edited_message;if(!message?.from||message.from.is_bot)return;
  const[group,identity]=await Promise.all([ensureGroup(message.chat),ensureIdentity(message.from)]),stored=await storeMessage(update.update_id,message,group,identity);
  if(message.document){const name=message.document.file_name||'';return/\.(xlsx|xls)$/i.test(name)||/spreadsheet|excel/i.test(message.document.mime_type||'')?handleExcel(message,group,identity,stored):handleAttachment(message,group,identity,stored);}
  if(message.photo?.length)return handleAttachment(message,group,identity,stored);
  if(message.voice){
    const downloaded=await downloadTelegramFile(message.voice.file_id),hash=sha256(downloaded.buffer),path=`telegram/${group.department||'unassigned'}/${new Date().toISOString().slice(0,10)}/voice-${hash.slice(0,16)}.ogg`;
    await uploadObject(path,downloaded.buffer,message.voice.mime_type||downloaded.contentType);
    const result=await transcribeTelegramVoice(downloaded.buffer,message.voice.mime_type||downloaded.contentType);
    await patch('telegram_messages',`id=eq.${stored.id}`,{file_path:path,transcription:result.text||null,related_entity_type:result.text?'voice_transcribed':`voice_${result.reason||'failed'}`});
    return result.text?handleText(message,group,identity,result.text,path,stored):sendMessage(message.chat.id,voiceFailureMessage(result));
  }
  return handleText(message,group,identity,String(message.text||message.caption||'').trim(),'',stored);
}
export default async function handler(req,res){
  if(!method(req,res,['POST']))return;let update;
  try{verifyTelegram(req);update=await body(req,2_000_000);}catch(error){return errorResponse(res,error);}
  try{if(update.callback_query)await handleCallback(update);else if(update.message||update.edited_message)await handleMessage(update);}catch(error){console.error('[telegram webhook]',error);}
  json(res,200,{ok:true});
}
