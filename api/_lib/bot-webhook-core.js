import { config } from './config.js';
import { select, insert, upsert, patch, rpc } from './supabase.js';
import { inferDepartment } from './domain.js';
import { enrichIdentity } from './bot-profile.js';

const now=()=>new Date().toISOString();
export async function ensureTelegramGroup(chat){
  if(!chat||!['group','supergroup'].includes(chat.type))return{chat_id:String(chat?.id||''),department:'private',active:true,status:'private',title:'المحادثة الخاصة'};
  const id=String(chat.id),old=(await select('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];
  if(old){const rows=await patch('telegram_groups',`chat_id=eq.${encodeURIComponent(id)}`,{title:chat.title||old.title,last_seen_at:now(),updated_at:now()});return rows?.[0]||old;}
  return(await insert('telegram_groups',[{chat_id:id,title:chat.title||'مجموعة تيليجرام',department:inferDepartment(chat.title),active:false,status:'pending',last_seen_at:now()}]))?.[0];
}
export async function ensureTelegramIdentity(from){
  const raw=await rpc('register_telegram_identity',{p_external_id:String(from.id),p_username:String(from.username||''),p_full_name:[from.first_name,from.last_name].filter(Boolean).join(' ')||String(from.id),p_make_owner:Boolean(config.telegramOwnerId&&String(from.id)===config.telegramOwnerId)});
  return enrichIdentity(raw,from);
}
export async function storeTelegramMessage(updateId,message,group,identity){
  const type=message.voice?'voice':message.document?'document':message.photo?'photo':message.location?'location':message.contact?'contact':message.text?'text':'other';
  const text=message.text||message.caption||(message.location?`${message.location.latitude},${message.location.longitude}`:'');
  const row={update_id:String(updateId),chat_id:String(message.chat.id),message_id:String(message.message_id),group_id:group?.id||null,sender_user_id:identity?.user_id||null,sender_external_id:String(message.from?.id||''),message_type:type,text,file_id:message.voice?.file_id||message.document?.file_id||message.photo?.at(-1)?.file_id||null,file_name:message.document?.file_name||null,mime_type:message.document?.mime_type||message.voice?.mime_type||null,raw:{message},created_at:new Date((message.date||Date.now()/1000)*1000).toISOString()};
  return(await upsert('telegram_messages',[row],'chat_id,message_id'))?.[0]||row;
}
