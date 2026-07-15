import { select, insert, rpc } from './supabase.js';
import { displayName, roleLabel } from './bot-profile.js';

export const now=()=>new Date().toISOString();
export const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
export const normalizeDigits=value=>String(value||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/٬/g,'');
export const numberFrom=value=>{const match=normalizeDigits(value).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return match?Number(match[0]):0;};
export const ACTIVE_STATUS=new Set(['open','pending','assigned','in_progress','waiting','overdue','under_review']);
export const STATUS_LABEL={open:'مفتوح',pending:'ينتظر مراجعة',assigned:'مسند',in_progress:'قيد التنفيذ',waiting:'بانتظار طرف آخر',overdue:'متأخر',under_review:'قيد المراجعة',approved:'معتمد',rejected:'مرفوض',completed:'مكتمل',cancelled:'ملغي',closed:'مغلق'};
export const CATEGORY_LABEL={task:'مهمة',collection:'تحصيل',finance:'عملية مالية',inventory:'حركة مخزون',fuel:'تعبئة ديزل',hr:'موارد بشرية',quality:'جودة ورقابة',trip:'رحلة',purchase:'طلب شراء',customer:'عميل',incident:'بلاغ تشغيلي'};
export const canManage=role=>['admin','manager'].includes(role);
export const canFinance=role=>['admin','manager','accountant'].includes(role);

export async function getEnterpriseSession(chatId,userId){
  return(await select('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(chatId))}&external_user_id=eq.${encodeURIComponent(String(userId))}&select=*&limit=1`))?.[0]||null;
}
export async function setEnterpriseSession(chatId,userId,state,context={}){
  const old=await getEnterpriseSession(chatId,userId),aiHistory=old?.context?.aiHistory||[];
  return insert('bot_sessions',[{channel:'telegram',chat_id:String(chatId),external_user_id:String(userId),state,context:{aiHistory,...context},updated_at:now()}],{query:'on_conflict=channel,chat_id,external_user_id',prefer:'resolution=merge-duplicates,return=representation'});
}
export async function nextEnterpriseReference(prefix){
  const result=await rpc('next_document_no',{p_prefix:prefix});
  return String(Array.isArray(result)?result[0]?.next_document_no||result[0]||'':result||'');
}
export async function logEnterpriseEvent({identity,message,action,entityType,entityId,details}){
  return insert('audit_log',[{
    actor_type:'telegram',actor_id:String(identity?.user_id||identity?.external_id||message.from.id),action,entity_type:entityType,entity_id:String(entityId||''),
    details:{...details,actor_name:displayName(identity,message.from),actor_role:identity?.role||'',actor_role_label:roleLabel(identity?.role||'pending'),telegram_user_id:String(message.from.id),chat_id:String(message.chat.id),source_message_id:String(message.message_id),event_at:now()},created_at:now()
  }]);
}
export async function enterpriseEvents(limit=700){
  return await select('audit_log',`action=in.(enterprise_operation_created,enterprise_operation_status)&select=action,entity_type,entity_id,details,created_at&order=created_at.desc&limit=${limit}`)||[];
}
export function reduceEnterpriseOperations(events){
  const map=new Map();
  for(const event of [...events].reverse()){
    const id=String(event.entity_id||event.details?.reference_no||'');if(!id)continue;
    const current=map.get(id)||{};
    if(event.action==='enterprise_operation_created')map.set(id,{...event.details,reference_no:id,created_at:event.created_at});
    else if(event.action==='enterprise_operation_status')map.set(id,{...current,status:event.details?.status||current.status,status_note:event.details?.note||current.status_note,updated_at:event.created_at});
  }
  return [...map.values()];
}
export function formatAmount(value){return Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});}
export function operationLine(op){
  return `• <b>${esc(op.reference_no)}</b> — ${esc(op.title||CATEGORY_LABEL[op.category]||op.category)}\n  ${esc(op.party||op.item||op.asset||op.note||'').slice(0,150)}${op.amount?`\n  المبلغ: ${formatAmount(op.amount)} ر.س`:''}\n  الحالة: ${esc(STATUS_LABEL[op.status]||op.status||'مفتوح')}`;
}
