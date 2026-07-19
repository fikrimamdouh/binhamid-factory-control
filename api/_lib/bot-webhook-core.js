import { config } from './config.js';
import { select, insert, upsert, patch, rpc } from './supabase.js';
import { inferDepartment } from './domain.js';
import { enrichIdentity } from './bot-profile.js';
import { sendMessage } from './telegram.js';

const now=()=>new Date().toISOString();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export async function ensureTelegramGroup(chat){
  if(!chat||!['group','supergroup'].includes(chat.type))return{chat_id:String(chat?.id||''),department:'private',active:true,status:'private',title:'المحادثة الخاصة'};
  const id=String(chat.id),old=(await select('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];
  if(old){const rows=await patch('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}`,{title:chat.title||old.title,last_seen_at:now(),updated_at:now()});return rows?.[0]||old;}
  return(await insert('telegram_groups',[{chat_id:id,title:chat.title||'مجموعة تيليجرام',department:inferDepartment(chat.title),active:false,status:'pending',last_seen_at:now()}]))?.[0];
}
async function syncEmployeeMaster(identity,from){
  if(!identity?.active||identity.role==='admin')return null;
  const externalId=String(identity.employee_external_id||`TG-${identity.external_id||from.id}`).slice(0,200),fullName=String(identity.full_name||[from.first_name,from.last_name].filter(Boolean).join(' ')||externalId).slice(0,500);
  const values={external_id:externalId,employee_no:externalId,full_name:fullName,phone:identity.phone||null,role:identity.role||'employee',active:true,nickname:identity.nickname||null,updated_at:now()};
  try{return(await upsert('employees',[values],'external_id'))?.[0]||values;}
  catch(error){console.warn('[telegram employee master sync]',{role:identity.role,message:String(error?.message||'').slice(0,220)});return null;}
}
async function identityWasKnown(externalId){
  try{return Boolean((await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(externalId)}&select=id&limit=1`))?.length);}
  catch(error){console.warn('[telegram identity lookup]',{message:String(error?.message||'').slice(0,220)});return null;}
}
async function notifyOwnerOfNewIdentity(identity,from,wasKnown){
  const owner=String(config.telegramOwnerId||''),externalId=String(from?.id||'');
  if(wasKnown!==false||!owner||!externalId||owner===externalId)return null;
  const fullName=String(identity?.full_name||[from?.first_name,from?.last_name].filter(Boolean).join(' ')||externalId).slice(0,300),username=String(from?.username||'').replace(/^@/,'').slice(0,100),role=String(identity?.role||'pending').slice(0,80),status=identity?.active?'نشط':'بانتظار الاعتماد';
  const text=`<b>دخول مستخدم جديد إلى بوت مصنع بن حامد</b>\n\nالاسم: <b>${esc(fullName)}</b>\nمعرف Telegram: <code>${esc(externalId)}</code>\nاسم المستخدم: <b>${username?`@${esc(username)}`:'غير مسجل'}</b>\nالدور: <b>${esc(role)}</b>\nالحالة: <b>${status}</b>\n\nتم تسجيل أول ظهور له في سجل البوت والموقع.`;
  try{return await sendMessage(owner,text,{action_name:'telegram_user_first_seen',action_payload:{external_id:externalId,role,status:identity?.active?'active':'pending'}});}
  catch(error){console.warn('[telegram owner new user notification]',{externalId,message:String(error?.message||'').slice(0,220)});return null;}
}
export async function ensureTelegramIdentity(from){
  const externalId=String(from.id),wasKnown=await identityWasKnown(externalId);
  const raw=await rpc('register_telegram_identity',{p_external_id:externalId,p_username:String(from.username||''),p_full_name:[from.first_name,from.last_name].filter(Boolean).join(' ')||externalId,p_make_owner:Boolean(config.telegramOwnerId&&externalId===config.telegramOwnerId)});
  const identity=await enrichIdentity(raw,from);await syncEmployeeMaster(identity,from);await notifyOwnerOfNewIdentity(identity,from,wasKnown);return identity;
}
export async function storeTelegramMessage(updateId,message,group,identity){
  const type=message.voice?'voice':message.document?'document':message.photo?'photo':message.location?'location':message.contact?'contact':message.text?'text':'other';
  const text=message.text||message.caption||(message.location?`${message.location.latitude},${message.location.longitude}`:'');
  const senderName=[message.from?.first_name,message.from?.last_name].filter(Boolean).join(' ')||identity?.full_name||String(message.from?.id||'');
  const row={
    update_id:String(updateId),chat_id:String(message.chat.id),message_id:String(message.message_id),group_id:group?.id||null,
    sender_user_id:identity?.user_id||null,sender_external_id:String(message.from?.id||''),sender_name:senderName,chat_type:String(message.chat?.type||''),
    message_type:type,text,transcription:null,file_id:message.voice?.file_id||message.document?.file_id||message.photo?.at(-1)?.file_id||null,
    file_name:message.document?.file_name||null,mime_type:message.document?.mime_type||message.voice?.mime_type||null,file_path:null,
    related_entity_type:null,related_entity_id:null,direction:'incoming',delivery_status:'received',reply_to_message_id:message.reply_to_message?.message_id?String(message.reply_to_message.message_id):null,
    bot_method:null,action_name:null,action_payload:{},raw:{message},created_at:new Date((message.date||Date.now()/1000)*1000).toISOString()
  };
  try{return(await upsert('telegram_messages',[row],'chat_id,message_id'))?.[0]||row;}
  catch(error){
    // Compatibility before migration 003: save the original columns only.
    const legacy={update_id:row.update_id,chat_id:row.chat_id,message_id:row.message_id,group_id:row.group_id,sender_user_id:row.sender_user_id,sender_external_id:row.sender_external_id,message_type:row.message_type,text:row.text,file_id:row.file_id,file_name:row.file_name,mime_type:row.mime_type,raw:row.raw,created_at:row.created_at};
    return(await upsert('telegram_messages',[legacy],'chat_id,message_id'))?.[0]||legacy;
  }
}
