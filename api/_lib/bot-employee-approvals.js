import { insert, patch, rpc, select, upsert } from './supabase.js';
import { keyboard, sendMessage } from './telegram.js';
import { ROLE_LABELS } from './domain.js';
import { registrationRoleLabel } from './bot-registration.js';
import { driverRegistrationReady, driverRegistrationSummary } from './bot-driver-registration.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();
const ROLE_CODES={employee:'e',driver:'d',accountant:'ac',mechanic:'me',block_sales:'bs',concrete_sales:'cs',collector:'co',warehouse:'wh',fuel_operator:'fu',hr:'hr',procurement:'pr',quality:'qu',manager:'mg'};
const CODE_ROLES=Object.fromEntries(Object.entries(ROLE_CODES).map(([role,code])=>[code,role]));
const APPROVABLE_ROLES=Object.keys(ROLE_CODES);

export function isEmployeeRegistrationCommand(text=''){
  const raw=String(text||'').trim(),value=norm(raw);
  return /^\/(registrations|employees)(?:@\w+)?$/i.test(raw)||/^(طلبات تسجيل الموظفين|طلبات اعتماد الموظفين|طلبات التسجيل|الموظفون المنتظرون|الموظفين المنتظرين|حسابات الموظفين المعلقه|حسابات الموظفين المعلقة)$/.test(value);
}
export const roleFromApprovalCode=code=>CODE_ROLES[String(code||'')]||'';
export const isPendingRegistration=row=>Boolean(row&&!row.active&&(!row.role||row.role==='pending'));
function adminOnly(identity){return Boolean(identity?.active&&identity?.role==='admin');}
function roleLabel(role){return ROLE_LABELS[role]||registrationRoleLabel(role)||role||ROLE_LABELS.pending;}
function dateLabel(value){const parsed=Date.parse(value||'');if(!Number.isFinite(parsed))return'غير متاح';return new Date(parsed).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function requestedRole(row){return String(row?.registration?.context?.requestedRole||'');}
function registrationComplete(row){return row?.registration?.state==='registration_submitted';}
async function submittedSessions(){const rows=await select('bot_sessions','channel=eq.telegram&state=eq.registration_submitted&select=external_user_id,state,context,updated_at&order=updated_at.desc&limit=300');const map=new Map();for(const row of rows||[])if(!map.has(String(row.external_user_id)))map.set(String(row.external_user_id),row);return map;}
async function telegramIdsFor(userIds){if(!userIds.length)return new Map();const rows=await select('user_channels',`channel=eq.telegram&user_id=in.(${userIds.map(encodeURIComponent).join(',')})&select=user_id,external_id&limit=200`).catch(()=>[]);return new Map((rows||[]).map(row=>[String(row.user_id),String(row.external_id)]));}
async function pendingRows(){const[rows,sessions]=await Promise.all([select('app_users','active=eq.false&select=id,full_name,role,active,employee_external_id,created_at&order=created_at.asc&limit=100'),submittedSessions()]);const pending=(rows||[]).filter(isPendingRegistration),channels=await telegramIdsFor(pending.map(row=>String(row.id)));return pending.map(row=>{const external=channels.get(String(row.id))||'';return{...row,external_id:external,registration:sessions.get(external)||null};});}
async function registrationById(id){const row=(await select('app_users',`id=eq.${encodeURIComponent(String(id))}&select=id,full_name,role,active,employee_external_id,created_at&limit=1`))?.[0]||null;if(!row)return null;row.external_id=(await telegramIdsFor([String(row.id)])).get(String(row.id))||'';const session=(await select('bot_sessions',`channel=eq.telegram&external_user_id=eq.${encodeURIComponent(String(row.external_id))}&select=external_user_id,state,context,updated_at&order=updated_at.desc&limit=1`))?.[0]||null;return{...row,registration:session};}

function details(row,selectedRole=''){
  const requested=requestedRole(row),context=row.registration?.context||{},lines=['<b>طلب تسجيل موظف</b>',`الاسم: <b>${esc(context.fullName||row.full_name||'غير مسجل')}</b>`,`رقم Telegram: <code>${esc(row.external_id||'—')}</code>`,`وقت التسجيل: <b>${esc(dateLabel(context.submittedAt||row.registration?.updated_at||row.created_at))}</b>`,`الوظيفة التي اختارها الموظف: <b>${esc(requested?registrationRoleLabel(requested):'لم يحدد')}</b>`,`رقم الموظف: <b>${esc(context.employeeExternalId||row.employee_external_id||'غير متوفر')}</b>`,`حالة الفورم: <b>${registrationComplete(row)?'مكتمل ومرسل':'غير مكتمل'}</b>`];
  if(requested==='driver')lines.push('',driverRegistrationSummary(context));
  if(selectedRole)lines.push(`الدور الذي سيُعتمد: <b>${esc(roleLabel(selectedRole))}</b>`);
  if(!row.employee_external_id&&!context.employeeExternalId)lines.push('تنبيه: الحساب غير مربوط برقم موظف داخلي.');
  return lines.join('\n');
}
function roleKeyboard(id,suggested=''){const ordered=suggested&&APPROVABLE_ROLES.includes(suggested)?[suggested,...APPROVABLE_ROLES.filter(role=>role!==suggested)]:APPROVABLE_ROLES,buttons=ordered.map(role=>({text:`${role===suggested?'✓ ':''}${roleLabel(role)}`,callback_data:`ent:er|r|${id}|${ROLE_CODES[role]}`})),rows=[];for(let index=0;index<buttons.length;index+=2)rows.push(buttons.slice(index,index+2));rows.push([{text:'رجوع للطلبات',callback_data:'ent:er|list'}]);return keyboard(rows);}

async function prepareDriverAssignment(row,role){
  if(role!=='driver')return null;
  const context=row.registration?.context||{};
  if(!driverRegistrationReady(context))throw Object.assign(new Error('DRIVER_FORM_INCOMPLETE'),{userMessage:'لا يمكن اعتماد السائق: المركبة أو مستندات الهوية والرخصة غير مكتملة.'});
  const vehicle=(await select('vehicles',`external_id=eq.${encodeURIComponent(String(context.vehicleExternalId))}&active=eq.true&select=external_id,plate_no,asset_no&limit=1`))?.[0];
  if(!vehicle)throw Object.assign(new Error('DRIVER_VEHICLE_INVALID'),{userMessage:'لا يمكن اعتماد السائق: المركبة المختارة غير موجودة أو غير نشطة.'});
  const employeeExternalId=String(context.employeeExternalId||row.employee_external_id||'').slice(0,200)||null,values={employee_external_id:employeeExternalId,vehicle_external_id:String(vehicle.external_id),job_title:'سائق',active:true};
  const existing=(await select('employee_assignments',`app_user_id=eq.${encodeURIComponent(String(row.id))}&active=eq.true&select=id&limit=1`))?.[0];
  if(existing)await patch('employee_assignments',`id=eq.${encodeURIComponent(String(existing.id))}`,values);else await insert('employee_assignments',[{app_user_id:row.id,...values}]);
  return{vehicleExternalId:String(vehicle.external_id),vehicleLabel:context.vehicleLabel||vehicle.plate_no||vehicle.asset_no||String(vehicle.external_id)};
}

export async function sendPendingEmployeeRegistrations(chatId,identity){
  if(!adminOnly(identity))return sendMessage(chatId,'عرض واعتماد تسجيلات الموظفين متاح لمدير النظام فقط.');
  try{const rows=await pendingRows();if(!rows.length)return sendMessage(chatId,'لا توجد طلبات تسجيل موظفين معلقة حاليًا.',keyboard([[{text:'تحديث',callback_data:'ent:er|list'}]]));const buttons=rows.slice(0,20).map(row=>{const requested=requestedRole(row),status=registrationComplete(row)?registrationRoleLabel(requested):'الفورم غير مكتمل';return[{text:`${row.full_name||'بدون اسم'} — ${status}`,callback_data:`ent:er|v|${row.id}`}];});buttons.push([{text:'تحديث القائمة',callback_data:'ent:er|list'}]);const complete=rows.filter(registrationComplete).length,hidden=Math.max(0,rows.length-20);return sendMessage(chatId,`<b>طلبات تسجيل الموظفين</b>\nالإجمالي: <b>${rows.length}</b>\nالفورم المكتمل: <b>${complete}</b>\nغير المكتمل: <b>${rows.length-complete}</b>${hidden?`\nالمعروض: أول 20 طلبًا — متبقٍ ${hidden}`:''}\n\nاختر موظفًا لمراجعة بياناته قبل الاعتماد.`,keyboard(buttons));}catch(error){console.error('[telegram employee registrations list]',error);return sendMessage(chatId,'تعذر قراءة طلبات تسجيل الموظفين من النظام السحابي.');}
}
export async function handleEmployeeRegistrationTextCommand(message,identity,text){if(!isEmployeeRegistrationCommand(text))return false;await sendPendingEmployeeRegistrations(message.chat.id,identity);return true;}
export async function handleEmployeeRegistrationAction(message,from,identity,value){
  if(!String(value||'').startsWith('er|'))return false;if(!adminOnly(identity)){await sendMessage(message.chat.id,'مراجعة واعتماد تسجيلات الموظفين متاح لمدير النظام فقط.');return true;}
  const[,step,id,roleCode]=String(value).split('|');
  try{
    if(step==='list'){await sendPendingEmployeeRegistrations(message.chat.id,identity);return true;}
    const row=await registrationById(id);if(!row){await sendMessage(message.chat.id,'طلب التسجيل غير موجود. حدّث القائمة.');return true;}if(!isPendingRegistration(row)){await sendMessage(message.chat.id,'هذا الحساب لم يعد ضمن طلبات التسجيل المعلقة.');return true;}
    if(step==='v'){const suggested=requestedRole(row);await sendMessage(message.chat.id,`${details(row)}\n\nاختر الدور الذي سيُمنح للموظف بعد الاعتماد:`,roleKeyboard(row.id,suggested));return true;}
    const role=roleFromApprovalCode(roleCode);if(!role){await sendMessage(message.chat.id,'الدور المختار غير صحيح. أعد فتح الطلب.');return true;}
    if(step==='r'){await sendMessage(message.chat.id,`${details(row,role)}\n\nراجع البيانات ثم أكد الاعتماد.`,keyboard([[{text:`تأكيد الاعتماد — ${roleLabel(role)}`,callback_data:`ent:er|a|${row.id}|${roleCode}`}],[{text:'تغيير الدور',callback_data:`ent:er|v|${row.id}`}],[{text:'رجوع للطلبات',callback_data:'ent:er|list'}]]));return true;}
    if(step==='a'){
      const context=row.registration?.context||{},fullName=String(context.fullName||row.full_name||'').slice(0,500),employeeExternalId=String(context.employeeExternalId||row.employee_external_id||'').slice(0,200)||null,assignment=await prepareDriverAssignment(row,role);
      const result=await rpc('approve_telegram_user',{p_external_id:String(row.external_id),p_full_name:fullName,p_role:role,p_active:true,p_employee_external_id:employeeExternalId});
      // اعتماد الموظف عبر البوت كان ينشئ حساب دخول فقط دون سجل موظف، فلا
      // يظهر الاسم في سجل الموظفين ولا في نماذج الإقرار الخاصة بوظيفته.
      // ننشئ السجل هنا (أو نحدّثه إن وُجد) دون المساس بأي موظف آخر.
      try{
        const externalId=employeeExternalId||`tg-${String(row.external_id)}`;
        await upsert('employees',[{external_id:externalId,full_name:fullName||'موظف',role,employee_no:employeeExternalId||null,phone:String(context.phone||'')||null,active:true,updated_at:new Date().toISOString()}],'external_id');
      }catch(employeeError){console.warn('[approve employee record]',String(employeeError?.message||employeeError).slice(0,200));}
      await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.external_id||from?.id||''),action:'approve_telegram_employee_registration',entity_type:'app_user',entity_id:String(row.id),details:{external_id:row.external_id,full_name:fullName,requested_role:requestedRole(row)||null,approved_role:role,employee_external_id:employeeExternalId,preferred_language:context.preferredLanguage||null,driver_vehicle:assignment?.vehicleExternalId||null,driver_documents:context.driverDocuments||null}}],{prefer:'return=minimal'}).catch(()=>{});
      if(row.registration)await patch('bot_sessions',`channel=eq.telegram&external_user_id=eq.${encodeURIComponent(String(row.external_id))}`,{state:'registration_approved',context:{...context,approvedRole:role,approvedAt:new Date().toISOString(),approvedBy:String(identity.external_id||from?.id||'')},updated_at:new Date().toISOString()}).catch(()=>{});
      await sendMessage(message.chat.id,`تم اعتماد الحساب بنجاح.\nالاسم: <b>${esc(fullName||'غير مسجل')}</b>\nالدور: <b>${esc(roleLabel(role))}</b>${assignment?`\nالمركبة: <b>${esc(assignment.vehicleLabel)}</b>`:''}\nرقم Telegram: <code>${esc(row.external_id)}</code>`);
      await sendMessage(row.external_id,`تم اعتماد حسابك في نظام مصنع بن حامد.\nالدور: <b>${esc(roleLabel(role))}</b>${assignment?`\nالمركبة المسندة: <b>${esc(assignment.vehicleLabel)}</b>`:''}\nاستخدم /start لفتح لوحة العمليات.`).catch(error=>console.warn('[telegram employee approval notice]',error?.message||error));
      void result;return true;
    }
    await sendMessage(message.chat.id,'خطوة طلب التسجيل غير صحيحة. حدّث القائمة.');return true;
  }catch(error){console.error('[telegram employee registration action]',error);await sendMessage(message.chat.id,error.userMessage||'تعذر إكمال مراجعة أو اعتماد طلب التسجيل. لم يتغير الحساب.');return true;}
}
