import { requireCapability } from '../permissions.js';
import { json, method, body, errorResponse } from '../http.js';
import { rpc, select } from '../supabase.js';
import { sendMessage } from '../telegram.js';

const allowed=['received','validating','validation_failed','ready_for_review','ready','opened_in_program','approved','processing','posted','partially_failed','rejected','failed','reversed'];
const labels={received:'تم الاستلام',validating:'جارٍ التحقق',validation_failed:'فشل التحقق',ready_for_review:'جاهز للمراجعة',ready:'جاهز للمراجعة',opened_in_program:'فُتح في البرنامج',approved:'تم الاعتماد',processing:'جارٍ الترحيل',posted:'تم الترحيل',partially_failed:'تعذر جزء من الترحيل',rejected:'تم الرفض',failed:'فشلت المعالجة',reversed:'تم العكس'};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const one=value=>Array.isArray(value)?value[0]:value;

async function notifySource(row,nextStatus,note=''){
  if(!row?.source_chat_id)return null;
  const text=`تحديث ملف <b>${esc(row.original_name||'ملف وارد')}</b>\nالحالة: <b>${esc(labels[nextStatus]||nextStatus)}</b>${note?`\nالملاحظة: ${esc(note)}`:''}${row.report_type?`\nالنوع: ${esc(row.report_type)}`:''}\nرقم العملية: <code>${esc(row.id)}</code>`;
  try{return await sendMessage(String(row.source_chat_id),text,{action_name:'import_status_changed',action_payload:{importId:row.id,status:nextStatus}});}
  catch(error){console.warn('[import status Telegram notify]',{status:Number(error?.status||0),message:String(error?.message||'').slice(0,250)});return null;}
}

export async function status(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const input=await body(req),nextStatus=String(input.status||'');
    if(!allowed.includes(nextStatus))throw Object.assign(new Error('الحالة غير صحيحة'),{status:400,code:'IMPORT_STATUS_INVALID'});
    const actor=await requireCapability(req,nextStatus==='opened_in_program'?'daily_report.view':'imports.manage');
    const current=(await select('imports',`id=eq.${encodeURIComponent(input.id)}&select=id,source,source_chat_id,source_message_id,original_name,report_type,status,file_hash,file_path,summary&limit=1`))?.[0];
    if(!current)throw Object.assign(new Error('ملف مركز الوارد غير موجود'),{status:404,code:'IMPORT_NOT_FOUND'});
    const updated=one(await rpc('transition_import_status',{p_import_id:current.id,p_next_status:nextStatus,p_actor:actor.actor,p_note:String(input.note||'').slice(0,500)||null,p_posted_batch_id:input.postedBatchId||null,p_result:input.result&&typeof input.result==='object'?input.result:{}}));
    let telegramNotified=false;
    if(current.status!==nextStatus&&['validating','validation_failed','ready_for_review','opened_in_program','approved','processing','posted','partially_failed','failed','rejected','reversed'].includes(nextStatus))telegramNotified=Boolean(await notifySource({...current,...updated},nextStatus,String(input.note||'')));
    json(res,200,{ok:true,import:updated,telegramNotified});
  }catch(error){errorResponse(res,error);}
}
