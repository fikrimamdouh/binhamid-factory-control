import { requireAdminOrDevice } from '../auth.js';
import { requireCapability } from '../permissions.js';
import { json, method, body, errorResponse } from '../http.js';
import { patch, select } from '../supabase.js';
import { sendMessage } from '../telegram.js';

const allowed=['received','processing','ready','failed','opened_in_program','approved','rejected'];
const labels={received:'تم الاستلام',processing:'جارٍ المعالجة',ready:'جاهز للمراجعة',failed:'فشل الفحص',opened_in_program:'فُتح في البرنامج',approved:'تم الاعتماد',rejected:'تم الرفض'};
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

async function notifySource(row,nextStatus,note=''){
  if(!row?.source_chat_id)return null;
  const text=`تحديث ملف <b>${esc(row.original_name||'ملف وارد')}</b>\nالحالة: <b>${esc(labels[nextStatus]||nextStatus)}</b>${note?`\nالملاحظة: ${esc(note)}`:''}${row.report_type?`\nالنوع: ${esc(row.report_type)}`:''}`;
  try{return await sendMessage(String(row.source_chat_id),text,{action_name:'import_status_changed',action_payload:{importId:row.id,status:nextStatus}});}
  catch(error){console.warn('[import status Telegram notify]',error?.message||error);return null;}
}

export async function status(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const input=await body(req),nextStatus=String(input.status||'');
    if(!allowed.includes(nextStatus))throw Object.assign(new Error('الحالة غير صحيحة'),{status:400,code:'IMPORT_STATUS_INVALID'});
    // The device can only report that a file was opened. All business status changes require a real active user.
    const actor=nextStatus==='opened_in_program'?requireAdminOrDevice(req,'imports.status.sync'):await requireCapability(req,'imports.manage');
    const current=(await select('imports',`id=eq.${encodeURIComponent(input.id)}&select=id,source,source_chat_id,source_message_id,original_name,report_type,status,file_hash,file_path,summary&limit=1`))?.[0];
    if(!current)throw Object.assign(new Error('ملف مركز الوارد غير موجود'),{status:404,code:'IMPORT_NOT_FOUND'});
    const values={status:nextStatus,updated_at:new Date().toISOString()};
    if(input.note)values.summary={...(current.summary||{}),lastStatusNote:String(input.note).slice(0,500),lastStatusActor:actor.actor,lastStatusAt:new Date().toISOString()};
    const rows=await patch('imports',`id=eq.${encodeURIComponent(input.id)}`,values),updated=rows?.[0]||{...current,...values};
    let telegramNotified=false;
    if(current.status!==nextStatus&&['processing','ready','failed','opened_in_program','approved','rejected'].includes(nextStatus))telegramNotified=Boolean(await notifySource(updated,nextStatus,String(input.note||'')));
    json(res,200,{ok:true,import:updated,telegramNotified});
  }catch(error){errorResponse(res,error);}
}
