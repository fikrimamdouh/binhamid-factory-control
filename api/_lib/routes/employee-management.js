import { body, errorResponse, json, method } from '../http.js';
import { insert, patch, select } from '../supabase.js';
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

export async function employeeManagement(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const identity=await requireCapability(req,'attendance.manage'),input=await body(req),action=clean(input.action,80);
    let result;
    if(action==='permanent_delete_employee')result=await permanentDeleteEmployee(input,identity);
    else if(action==='unlink_employee_vehicle')result=await unlinkEmployeeVehicle(input,identity);
    else if(action==='update_assignment_task')result=await updateAssignmentTask(input,identity);
    else throw Object.assign(new Error('إجراء إدارة الموظفين غير معروف.'),{status:400,code:'EMPLOYEE_ACTION_UNKNOWN'});
    return json(res,200,{ok:true,result});
  }catch(error){errorResponse(res,error);}
}
