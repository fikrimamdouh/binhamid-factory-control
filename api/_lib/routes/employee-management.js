import { body, errorResponse, json, method } from '../http.js';
import { insert, patch, rpc, select, upsert } from '../supabase.js';
import { requireCapability } from '../permissions.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const actorOf=identity=>identity?.fullName||identity?.appUserId||identity?.actor||'system';
const now=()=>new Date().toISOString();

async function audit(identity,action,entityId,details={}){
  await insert('audit_log',[{
    actor_type:'web',
    actor_id:actorOf(identity),
    action,
    entity_type:'employee',
    entity_id:clean(entityId,200),
    details
  }],{prefer:'return=minimal'}).catch(()=>{});
}

async function permanentDeleteEmployee(input,identity){
  const employeeExternalId=clean(input.employeeExternalId,200),reason=clean(input.reason,500)||'حذف نهائي من القوائم النشطة';
  if(!employeeExternalId)throw Object.assign(new Error('حدد الموظف المطلوب حذفه.'),{status:400,code:'EMPLOYEE_REQUIRED'});
  const employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&select=external_id,national_id,employee_no,full_name,active,metadata&limit=1`))?.[0];
  if(!employee)throw Object.assign(new Error('الموظف غير موجود أو حُذف سابقًا.'),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  const linkedUsers=await select('app_users',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}&select=id,full_name,role,active&limit=100`).catch(()=>[]);
  if((linkedUsers||[]).some(row=>row.role==='admin'&&row.active!==false))throw Object.assign(new Error('لا يمكن حذف الموظف المرتبط بحساب مدير النظام. افصل حساب المدير أولًا.'),{status:409,code:'EMPLOYEE_OWNER_PROTECTED'});
  const stamp=now(),userIds=(linkedUsers||[]).map(row=>row.id).filter(Boolean);
  await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{active:false,vehicle_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('vehicles',`driver_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{driver_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('unified_assets',`assigned_employee_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{assigned_employee_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('app_users',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{active:false,updated_at:stamp}).catch(()=>[]);
  if(userIds.length)await patch('user_channels',`user_id=in.(${userIds.join(',')})`,{active:false,updated_at:stamp}).catch(()=>[]);
  const metadata={
    ...object(employee.metadata),
    workStatus:'terminated',
    manualWorkStatus:'terminated',
    permanentlyDeleted:true,
    permanentlyDeletedAt:stamp,
    permanentlyDeletedBy:actorOf(identity),
    permanentDeleteReason:reason,
    deletedIdentity:{
      externalId:employee.external_id,
      nationalId:employee.national_id||null,
      employeeNo:employee.employee_no||null,
      fullName:employee.full_name||null
    }
  };
  const updated=(await patch('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}`,{active:false,metadata,updated_at:stamp}))?.[0]||{...employee,active:false,metadata};
  await audit(identity,'employee_permanently_hidden',employeeExternalId,{employeeName:employee.full_name,reason,disabledUsers:userIds.length});
  return{employee:updated,disabledUsers:userIds.length,permanentlyDeleted:true};
}

async function unlinkEmployeeVehicle(input,identity){
  const appUserId=clean(input.appUserId,200),employeeExternalId=clean(input.employeeExternalId,200),requestedVehicleId=clean(input.vehicleExternalId,200);
  if(!appUserId&&!employeeExternalId&&!requestedVehicleId)throw Object.assign(new Error('حدد الموظف أو المركبة المطلوب فك ربطها.'),{status:400,code:'VEHICLE_UNLINK_TARGET_REQUIRED'});
  let assignments=[];
  if(appUserId)assignments=await select('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}&select=app_user_id,employee_external_id,vehicle_external_id,job_title,shift_name,active&limit=100`).catch(()=>[]);
  else if(employeeExternalId)assignments=await select('employee_assignments',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}&select=app_user_id,employee_external_id,vehicle_external_id,job_title,shift_name,active&limit=100`).catch(()=>[]);
  const resolvedEmployeeId=employeeExternalId||clean(assignments?.[0]?.employee_external_id,200),vehicleIds=new Set([requestedVehicleId,...(assignments||[]).map(row=>clean(row.vehicle_external_id,200))].filter(Boolean)),stamp=now();
  if(appUserId)await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}`,{vehicle_external_id:null,updated_at:stamp});
  else if(resolvedEmployeeId)await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(resolvedEmployeeId)}`,{vehicle_external_id:null,updated_at:stamp}).catch(()=>[]);
  for(const vehicleId of vehicleIds){
    await patch('vehicles',`external_id=eq.${encodeURIComponent(vehicleId)}`,{driver_external_id:null,updated_at:stamp}).catch(()=>[]);
    await patch('unified_assets',`external_id=eq.${encodeURIComponent(vehicleId)}`,{assigned_employee_external_id:null,updated_at:stamp}).catch(()=>[]);
  }
  if(resolvedEmployeeId){
    await patch('vehicles',`driver_external_id=eq.${encodeURIComponent(resolvedEmployeeId)}`,{driver_external_id:null,updated_at:stamp}).catch(()=>[]);
    await patch('unified_assets',`assigned_employee_external_id=eq.${encodeURIComponent(resolvedEmployeeId)}`,{assigned_employee_external_id:null,updated_at:stamp}).catch(()=>[]);
  }
  await audit(identity,'employee_vehicle_unlinked',resolvedEmployeeId||appUserId||requestedVehicleId,{appUserId:appUserId||null,employeeExternalId:resolvedEmployeeId||null,vehicleIds:[...vehicleIds]});
  return{appUserId:appUserId||null,employeeExternalId:resolvedEmployeeId||null,vehicleIds:[...vehicleIds],unlinked:true};
}

async function updateAssignmentTask(input,identity){
  const appUserId=clean(input.appUserId,200),jobTitle=clean(input.jobTitle,240),shiftName=clean(input.shiftName,240);
  if(!appUserId)throw Object.assign(new Error('حدد ربط المستخدم المطلوب تعديل مهمته.'),{status:400,code:'ASSIGNMENT_USER_REQUIRED'});
  const previous=(await select('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}&select=app_user_id,employee_external_id,job_title,shift_name,active&limit=1`))?.[0];
  if(!previous)throw Object.assign(new Error('ربط الموظف غير موجود.'),{status:404,code:'ASSIGNMENT_NOT_FOUND'});
  const updated=(await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}`,{job_title:jobTitle||null,shift_name:shiftName||null,updated_at:now()}))?.[0]||{...previous,job_title:jobTitle||null,shift_name:shiftName||null};
  await audit(identity,'employee_assignment_task_updated',previous.employee_external_id||appUserId,{appUserId,previousJobTitle:previous.job_title||null,nextJobTitle:jobTitle||null,previousShiftName:previous.shift_name||null,nextShiftName:shiftName||null});
  return{assignment:updated};
}

async function transferTelegramEmployee(input,identity){
  const appUserId=clean(input.appUserId,200),employeeExternalId=clean(input.employeeExternalId,200),requestedSiteId=clean(input.siteId,200),requestedVehicleId=clean(input.vehicleExternalId,200),requestedJobTitle=clean(input.jobTitle,240),requestedShiftName=clean(input.shiftName,240);
  if(!appUserId||!employeeExternalId)throw Object.assign(new Error('اختر مستخدم Telegram والموظف الجديد.'),{status:400,code:'TELEGRAM_TRANSFER_REQUIRED'});
  const [userRows,channelRows,employeeRows,assignmentRows]=await Promise.all([
    select('app_users',`id=eq.${encodeURIComponent(appUserId)}&select=id,full_name,role,active,employee_external_id&limit=1`),
    select('user_channels',`user_id=eq.${encodeURIComponent(appUserId)}&channel=eq.telegram&select=user_id,external_id,external_username,active&limit=1`),
    select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,role,active,metadata&limit=1`),
    select('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}&select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active&limit=1`).catch(()=>[])
  ]);
  const user=userRows?.[0],channel=channelRows?.[0],employee=employeeRows?.[0],previous=assignmentRows?.[0]||null;
  if(!user||!channel)throw Object.assign(new Error('مستخدم Telegram غير موجود أو غير مرتبط بالقناة.'),{status:404,code:'TELEGRAM_USER_NOT_FOUND'});
  if(!employee)throw Object.assign(new Error('الموظف الجديد غير موجود أو موقوف.'),{status:404,code:'TRANSFER_EMPLOYEE_NOT_FOUND'});
  const siteId=requestedSiteId||clean(previous?.site_id,200),vehicleExternalId=input.keepVehicle===false?'':(requestedVehicleId||clean(previous?.vehicle_external_id,200)),jobTitle=requestedJobTitle||clean(previous?.job_title,240)||clean(employee.role,240),shiftName=requestedShiftName||clean(previous?.shift_name,240),active=input.active===false?false:user.active!==false,stamp=now();
  if(!siteId)throw Object.assign(new Error('اختر موقع العمل قبل نقل الربط.'),{status:400,code:'TRANSFER_SITE_REQUIRED'});
  const site=(await select('work_sites',`id=eq.${encodeURIComponent(siteId)}&active=eq.true&select=id,name,active&limit=1`))?.[0];
  if(!site)throw Object.assign(new Error('موقع العمل غير موجود أو موقوف.'),{status:409,code:'TRANSFER_SITE_INVALID'});
  if(vehicleExternalId){
    const vehicle=(await select('vehicles',`external_id=eq.${encodeURIComponent(vehicleExternalId)}&active=eq.true&select=external_id,active&limit=1`))?.[0];
    if(!vehicle)throw Object.assign(new Error('المركبة الحالية غير موجودة أو موقوفة. ألغِ ربط المركبة ثم أعد المحاولة.'),{status:409,code:'TRANSFER_VEHICLE_INVALID'});
  }
  const assignmentValues={app_user_id:appUserId,employee_external_id:employeeExternalId,site_id:siteId,vehicle_external_id:vehicleExternalId||null,job_title:jobTitle||null,shift_name:shiftName||null,active,updated_at:stamp},assignment=(await upsert('employee_assignments',[assignmentValues],'app_user_id'))?.[0]||assignmentValues;
  try{
    await rpc('approve_telegram_user',{p_external_id:channel.external_id,p_full_name:employee.full_name||user.full_name||channel.external_username||channel.external_id,p_role:user.role,p_active:active,p_employee_external_id:employeeExternalId});
  }catch(error){
    if(previous)await upsert('employee_assignments',[previous],'app_user_id').catch(()=>{});
    else await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}`,{active:false,updated_at:now()}).catch(()=>{});
    throw error;
  }
  await audit(identity,'telegram_user_transferred_to_employee',employeeExternalId,{appUserId,telegramExternalId:channel.external_id,previousEmployeeExternalId:user.employee_external_id||previous?.employee_external_id||null,nextEmployeeExternalId:employeeExternalId,preservedRole:user.role,preservedVehicleExternalId:vehicleExternalId||null,preservedSiteId:siteId});
  return{user:{id:user.id,externalId:channel.external_id,username:channel.external_username||null,role:user.role,active},employee:{externalId:employee.external_id,fullName:employee.full_name},assignment,preserved:{telegramIdentity:true,role:true,conversationHistory:true,vehicle:Boolean(vehicleExternalId),site:true}};
}

export async function employeeManagement(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const identity=await requireCapability(req,'attendance.manage'),input=await body(req),action=clean(input.action,80);
    let result;
    if(action==='permanent_delete_employee')result=await permanentDeleteEmployee(input,identity);
    else if(action==='unlink_employee_vehicle')result=await unlinkEmployeeVehicle(input,identity);
    else if(action==='update_assignment_task')result=await updateAssignmentTask(input,identity);
    else if(action==='transfer_telegram_employee')result=await transferTelegramEmployee(input,identity);
    else throw Object.assign(new Error('إجراء إدارة الموظفين غير معروف.'),{status:400,code:'EMPLOYEE_ACTION_UNKNOWN'});
    return json(res,200,{ok:true,result});
  }catch(error){errorResponse(res,error);}
}
