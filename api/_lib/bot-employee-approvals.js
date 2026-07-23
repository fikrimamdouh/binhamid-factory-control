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

async function resolveDriverAssignment(row,role){
  if(role!=='driver')return null;
  const context=row.registration?.context||{};
  if(!driverRegistrationReady(context))throw Object.assign(new Error('DRIVER_FORM_INCOMPLETE'),{userMessage:'لا يمكن اعتماد السائق: المركبة أو مستندات الهوية والرخصة غير مكتملة.'});
  const vehicle=(await select('vehicles',`external_id=eq.${encodeURIComponent(String(context.vehicleExternalId))}&active=eq.true&select=external_id,plate_no,asset_no&limit=1`))?.[0];
  if(!vehicle)throw Object.assign(new Error('DRIVER_VEHICLE_INVALID'),{userMessage:'لا يمكن اعتماد السائق: المركبة المختارة غير موجودة أو غير نشطة.'});
  return{vehicleExternalId:String(vehicle.external_id),vehicleLabel:context.vehicleLabel||vehicle.plate_no||vehicle.asset_no||String(vehicle.external_id)};
}

async function resolveCanonicalEmployee(row,role){
  const context=row.registration?.context||{},fullName=String(context.fullName||row.full_name||'').replace(/\s+/g,' ').trim().slice(0,500);
  const employeeNo=String(context.employeeExternalId||'').trim().slice(0,80);
  const nationalId=String(context.nationalId||context.iqamaNumber||'').replace(/[^0-9]/g,'').slice(0,15);
  let existing=null;
  if(nationalId){
    const byNationalId=await select('employees',`national_id=eq.${encodeURIComponent(nationalId)}&select=external_id,employee_no,national_id,full_name,phone,role,site,metadata&limit=2`).catch(()=>[]);
    if(byNationalId?.length>1)throw Object.assign(new Error('EMPLOYEE_NATIONAL_ID_AMBIGUOUS'),{userMessage:'يوجد أكثر من سجل موظف بنفس الهوية. صحّح السجل الموحد قبل الاعتماد.'});
    existing=byNationalId?.[0]||null;
  }
  if(!existing&&employeeNo){
    existing=(await select('employees',`external_id=eq.${encodeURIComponent(employeeNo)}&select=external_id,employee_no,national_id,full_name,phone,role,site,metadata&limit=1`).catch(()=>[]))?.[0]||null;
    if(!existing){
      const byEmployeeNo=await select('employees',`employee_no=eq.${encodeURIComponent(employeeNo)}&select=external_id,employee_no,national_id,full_name,phone,role,site,metadata&limit=2`).catch(()=>[]);
      if(byEmployeeNo?.length>1)throw Object.assign(new Error('EMPLOYEE_NUMBER_AMBIGUOUS'),{userMessage:'يوجد أكثر من سجل موظف بنفس الرقم الوظيفي. صحّح السجل الموحد قبل الاعتماد.'});
      existing=byEmployeeNo?.[0]||null;
    }
  }
  if(!existing&&fullName){
    const sameName=await select('employees',`full_name=eq.${encodeURIComponent(fullName)}&select=external_id,employee_no,national_id,full_name,phone,role,site,metadata&limit=2`).catch(()=>[]);
    if(sameName?.length===1)existing=sameName[0];
  }
  const externalId=String(existing?.external_id||row.employee_external_id||(nationalId?`nid-${nationalId}`:`tg-${row.external_id}`)).slice(0,200);
  const metadata={...(existing?.metadata&&typeof existing.metadata==='object'?existing.metadata:{}),telegramRegistration:{externalId:String(row.external_id),approvedAt:new Date().toISOString(),role}};
  if(role==='block_sales')metadata.costCenterCode='block';
  if(role==='concrete_sales')metadata.costCenterCode='concrete';
  const record={external_id:externalId,full_name:fullName||existing?.full_name||'موظف',employee_no:employeeNo||existing?.employee_no||null,national_id:nationalId||existing?.national_id||null,phone:String(context.mobile||existing?.phone||'').trim()||null,role,site:existing?.site||null,active:true,metadata,updated_at:new Date().toISOString()};
  await upsert('employees',[record],'external_id');
  return{externalId,fullName:record.full_name,nationalId,employeeNo,existing:Boolean(existing)};
}

async function persistEmployeeAssignment(row,employee,role,driverAssignment){
  const stamp=new Date().toISOString(),userId=String(row.id);
  const current=(await select('employee_assignments',`app_user_id=eq.${encodeURIComponent(userId)}&select=id,site_id,vehicle_external_id,shift_name&limit=1`).catch(()=>[]))?.[0]||null;
  const values={
    employee_external_id:employee.externalId,
    site_id:current?.site_id||null,
    vehicle_external_id:driverAssignment?.vehicleExternalId||current?.vehicle_external_id||null,
    job_title:role,
    shift_name:current?.shift_name||null,
    active:true,
    updated_at:stamp
  };
  await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(employee.externalId)}&app_user_id=neq.${encodeURIComponent(userId)}&active=eq.true`,{active:false,updated_at:stamp}).catch(()=>[]);
  if(current)await patch('employee_assignments',`id=eq.${encodeURIComponent(String(current.id))}`,values);
  else await insert('employee_assignments',[{app_user_id:userId,...values}]);
  await patch('app_users',`employee_external_id=eq.${encodeURIComponent(employee.externalId)}&id=neq.${encodeURIComponent(userId)}`,{employee_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('app_users',`id=eq.${encodeURIComponent(userId)}`,{employee_external_id:employee.externalId,updated_at:stamp});
  if(driverAssignment?.vehicleExternalId){
    const vehicleId=driverAssignment.vehicleExternalId;
    await patch('employee_assignments',`vehicle_external_id=eq.${encodeURIComponent(vehicleId)}&app_user_id=neq.${encodeURIComponent(userId)}&active=eq.true`,{vehicle_external_id:null,updated_at:stamp}).catch(()=>[]);
    await patch('vehicles',`external_id=eq.${encodeURIComponent(vehicleId)}`,{driver_external_id:employee.externalId,updated_at:stamp}).catch(()=>[]);
    await patch('unified_assets',`external_id=eq.${encodeURIComponent(vehicleId)}&active=eq.true`,{assigned_employee_external_id:employee.externalId,updated_at:stamp}).catch(()=>[]);
  }
  return values;
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
      const context=row.registration?.context||{},driverAssignment=await resolveDriverAssignment(row,role);
      const employee=await resolveCanonicalEmployee(row,role);
      const assignment=await persistEmployeeAssignment(row,employee,role,driverAssignment);
      const result=await rpc('approve_telegram_user',{p_external_id:String(row.external_id),p_full_name:employee.fullName,p_role:role,p_active:true,p_employee_external_id:employee.externalId});
      await insert('audit_log',[{actor_type:'telegram',actor_id:String(identity.external_id||from?.id||''),action:'approve_telegram_employee_registration',entity_type:'app_user',entity_id:String(row.id),details:{external_id:row.external_id,full_name:employee.fullName,requested_role:requestedRole(row)||null,approved_role:role,employee_external_id:employee.externalId,linked_existing_employee:employee.existing,preferred_language:context.preferredLanguage||null,driver_vehicle:driverAssignment?.vehicleExternalId||null,driver_documents:context.driverDocuments||null}}],{prefer:'return=minimal'}).catch(()=>{});
      if(row.registration)await patch('bot_sessions',`channel=eq.telegram&external_user_id=eq.${encodeURIComponent(String(row.external_id))}`,{state:'registration_approved',context:{...context,approvedRole:role,approvedAt:new Date().toISOString(),approvedBy:String(identity.external_id||from?.id||'')},updated_at:new Date().toISOString()}).catch(()=>{});
      await sendMessage(message.chat.id,`تم اعتماد الحساب وربطه بسجل الموظف نفسه.\nالاسم: <b>${esc(employee.fullName||'غير مسجل')}</b>\nالدور: <b>${esc(roleLabel(role))}</b>${driverAssignment?`\nالمركبة: <b>${esc(driverAssignment.vehicleLabel)}</b>`:''}\nرقم Telegram: <code>${esc(row.external_id)}</code>`);
      await sendMessage(row.external_id,`تم اعتماد حسابك في نظام مصنع بن حامد وربطه بسجل الموظف.\nالدور: <b>${esc(roleLabel(role))}</b>${driverAssignment?`\nالمركبة المسندة: <b>${esc(driverAssignment.vehicleLabel)}</b>`:''}\nاستخدم /start لفتح لوحة العمليات.`).catch(error=>console.warn('[telegram employee approval notice]',error?.message||error));
      void result;void assignment;return true;
    }
    await sendMessage(message.chat.id,'خطوة طلب التسجيل غير صحيحة. حدّث القائمة.');return true;
  }catch(error){console.error('[telegram employee registration action]',error);await sendMessage(message.chat.id,error.userMessage||'تعذر إكمال مراجعة أو اعتماد طلب التسجيل. لم يتغير الحساب.');return true;}
}
