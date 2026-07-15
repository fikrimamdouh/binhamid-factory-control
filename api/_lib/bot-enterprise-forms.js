import { insert } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { SIMPLE_DEFS, optionsKeyboard, statusKeyboard } from './bot-enterprise-defs.js';
import { canFinance, esc, getEnterpriseSession, logEnterpriseEvent, nextEnterpriseReference, numberFrom, setEnterpriseSession, STATUS_LABEL } from './bot-enterprise-store.js';

function mapMethod(value){return({cash:'نقدي',transfer:'تحويل',cheque:'شيك'}[value]||value);}
function mapPriority(value){return({normal:'عادي',urgent:'عاجل',critical:'حرج'}[value]||value);}
function summaryLine(key,value){
  const labels={party:'الطرف/المسؤول',amount:'المبلغ',method:'الطريقة',note:'البيان',item:'الصنف/الموضوع',quantity:'الكمية',expected:'المتوقع',asset:'اللوحة/الأصل',odometer:'العداد',priority:'الأولوية',date_from:'من',date_to:'إلى',due_date:'الموعد',location:'الموقع',result:'النتيجة',phone:'الجوال',title:'العنوان',next_date:'المتابعة'};
  let shown=value;if(key==='method')shown=mapMethod(value);if(key==='priority')shown=mapPriority(value);
  return `${labels[key]||key}: <b>${esc(shown)}</b>`;
}
export async function startEnterpriseForm(message,identity,action){
  const def=SIMPLE_DEFS[action];if(!def)return false;
  const role=identity?.role||'';
  if(def.category==='finance'&&!canFinance(role))return sendMessage(message.chat.id,'هذه العملية متاحة للمدير والمحاسب ومدير النظام.');
  if(def.category==='hr'&&!canFinance(role)&&!['collector','block_sales','concrete_sales','mechanic'].includes(role))return sendMessage(message.chat.id,'لا تملك صلاحية هذه العملية.');
  if(def.category==='quality'&&!['admin','manager','mechanic'].includes(role))return sendMessage(message.chat.id,'تسجيل الجودة والسلامة متاح للمدير ومسؤول الورشة ومدير النظام.');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,`enterprise_form:${action}:0`,{action,data:{},startedAt:new Date().toISOString()});
  const field=def.fields[0];
  if(field[2])return sendMessage(message.chat.id,field[1],optionsKeyboard(action,field[2]));
  return sendMessage(message.chat.id,`${def.title}\n\n${field[1]}\n\nاكتب «إلغاء» للخروج.`);
}
export async function advanceEnterpriseForm(message,identity,session,value){
  const action=session.context?.action||String(session.state||'').split(':')[1],def=SIMPLE_DEFS[action];if(!def)return false;
  const index=Number(String(session.state).split(':')[2]||0),field=def.fields[index],key=field?.[0];if(!key)return false;
  let normalized=String(value||'').trim();
  if(['amount','quantity','expected','odometer'].includes(key)){const n=numberFrom(normalized);if(!n&&normalized!=='0')return sendMessage(message.chat.id,'اكتب قيمة رقمية صحيحة.').then(()=>true);normalized=n;}
  const data={...(session.context?.data||{}),[key]:normalized},nextIndex=index+1;
  if(nextIndex<def.fields.length){
    const nextField=def.fields[nextIndex];
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,`enterprise_form:${action}:${nextIndex}`,{action,data,startedAt:session.context?.startedAt||new Date().toISOString()});
    if(nextField[2])await sendMessage(message.chat.id,nextField[1],optionsKeyboard(action,nextField[2]));else await sendMessage(message.chat.id,nextField[1]);
    return true;
  }
  const reference=await nextEnterpriseReference(def.prefix),status=def.category==='task'?'assigned':def.category==='quality'&&data.priority==='critical'?'under_review':'open';
  const details={reference_no:reference,category:def.category,subtype:def.subtype,title:def.title,status,priority:data.priority||'normal',created_by_user_id:String(identity.user_id||''),created_by_name:displayName(identity,message.from),assigned_to:data.party||displayName(identity,message.from),...data};
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_confirm',{action,reference,details,startedAt:new Date().toISOString()});
  const lines=Object.entries(data).map(([k,v])=>summaryLine(k,v)).join('\n');
  await sendMessage(message.chat.id,`<b>مراجعة ${esc(def.title)}</b>\n\nالمرجع: <b>${esc(reference)}</b>\n${lines}\n\nلم يتم الحفظ النهائي بعد.`,keyboard([[{text:'تأكيد وحفظ',callback_data:`entconfirm:${reference}`},{text:'إلغاء',callback_data:`entcancel:${reference}`}]]));
  return true;
}
export async function confirmEnterpriseForm(message,from,identity,reference){
  const session=await getEnterpriseSession(message.chat.id,identity.external_id||from.id),details=session?.context?.details;
  if(session?.state!=='enterprise_confirm'||!details||String(details.reference_no)!==String(reference))return sendMessage(message.chat.id,'انتهت جلسة التأكيد. ابدأ العملية من جديد.');
  await logEnterpriseEvent({identity,message:{...message,from},action:'enterprise_operation_created',entityType:details.category,entityId:reference,details});
  if(details.category==='quality'&&details.priority==='critical')await insert('discrepancies',[{reference_no:reference,source_type:'telegram_quality',discrepancy_type:details.subtype,severity:'critical',title:details.title,actual_value:details,status:'open',reason:details.note||'',assigned_to:null}]);
  await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);
  return sendMessage(message.chat.id,`تم حفظ ${esc(details.title)} رسميًا.\nالمرجع: <b>${esc(reference)}</b>\nالحالة: <b>${esc(STATUS_LABEL[details.status]||details.status)}</b>.`,statusKeyboard(reference));
}
export async function cancelEnterpriseForm(message,from,identity){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);return sendMessage(message.chat.id,'تم إلغاء العملية المؤقتة.');}
