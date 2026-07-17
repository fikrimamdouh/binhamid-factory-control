import { insert, rpc, select } from './supabase.js';
import { keyboard, sendMessage } from './telegram.js';
import { ROLE_LABELS } from './domain.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();
const ROLE_CODES={
  employee:'e',driver:'d',accountant:'ac',mechanic:'me',block_sales:'bs',concrete_sales:'cs',collector:'co',warehouse:'wh',fuel_operator:'fu',hr:'hr',procurement:'pr',quality:'qu',manager:'mg'
};
const CODE_ROLES=Object.fromEntries(Object.entries(ROLE_CODES).map(([role,code])=>[code,role]));
const APPROVABLE_ROLES=Object.keys(ROLE_CODES);

export function isEmployeeRegistrationCommand(text=''){
  const raw=String(text||'').trim(),value=norm(raw);
  return /^\/(registrations|employees)(?:@\w+)?$/i.test(raw)||/^(طلبات تسجيل الموظفين|طلبات اعتماد الموظفين|طلبات التسجيل|الموظفون المنتظرون|الموظفين المنتظرين|حسابات الموظفين المعلقه|حسابات الموظفين المعلقة)$/.test(value);
}
export const roleFromApprovalCode=code=>CODE_ROLES[String(code||'')]||'';
export const isPendingRegistration=row=>Boolean(row&&!row.active&&(!row.role||row.role==='pending'));

function adminOnly(identity){return Boolean(identity?.active&&identity?.role==='admin');}
function roleLabel(role){return ROLE_LABELS[role]||role||ROLE_LABELS.pending;}
function dateLabel(value){
  const parsed=Date.parse(value||'');
  if(!Number.isFinite(parsed))return'غير متاح';
  return new Date(parsed).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
async function pendingRows(){
  const rows=await select('app_users','active=eq.false&select=id,external_id,full_name,role,active,employee_external_id,created_at&order=created_at.asc&limit=100');
  return(rows||[]).filter(isPendingRegistration);
}
async function registrationById(id){
  return(await select('app_users',`id=eq.${encodeURIComponent(String(id))}&select=id,external_id,full_name,role,active,employee_external_id,created_at&limit=1`))?.[0]||null;
}
function details(row,selectedRole=''){
  const lines=[
    '<b>طلب تسجيل موظف</b>',
    `الاسم: <b>${esc(row.full_name||'غير مسجل')}</b>`,
    `رقم Telegram: <code>${esc(row.external_id||'—')}</code>`,
    `وقت التسجيل: <b>${esc(dateLabel(row.created_at))}</b>`,
    `الدور الحالي: <b>${esc(roleLabel(row.role))}</b>`,
    `مرجع الموظف: <b>${esc(row.employee_external_id||'غير مربوط بسجل موظف')}</b>`
  ];
  if(selectedRole)lines.push(`الدور المختار: <b>${esc(roleLabel(selectedRole))}</b>`);
  if(!row.employee_external_id)lines.push('تنبيه: الاعتماد سيُنشّط الحساب دون ربطه بسجل موظف؛ يمكن تنفيذ الربط لاحقًا من صفحة الإدارة.');
  return lines.join('\n');
}
function roleKeyboard(id){
  const buttons=APPROVABLE_ROLES.map(role=>({text:roleLabel(role),callback_data:`ent:er|r|${id}|${ROLE_CODES[role]}`}));
  const rows=[];for(let index=0;index<buttons.length;index+=2)rows.push(buttons.slice(index,index+2));
  rows.push([{text:'رجوع للطلبات',callback_data:'ent:er|list'}]);
  return keyboard(rows);
}

export async function sendPendingEmployeeRegistrations(chatId,identity){
  if(!adminOnly(identity))return sendMessage(chatId,'عرض واعتماد تسجيلات الموظفين متاح لمدير النظام فقط.');
  try{
    const rows=await pendingRows();
    if(!rows.length)return sendMessage(chatId,'لا توجد طلبات تسجيل موظفين معلقة حاليًا.',keyboard([[{text:'تحديث',callback_data:'ent:er|list'}]]));
    const buttons=rows.slice(0,20).map(row=>[{text:`${row.full_name||'بدون اسم'} — ${row.external_id||'بدون رقم'}`,callback_data:`ent:er|v|${row.id}`}]);
    buttons.push([{text:'تحديث القائمة',callback_data:'ent:er|list'}]);
    const hidden=Math.max(0,rows.length-20);
    return sendMessage(chatId,`<b>طلبات تسجيل الموظفين المعلقة</b>\nالإجمالي: <b>${rows.length}</b>${hidden?`\nالمعروض: أول 20 طلبًا — متبقٍ ${hidden}`:''}\nاختر موظفًا لمراجعة بياناته قبل الاعتماد.`,keyboard(buttons));
  }catch(error){console.error('[telegram employee registrations list]',error);return sendMessage(chatId,'تعذر قراءة طلبات تسجيل الموظفين من النظام السحابي.');}
}

export async function handleEmployeeRegistrationTextCommand(message,identity,text){
  if(!isEmployeeRegistrationCommand(text))return false;
  await sendPendingEmployeeRegistrations(message.chat.id,identity);return true;
}

export async function handleEmployeeRegistrationAction(message,from,identity,value){
  if(!String(value||'').startsWith('er|'))return false;
  if(!adminOnly(identity)){await sendMessage(message.chat.id,'مراجعة واعتماد تسجيلات الموظفين متاح لمدير النظام فقط.');return true;}
  const[,step,id,roleCode]=String(value).split('|');
  try{
    if(step==='list'){await sendPendingEmployeeRegistrations(message.chat.id,identity);return true;}
    const row=await registrationById(id);
    if(!row){await sendMessage(message.chat.id,'طلب التسجيل غير موجود. حدّث القائمة.');return true;}
    if(!isPendingRegistration(row)){await sendMessage(message.chat.id,'هذا الحساب لم يعد ضمن طلبات التسجيل المعلقة.');return true;}
    if(step==='v'){
      await sendMessage(message.chat.id,`${details(row)}\n\nاختر الدور المطلوب قبل الاعتماد:`,roleKeyboard(row.id));return true;
    }
    const role=roleFromApprovalCode(roleCode);
    if(!role){await sendMessage(message.chat.id,'الدور المختار غير صحيح. أعد فتح الطلب.');return true;}
    if(step==='r'){
      await sendMessage(message.chat.id,`${details(row,role)}\n\nراجع البيانات ثم أكد الاعتماد.`,keyboard([[{text:`تأكيد الاعتماد — ${roleLabel(role)}`,callback_data:`ent:er|a|${row.id}|${roleCode}`}],[{text:'تغيير الدور',callback_data:`ent:er|v|${row.id}`}],[{text:'رجوع للطلبات',callback_data:'ent:er|list'}]]));return true;
    }
    if(step==='a'){
      const result=await rpc('approve_telegram_user',{p_external_id:String(row.external_id),p_full_name:String(row.full_name||'').slice(0,500),p_role:role,p_active:true,p_employee_external_id:String(row.employee_external_id||'').slice(0,200)||null});
      await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.external_id||from?.id||''),action:'approve_telegram_employee_registration',entity_type:'app_user',entity_id:String(row.id),details:{external_id:row.external_id,full_name:row.full_name,role,employee_external_id:row.employee_external_id||null}}],{prefer:'return=minimal'}).catch(()=>{});
      await sendMessage(message.chat.id,`تم اعتماد الحساب بنجاح.\nالاسم: <b>${esc(row.full_name||'غير مسجل')}</b>\nالدور: <b>${esc(roleLabel(role))}</b>\nرقم Telegram: <code>${esc(row.external_id)}</code>`);
      await sendMessage(row.external_id,`تم اعتماد حسابك في نظام مصنع بن حامد.\nالدور: <b>${esc(roleLabel(role))}</b>\nاستخدم /start لفتح لوحة الموظف.`).catch(error=>console.warn('[telegram employee approval notice]',error?.message||error));
      void result;return true;
    }
    await sendMessage(message.chat.id,'خطوة طلب التسجيل غير صحيحة. حدّث القائمة.');return true;
  }catch(error){console.error('[telegram employee registration action]',error);await sendMessage(message.chat.id,'تعذر إكمال مراجعة أو اعتماد طلب التسجيل. لم يتغير الحساب.');return true;}
}
