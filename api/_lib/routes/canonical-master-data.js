import { randomUUID } from 'node:crypto';
import { body,errorResponse,json,method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { insert,patch,rpc,select,upsert } from '../supabase.js';
import { normalizePlate } from '../master-data-workbook.js';
import { syncEmployeeDeclarationRole } from '../employee-declaration-role.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const now=()=>new Date().toISOString();
const today=()=>now().slice(0,10);
const actorOf=identity=>identity.fullName||identity.appUserId||identity.actor||'system';
const ASSET_STATUSES=new Set(['in_service','stopped']);
const WORK_STATUSES=new Set(['working','holiday','leave','suspended']);
const ASSET_TYPES=new Set(['vehicle','equipment','fixed_asset']);
const CENTERS=new Set(['general','block','concrete']);

function referenceId(asset){
  const ref=object(object(asset).metadata).erpReference;
  return clean(ref.externalId||ref.externalKey,200);
}

function employeeStatus(employee){
  const metadata=object(employee.metadata);
  return clean(metadata.manualWorkStatus||metadata.workStatus||'working',40);
}

function linkedTelegram(employeeExternalId,assignments,usersById){
  const rows=(assignments||[])
    .filter(row=>clean(row.employee_external_id)===clean(employeeExternalId)&&row.active!==false)
    .sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  const assignment=rows[0]||null;
  const user=assignment?usersById.get(clean(assignment.app_user_id))||null:null;
  return{assignment,user};
}

function canonicalProjection(asset,erp){
  const metadata=object(asset.metadata);
  const overrides=object(metadata.canonicalOverrides);
  const ref=object(metadata.erpReference);
  const linked=Boolean(erp||referenceId(asset));
  return{
    canonical_external_id:asset.external_id,
    diesel_external_id:asset.diesel_expected===true?asset.external_id:null,
    erp_external_id:erp?.external_id||referenceId(asset)||null,
    source_type:linked?(asset.diesel_expected===true?'diesel_erp':'erp_linked'):(asset.diesel_expected===true?'diesel':'erp'),
    linked,
    diesel_expected:asset.diesel_expected===true,
    plate_no:clean(overrides.plateNo||asset.plate_no||erp?.plate_no||ref.newPlate||ref.oldPlate),
    asset_no:clean(overrides.assetNo||erp?.asset_no||ref.assetNo||asset.asset_no),
    asset_name:clean(overrides.assetName||erp?.asset_name||ref.assetName||asset.asset_name||asset.asset_type),
    asset_type:clean(overrides.assetType||asset.asset_type||erp?.asset_type||ref.assetType||'vehicle'),
    make:clean(overrides.make||erp?.make||ref.make||asset.make),
    model:clean(overrides.model||erp?.model||ref.model||asset.model),
    operational_status:clean(overrides.operationalStatus||asset.operational_status||erp?.operational_status||ref.operationalStatus||'in_service'),
    employee_external_id:clean(asset.assigned_employee_external_id||erp?.assigned_employee_external_id),
    cost_center_code:clean(asset.cost_center_code||erp?.cost_center_code||metadata.costCenterCode),
    purchase_cost:Number(overrides.purchaseCost??object(erp?.metadata).purchaseCost??ref.purchaseCost??metadata.purchaseCost??0),
    source_rows:linked?2:1
  };
}

async function optional(table,query){
  try{return await select(table,query)||[];}
  catch(error){console.warn('[canonical master optional]',table,error?.message||error);return[];}
}

async function loadRegistry(){
  const[assets,employees,vehicles,assignments,users,channels,centers,employeeCenters,workSites]=await Promise.all([
    select('unified_assets','active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,assigned_employee_external_id,operational_status,diesel_expected,make,model,cost_center_code,metadata&order=diesel_expected.desc,asset_name.asc&limit=10000'),
    select('employees','active=eq.true&select=external_id,employee_no,national_id,full_name,phone,role,site,metadata&order=full_name.asc&limit=10000'),
    optional('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status&limit=10000'),
    optional('employee_assignments','active=eq.true&select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active,updated_at&order=updated_at.desc&limit=5000'),
    optional('app_users','active=eq.true&select=id,full_name,role,active,employee_external_id&limit=5000'),
    optional('user_channels','channel=eq.telegram&active=eq.true&select=user_id,external_id,external_username,active&limit=5000'),
    optional('cost_centers','active=eq.true&code=in.(general,block,concrete)&select=id,code,name_ar&order=code.asc'),
    optional('employee_cost_assignments','active=eq.true&select=employee_external_id,cost_center_id,allocation_percent,effective_from,updated_at&order=updated_at.desc&limit=10000'),
    optional('work_sites','active=eq.true&select=id,name,code,active&order=name.asc&limit=500')
  ]);

  const assetById=new Map((assets||[]).map(row=>[clean(row.external_id),row]));
  const referenced=new Set();
  const canonicalAssets=[];
  const parents=[];

  for(const asset of assets||[]){
    if(asset.diesel_expected===true||referenceId(asset))parents.push(asset);
  }
  for(const asset of parents){
    const erpId=referenceId(asset);
    const erp=erpId?assetById.get(erpId)||null:null;
    if(erpId)referenced.add(erpId);
    canonicalAssets.push(canonicalProjection(asset,erp));
  }
  const parentIds=new Set(parents.map(row=>clean(row.external_id)));
  for(const asset of assets||[]){
    if(parentIds.has(clean(asset.external_id))||referenced.has(clean(asset.external_id)))continue;
    canonicalAssets.push(canonicalProjection(asset,null));
  }

  const usersById=new Map((users||[]).map(row=>[clean(row.id),row]));
  const channelByUser=new Map((channels||[]).map(row=>[clean(row.user_id),row]));
  const centerById=new Map((centers||[]).map(row=>[clean(row.id),row]));
  const employeeCenterById=new Map();
  for(const row of employeeCenters||[]){
    const id=clean(row.employee_external_id);
    if(id&&!employeeCenterById.has(id))employeeCenterById.set(id,row);
  }

  const linkedUserIds=new Set();
  const canonicalEmployees=(employees||[]).map(employee=>{
    const{assignment,user}=linkedTelegram(employee.external_id,assignments,usersById);
    if(user)linkedUserIds.add(clean(user.id));
    const center=centerById.get(clean(employeeCenterById.get(clean(employee.external_id))?.cost_center_id));
    const metadata=object(employee.metadata);
    const vehicleId=clean(assignment?.vehicle_external_id)||clean(canonicalAssets.find(asset=>clean(asset.employee_external_id)===clean(employee.external_id))?.canonical_external_id);
    return{
      external_id:employee.external_id,
      employee_no:employee.employee_no||null,
      national_id:employee.national_id||null,
      full_name:employee.full_name,
      phone:employee.phone||null,
      role:employee.role||assignment?.job_title||'employee',
      site:employee.site||null,
      site_id:assignment?.site_id||null,
      work_status:employeeStatus(employee),
      cost_center_code:center?.code||metadata.costCenterCode||null,
      vehicle_external_id:vehicleId||null,
      telegram:user?{
        id:user.id,
        full_name:user.full_name,
        role:user.role,
        username:channelByUser.get(clean(user.id))?.external_username||null,
        job_title:assignment?.job_title||null,
        shift_name:assignment?.shift_name||null,
        site_id:assignment?.site_id||null,
        vehicle_external_id:assignment?.vehicle_external_id||null
      }:null
    };
  });
  const unlinkedTelegramUsers=(users||[])
    .filter(user=>!linkedUserIds.has(clean(user.id))&&!clean(user.employee_external_id))
    .map(user=>({id:user.id,full_name:user.full_name,role:user.role,username:channelByUser.get(clean(user.id))?.external_username||null}));

  return{assets:assets||[],assetById,vehicles:vehicles||[],employees:employees||[],canonicalAssets,canonicalEmployees,unlinkedTelegramUsers,assignments:assignments||[],users:users||[],channels:channels||[],centers:centers||[],workSites:workSites||[]};
}

function resolveCanonical(registry,id){
  const direct=registry.assetById.get(clean(id));
  if(!direct)return null;
  if(direct.diesel_expected===true||referenceId(direct)){
    const erpId=referenceId(direct);
    return{canonical:direct,erp:erpId?registry.assetById.get(erpId)||null:null};
  }
  const parent=(registry.assets||[]).find(row=>referenceId(row)===clean(direct.external_id));
  return parent?{canonical:parent,erp:direct}:{canonical:direct,erp:null};
}

async function audit(identity,action,entityType,entityId,details){
  await insert('audit_log',[{actor_type:'web',actor_id:actorOf(identity),action,entity_type:entityType,entity_id:clean(entityId,200),details}],{prefer:'return=minimal'}).catch(error=>console.error('[canonical master audit]',error));
}

async function findCenter(code){
  if(!code)return null;
  if(!CENTERS.has(code))throw Object.assign(new Error('مركز التكلفة يجب أن يكون عام أو بلوك أو خرسانة.'),{status:400,code:'CANONICAL_COST_CENTER_INVALID'});
  const center=(await select('cost_centers',`code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,code,name_ar&limit=1`))?.[0];
  if(!center)throw Object.assign(new Error('مركز التكلفة غير موجود أو غير نشط.'),{status:409,code:'CANONICAL_COST_CENTER_NOT_READY'});
  return center;
}

async function assignEmployeeCostCenter(identity,employeeExternalId,costCenterCode){
  const stamp=now(),effective=today();
  await patch('employee_cost_assignments',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true`,{active:false,effective_to:effective,updated_at:stamp}).catch(()=>[]);
  if(!costCenterCode)return;
  const center=await findCenter(costCenterCode);
  await upsert('employee_cost_assignments',[{employee_external_id:employeeExternalId,cost_center_id:center.id,allocation_percent:100,effective_from:effective,effective_to:null,active:true,created_by:actorOf(identity),updated_at:stamp}],'employee_external_id,cost_center_id,effective_from');
}

async function assignAssetCostCenter(identity,assetExternalId,assetType,costCenterCode,linkedErpId){
  const stamp=now(),effective=today();
  await patch('asset_cost_center_assignments',`asset_external_id=eq.${encodeURIComponent(assetExternalId)}&active=eq.true`,{active:false,effective_to:effective,updated_at:stamp}).catch(()=>[]);
  if(costCenterCode){
    const center=await findCenter(costCenterCode);
    await upsert('asset_cost_center_assignments',[{asset_external_id:assetExternalId,asset_type:assetType,cost_center_id:center.id,effective_from:effective,effective_to:null,active:true,operational_exception:false,exception_reason:null,created_by:actorOf(identity),updated_at:stamp}],'asset_external_id,effective_from,cost_center_id');
  }
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{cost_center_code:costCenterCode||null,updated_at:stamp});
  if(linkedErpId)await patch('unified_assets',`external_id=eq.${encodeURIComponent(linkedErpId)}`,{cost_center_code:costCenterCode||null,updated_at:stamp});
}

async function clearEmployeeVehicle(employeeExternalId){
  const id=clean(employeeExternalId,200);
  if(!id)return;
  const stamp=now();
  await patch('unified_assets',`assigned_employee_external_id=eq.${encodeURIComponent(id)}&active=eq.true`,{assigned_employee_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('vehicles',`driver_external_id=eq.${encodeURIComponent(id)}&active=eq.true`,{driver_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(id)}&active=eq.true`,{vehicle_external_id:null,updated_at:stamp}).catch(()=>[]);
}

async function assignVehicle(registry,employeeExternalId,assetExternalId){
  const employeeId=clean(employeeExternalId,200),assetId=clean(assetExternalId,200),stamp=now();
  if(employeeId)await clearEmployeeVehicle(employeeId);
  if(!assetId)return;

  const resolved=resolveCanonical(registry,assetId);
  if(!resolved)throw Object.assign(new Error('المركبة المختارة غير موجودة.'),{status:404,code:'CANONICAL_VEHICLE_NOT_FOUND'});
  const type=clean(object(resolved.canonical.metadata).canonicalOverrides?.assetType||resolved.canonical.asset_type||resolved.erp?.asset_type);
  if(type==='fixed_asset')throw Object.assign(new Error('لا يمكن ربط موظف بأصل ثابت. غيّر نوعه إلى سيارة أو معدة أولًا.'),{status:409,code:'CANONICAL_FIXED_ASSET_LINK'});

  const sourceIds=[resolved.canonical.external_id,resolved.erp?.external_id].filter(Boolean);
  const previousEmployees=new Set([resolved.canonical.assigned_employee_external_id,resolved.erp?.assigned_employee_external_id].map(value=>clean(value,200)).filter(value=>value&&value!==employeeId));
  for(const previous of previousEmployees)await clearEmployeeVehicle(previous);
  if(sourceIds.length){
    await patch('employee_assignments',`vehicle_external_id=in.(${sourceIds.map(encodeURIComponent).join(',')})&active=eq.true`,{vehicle_external_id:null,updated_at:stamp}).catch(()=>[]);
  }
  for(const row of [resolved.canonical,resolved.erp].filter(Boolean))await patch('unified_assets',`external_id=eq.${encodeURIComponent(row.external_id)}`,{assigned_employee_external_id:employeeId||null,updated_at:stamp});
  for(const id of sourceIds)await patch('vehicles',`external_id=eq.${encodeURIComponent(id)}`,{driver_external_id:employeeId||null,updated_at:stamp}).catch(()=>[]);
  if(employeeId)await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(employeeId)}&active=eq.true`,{vehicle_external_id:resolved.canonical.external_id,updated_at:stamp}).catch(()=>[]);
}

async function assignTelegram(registry,employee,telegramUserId,siteId,vehicleExternalId,identity){
  const selected=clean(telegramUserId,200);
  const employeeRow=registry.canonicalEmployees.find(row=>clean(row.external_id)===clean(employee.external_id));
  const current=employeeRow?.telegram?.id||'';
  const currentSite=clean(employeeRow?.telegram?.site_id||employeeRow?.site_id,200);
  const resolvedSite=clean(siteId,200)||currentSite;
  const stamp=now();

  if(!selected&&current){
    await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(current)}`,{active:false,vehicle_external_id:null,updated_at:stamp});
    await patch('app_users',`id=eq.${encodeURIComponent(current)}`,{employee_external_id:null,updated_at:stamp});
    return;
  }
  if(!selected)return;

  const user=registry.users.find(row=>clean(row.id)===selected);
  if(!user)throw Object.assign(new Error('حساب Telegram المختار غير موجود أو غير نشط.'),{status:404,code:'CANONICAL_TELEGRAM_NOT_FOUND'});
  const channel=registry.channels.find(row=>clean(row.user_id)===selected);
  if(!channel)throw Object.assign(new Error('حساب Telegram لا يحتوي قناة صالحة.'),{status:409,code:'CANONICAL_TELEGRAM_CHANNEL_MISSING'});
  if(!resolvedSite)throw Object.assign(new Error('اختر موقع العمل قبل ربط Telegram.'),{status:400,code:'CANONICAL_TELEGRAM_SITE_REQUIRED'});

  if(current&&current!==selected){
    await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(current)}`,{active:false,updated_at:stamp});
    await patch('app_users',`id=eq.${encodeURIComponent(current)}`,{employee_external_id:null,updated_at:stamp});
  }
  if(selected!==current)await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(selected)}&active=eq.true`,{active:false,updated_at:stamp}).catch(()=>[]);

  const assignment={app_user_id:selected,employee_external_id:employee.external_id,site_id:resolvedSite,vehicle_external_id:vehicleExternalId||null,job_title:employee.role||user.role||null,shift_name:employeeRow?.telegram?.shift_name||null,active:true,updated_at:stamp};
  await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(employee.external_id)}&app_user_id=neq.${encodeURIComponent(selected)}&active=eq.true`,{active:false,updated_at:stamp}).catch(()=>[]);
  await upsert('employee_assignments',[assignment],'app_user_id');
  await rpc('approve_telegram_user',{p_external_id:channel.external_id,p_full_name:employee.full_name||user.full_name||channel.external_username||channel.external_id,p_role:user.role,p_active:true,p_employee_external_id:employee.external_id});
  await patch('app_users',`id=eq.${encodeURIComponent(selected)}`,{employee_external_id:employee.external_id,updated_at:stamp}).catch(()=>[]);
  await syncEmployeeDeclarationRole(employee.external_id,{jobTitle:assignment.job_title||employee.role||'',telegramRole:user.role||'',source:'canonical_employee_save'}).catch(error=>console.warn('[canonical employee declaration role]',error?.message||error));
  await audit(identity,selected===current?'canonical_employee_telegram_updated':'canonical_employee_telegram_linked','employee',employee.external_id,{appUserId:selected,siteId:resolvedSite,vehicleExternalId:vehicleExternalId||null});
}

function verifyEmployee(registry,expected){
  const row=registry.canonicalEmployees.find(item=>clean(item.external_id)===expected.externalId);
  if(!row)return['السجل'];
  const mismatches=[];
  if(clean(row.full_name)!==expected.fullName)mismatches.push('الاسم');
  if(clean(row.role)!==expected.role)mismatches.push('الوظيفة');
  if(clean(row.work_status)!==expected.workStatus)mismatches.push('الحالة');
  if(clean(row.cost_center_code)!==expected.costCenterCode)mismatches.push('مركز التكلفة');
  if(clean(row.vehicle_external_id)!==expected.vehicleExternalId)mismatches.push('السيارة');
  if(clean(row.telegram?.id)!==expected.telegramUserId)mismatches.push('Telegram');
  return mismatches;
}

async function saveEmployee(req,input){
  const identity=await requireCapability(req,'assets.manage');
  const registry=await loadRegistry();
  const externalId=clean(input.employeeExternalId,200)||`emp-${randomUUID()}`;
  const fullName=clean(input.fullName,240);
  const nationalId=clean(input.nationalId,40).replace(/\D/g,'');
  const employeeNo=clean(input.employeeNo,80);
  const phone=clean(input.phone,80);
  const role=clean(input.role,160);
  const siteInput=clean(input.site,160);
  const siteId=clean(input.siteId,200);
  const workStatus=clean(input.workStatus,40)||'working';
  const costCenterCode=clean(input.costCenterCode,40);
  const vehicleExternalId=clean(input.vehicleExternalId,200);
  const telegramUserId=clean(input.telegramUserId,200);

  if(!fullName)throw Object.assign(new Error('اسم الموظف مطلوب.'),{status:400,code:'CANONICAL_EMPLOYEE_NAME_REQUIRED'});
  if(!WORK_STATUSES.has(workStatus))throw Object.assign(new Error('حالة الموظف غير صحيحة.'),{status:400,code:'CANONICAL_EMPLOYEE_STATUS_INVALID'});
  if(costCenterCode)await findCenter(costCenterCode);
  const duplicate=registry.employees.find(row=>nationalId&&clean(row.national_id).replace(/\D/g,'')===nationalId&&clean(row.external_id)!==externalId);
  if(duplicate)throw Object.assign(new Error(`رقم الهوية مسجل للموظف ${duplicate.full_name}.`),{status:409,code:'CANONICAL_EMPLOYEE_DUPLICATE_ID'});
  const selectedSite=siteId?registry.workSites.find(row=>clean(row.id)===siteId):null;
  if(siteId&&!selectedSite)throw Object.assign(new Error('موقع العمل المختار غير موجود أو غير نشط.'),{status:409,code:'CANONICAL_WORK_SITE_INVALID'});
  if(vehicleExternalId&&!resolveCanonical(registry,vehicleExternalId))throw Object.assign(new Error('السيارة المختارة غير موجودة أو غير نشطة.'),{status:404,code:'CANONICAL_VEHICLE_NOT_FOUND'});
  if(telegramUserId){
    if(!registry.users.some(row=>clean(row.id)===telegramUserId))throw Object.assign(new Error('حساب Telegram المختار غير موجود أو غير نشط.'),{status:404,code:'CANONICAL_TELEGRAM_NOT_FOUND'});
    if(!siteId&&!registry.canonicalEmployees.find(row=>clean(row.external_id)===externalId)?.site_id)throw Object.assign(new Error('اختر موقع العمل قبل ربط Telegram.'),{status:400,code:'CANONICAL_TELEGRAM_SITE_REQUIRED'});
  }

  const existing=registry.employees.find(row=>clean(row.external_id)===externalId);
  const site=siteInput||clean(selectedSite?.name);
  const metadata={...object(existing?.metadata),workStatus,manualWorkStatus:workStatus,costCenterCode:costCenterCode||null,canonicalUpdatedAt:now(),canonicalUpdatedBy:actorOf(identity)};
  const values={external_id:externalId,national_id:nationalId||null,employee_no:employeeNo||null,full_name:fullName,phone:phone||null,role:role||null,site:site||null,active:true,metadata,updated_at:now()};

  await upsert('employees',[values],'external_id');
  await assignEmployeeCostCenter(identity,externalId,costCenterCode);
  const afterEmployee=await loadRegistry();
  await assignVehicle(afterEmployee,externalId,vehicleExternalId);
  const afterVehicle=await loadRegistry();
  await assignTelegram(afterVehicle,values,telegramUserId,siteId,vehicleExternalId,identity);

  const verified=await loadRegistry();
  const mismatches=verifyEmployee(verified,{externalId,fullName,role:role||'employee',workStatus,costCenterCode,vehicleExternalId,telegramUserId});
  if(mismatches.length)throw Object.assign(new Error(`تم إرسال الحفظ لكن لم تتأكد الحقول التالية من السحابة: ${mismatches.join('، ')}.`),{status:502,code:'CANONICAL_EMPLOYEE_SAVE_NOT_CONFIRMED',mismatches});

  await audit(identity,existing?'canonical_employee_updated':'canonical_employee_created','employee',externalId,{fullName,role,vehicleExternalId:vehicleExternalId||null,telegramUserId:telegramUserId||null,costCenterCode:costCenterCode||null,cloudVerified:true});
  return{employeeExternalId:externalId,created:!existing,cloudVerified:true};
}

async function deleteEmployee(req,input){
  const identity=await requireCapability(req,'assets.manage');
  const registry=await loadRegistry();
  const id=clean(input.employeeExternalId,200);
  const employee=registry.employees.find(row=>clean(row.external_id)===id);
  if(!employee)throw Object.assign(new Error('الموظف غير موجود أو محذوف.'),{status:404,code:'CANONICAL_EMPLOYEE_NOT_FOUND'});
  const linked=registry.canonicalEmployees.find(row=>clean(row.external_id)===id)?.telegram;
  if(['admin','owner'].includes(clean(linked?.role)))throw Object.assign(new Error('لا يمكن حذف الموظف المرتبط بحساب مدير النظام.'),{status:409,code:'CANONICAL_EMPLOYEE_ADMIN_PROTECTED'});
  const stamp=now();
  await clearEmployeeVehicle(id);
  await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(id)}&active=eq.true`,{active:false,vehicle_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('app_users',`employee_external_id=eq.${encodeURIComponent(id)}`,{employee_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('employee_cost_assignments',`employee_external_id=eq.${encodeURIComponent(id)}&active=eq.true`,{active:false,effective_to:today(),updated_at:stamp}).catch(()=>[]);
  await patch('employees',`external_id=eq.${encodeURIComponent(id)}`,{active:false,metadata:{...object(employee.metadata),workStatus:'terminated',manualWorkStatus:'terminated',deletedAt:stamp,deletedBy:actorOf(identity)},updated_at:stamp});
  await audit(identity,'canonical_employee_deleted','employee',id,{fullName:employee.full_name});
  return{employeeExternalId:id,deleted:true};
}

function verifyAsset(registry,expected){
  const row=registry.canonicalAssets.find(item=>clean(item.canonical_external_id)===expected.externalId);
  if(!row)return['السجل'];
  const mismatches=[];
  if(clean(row.asset_type)!==expected.assetType)mismatches.push('نوع الأصل');
  if(clean(row.operational_status)!==expected.status)mismatches.push('الحالة');
  if(normalizePlate(row.plate_no)!==normalizePlate(expected.plateNo))mismatches.push('اللوحة');
  if(clean(row.asset_no)!==expected.assetNo)mismatches.push('رقم الأصل');
  if(clean(row.asset_name)!==expected.assetName)mismatches.push('الوصف');
  if(clean(row.employee_external_id)!==expected.employeeExternalId)mismatches.push('الموظف');
  if(clean(row.cost_center_code)!==expected.costCenterCode)mismatches.push('مركز التكلفة');
  if(clean(row.erp_external_id)!==expected.erpExternalId)mismatches.push('ربط ERP');
  if(Boolean(row.diesel_expected)!==Boolean(expected.dieselExpected))mismatches.push('تصنيف الديزل');
  return mismatches;
}

async function saveAsset(req,input){
  const identity=await requireCapability(req,'assets.manage');
  const registry=await loadRegistry();
  const requestedId=clean(input.assetExternalId,200);
  const existing=requestedId?resolveCanonical(registry,requestedId):null;
  const externalId=existing?.canonical.external_id||requestedId||`asset-${randomUUID()}`;
  const plateNo=clean(input.plateNo,100);
  const assetNo=clean(input.assetNo,120);
  const assetName=clean(input.assetName,300);
  const assetType=clean(input.assetType,80)||'vehicle';
  const make=clean(input.make,160);
  const model=clean(input.model,160);
  const status=clean(input.operationalStatus,50)||'in_service';
  const employeeExternalId=clean(input.employeeExternalId,200);
  const costCenterCode=clean(input.costCenterCode,40);
  const submittedDieselExpected=input.dieselExpected===true;
  const dieselExpected=assetType==='fixed_asset'?false:submittedDieselExpected;
  const erpExternalId=clean(input.erpExternalId,200);

  if(!ASSET_TYPES.has(assetType))throw Object.assign(new Error('نوع الأصل يجب أن يكون سيارة أو معدة أو أصل ثابت.'),{status:400,code:'CANONICAL_ASSET_TYPE_INVALID'});
  if(!ASSET_STATUSES.has(status))throw Object.assign(new Error('الحالة يجب أن تكون يعمل أو واقف.'),{status:400,code:'CANONICAL_ASSET_STATUS_INVALID'});
  if(!assetName&&!plateNo&&!assetNo)throw Object.assign(new Error('أدخل اسم الأصل أو اللوحة أو رقم الأصل.'),{status:400,code:'CANONICAL_ASSET_FIELDS_REQUIRED'});
  if(costCenterCode)await findCenter(costCenterCode);
  if(employeeExternalId&&!registry.employees.some(row=>clean(row.external_id)===employeeExternalId))throw Object.assign(new Error('الموظف المختار غير موجود.'),{status:404,code:'CANONICAL_EMPLOYEE_NOT_FOUND'});

  const canonical=existing?.canonical||null;
  const currentErp=existing?.erp||null;
  let selectedErp=currentErp;
  if(erpExternalId&&clean(currentErp?.external_id)!==erpExternalId){
    const candidate=registry.assetById.get(erpExternalId);
    if(!candidate||candidate.diesel_expected===true)throw Object.assign(new Error('أصل ERP المختار غير صالح.'),{status:404,code:'CANONICAL_ERP_NOT_FOUND'});
    if(clean(candidate.external_id)===externalId)throw Object.assign(new Error('لا يمكن ربط الأصل بنفسه كمرجع ERP.'),{status:409,code:'CANONICAL_ERP_SELF_LINK'});
    const owner=registry.assets.find(row=>referenceId(row)===erpExternalId&&clean(row.external_id)!==externalId);
    if(owner)throw Object.assign(new Error('أصل ERP مرتبط بأصل آخر بالفعل.'),{status:409,code:'CANONICAL_ERP_ALREADY_LINKED'});
    selectedErp=candidate;
  }else if(!erpExternalId){
    selectedErp=null;
  }

  if(plateNo){
    const key=normalizePlate(plateNo);
    const allowedIds=new Set([externalId,currentErp?.external_id,erpExternalId].filter(Boolean).map(clean));
    const collision=registry.canonicalAssets.find(row=>normalizePlate(row.plate_no)===key&&!allowedIds.has(clean(row.canonical_external_id)));
    if(collision)throw Object.assign(new Error(`اللوحة ${plateNo} مرتبطة بأصل آخر بالفعل.`),{status:409,code:'CANONICAL_PLATE_DUPLICATE'});
  }

  const oldEmployees=new Set([canonical?.assigned_employee_external_id,currentErp?.assigned_employee_external_id].map(value=>clean(value,200)).filter(Boolean));
  const stamp=now();
  const baseMetadata=object(canonical?.metadata);
  const metadata={...baseMetadata,canonicalOverrides:{plateNo,assetNo,assetName,assetType,make,model,operationalStatus:status,updatedAt:stamp,updatedBy:actorOf(identity)}};
  const assigned=assetType==='fixed_asset'?'':employeeExternalId;
  const values={external_id:externalId,asset_type:assetType,asset_name:assetName||canonical?.asset_name||currentErp?.asset_name||externalId,plate_no:plateNo||null,asset_no:assetNo||null,make:make||null,model:model||null,operational_status:status,diesel_expected:dieselExpected,assigned_employee_external_id:assigned||null,cost_center_code:costCenterCode||null,active:true,metadata,updated_at:stamp};

  for(const oldEmployee of oldEmployees)if(oldEmployee!==assigned)await clearEmployeeVehicle(oldEmployee);
  await upsert('unified_assets',[values],'external_id');

  if(selectedErp){
    const ref={externalId:selectedErp.external_id,assetNo:selectedErp.asset_no||assetNo||null,oldPlate:selectedErp.plate_no||plateNo||null,newPlate:plateNo||selectedErp.plate_no||null,assetName:selectedErp.asset_name||assetName||null,assetType:selectedErp.asset_type||assetType,make:selectedErp.make||make||null,model:selectedErp.model||model||null,purchaseCost:Number(object(selectedErp.metadata).purchaseCost||0),operationalStatus:status};
    await patch('unified_assets',`external_id=eq.${encodeURIComponent(externalId)}`,{metadata:{...metadata,erpReference:ref,manualErpReference:ref,erpReferenceMode:'manual',erpReferenceUpdatedAt:stamp},updated_at:stamp});
    await patch('unified_assets',`external_id=eq.${encodeURIComponent(selectedErp.external_id)}`,{asset_type:assetType,asset_name:values.asset_name,plate_no:values.plate_no,asset_no:values.asset_no,make:values.make,model:values.model,operational_status:status,assigned_employee_external_id:assigned||null,cost_center_code:costCenterCode||null,updated_at:stamp});
  }else if(canonical&&referenceId(canonical)){
    await patch('unified_assets',`external_id=eq.${encodeURIComponent(externalId)}`,{metadata:{...metadata,erpReference:null,manualErpReference:null,erpReferenceMode:'manual',erpReferenceUpdatedAt:stamp},updated_at:stamp});
  }

  const sourceIds=[externalId,selectedErp?.external_id].filter(Boolean);
  if(assetType==='fixed_asset'){
    for(const id of sourceIds)await patch('vehicles',`external_id=eq.${encodeURIComponent(id)}`,{active:false,driver_external_id:null,updated_at:stamp}).catch(()=>[]);
  }else{
    for(const id of sourceIds)await upsert('vehicles',[{external_id:id,plate_no:values.plate_no,asset_no:values.asset_no,vehicle_type:values.asset_name,make:values.make,model:values.model,driver_external_id:assigned||null,status,active:true,updated_at:stamp}],'external_id');
  }

  await assignAssetCostCenter(identity,externalId,assetType,costCenterCode,selectedErp?.external_id||null);
  if(assetType!=='fixed_asset'&&assigned){
    const refreshed=await loadRegistry();
    await assignVehicle(refreshed,assigned,externalId);
  }

  const verified=await loadRegistry();
  const mismatches=verifyAsset(verified,{externalId,assetType,status,plateNo,assetNo,assetName:values.asset_name,employeeExternalId:assigned,costCenterCode,erpExternalId:selectedErp?.external_id||'',dieselExpected});
  if(mismatches.length)throw Object.assign(new Error(`تم إرسال الحفظ لكن لم تتأكد الحقول التالية من السحابة: ${mismatches.join('، ')}.`),{status:502,code:'CANONICAL_ASSET_SAVE_NOT_CONFIRMED',mismatches});

  await audit(identity,existing?'canonical_asset_updated':'canonical_asset_created','unified_asset',externalId,{plateNo:values.plate_no,assetNo:values.asset_no,assetName:values.asset_name,assetType,status,employeeExternalId:assigned||null,erpExternalId:selectedErp?.external_id||null,costCenterCode:costCenterCode||null,dieselExpected,cloudVerified:true});
  return{canonicalExternalId:externalId,created:!existing,erpExternalId:selectedErp?.external_id||null,cloudVerified:true};
}

async function deleteAsset(req,input){
  const identity=await requireCapability(req,'assets.manage');
  const registry=await loadRegistry();
  const resolved=resolveCanonical(registry,input.assetExternalId);
  if(!resolved)throw Object.assign(new Error('الأصل غير موجود أو محذوف.'),{status:404,code:'CANONICAL_ASSET_NOT_FOUND'});
  const stamp=now();
  const ids=[resolved.canonical.external_id,resolved.erp?.external_id].filter(Boolean);
  const employees=new Set([resolved.canonical.assigned_employee_external_id,resolved.erp?.assigned_employee_external_id].map(value=>clean(value,200)).filter(Boolean));
  for(const employee of employees)await clearEmployeeVehicle(employee);
  for(const id of ids){
    await patch('unified_assets',`external_id=eq.${encodeURIComponent(id)}`,{active:false,assigned_employee_external_id:null,metadata:{...object(registry.assetById.get(id)?.metadata),deletedAt:stamp,deletedBy:actorOf(identity)},updated_at:stamp});
    await patch('vehicles',`external_id=eq.${encodeURIComponent(id)}`,{active:false,driver_external_id:null,updated_at:stamp}).catch(()=>[]);
    await patch('employee_assignments',`vehicle_external_id=eq.${encodeURIComponent(id)}&active=eq.true`,{vehicle_external_id:null,updated_at:stamp}).catch(()=>[]);
    await patch('asset_cost_center_assignments',`asset_external_id=eq.${encodeURIComponent(id)}&active=eq.true`,{active:false,effective_to:today(),updated_at:stamp}).catch(()=>[]);
  }
  await audit(identity,'canonical_asset_deleted','unified_asset',resolved.canonical.external_id,{linkedErpExternalId:resolved.erp?.external_id||null});
  return{canonicalExternalId:resolved.canonical.external_id,deleted:true};
}

async function linkErp(req,input){
  const identity=await requireCapability(req,'assets.manage');
  const registry=await loadRegistry();
  const parent=registry.assetById.get(clean(input.dieselExternalId));
  const erp=registry.assetById.get(clean(input.erpExternalId));
  if(!parent)throw Object.assign(new Error('اختر الأصل الأساسي الصحيح.'),{status:404,code:'CANONICAL_PARENT_NOT_FOUND'});
  if(!erp||erp.diesel_expected===true)throw Object.assign(new Error('اختر أصل ERP مستقلًا.'),{status:404,code:'CANONICAL_ERP_NOT_FOUND'});
  if(clean(parent.external_id)===clean(erp.external_id))throw Object.assign(new Error('لا يمكن ربط الأصل بنفسه.'),{status:409,code:'CANONICAL_ERP_SELF_LINK'});
  const owner=registry.assets.find(row=>referenceId(row)===clean(erp.external_id)&&clean(row.external_id)!==clean(parent.external_id));
  if(owner)throw Object.assign(new Error('أصل ERP مرتبط بأصل آخر بالفعل.'),{status:409,code:'CANONICAL_ERP_ALREADY_LINKED'});
  const metadata=object(parent.metadata),erpMetadata=object(erp.metadata);
  const reference={externalId:erp.external_id,assetNo:erp.asset_no||null,oldPlate:erp.plate_no||null,newPlate:erp.plate_no||null,assetName:erp.asset_name||null,assetType:erp.asset_type||null,make:erp.make||null,model:erp.model||null,purchaseCost:Number(erpMetadata.purchaseCost||0),operationalStatus:erp.operational_status||null};
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(parent.external_id)}`,{metadata:{...metadata,erpReference:reference,manualErpReference:reference,erpReferenceMode:'manual',erpReferenceUpdatedAt:now()},updated_at:now()});
  await audit(identity,'canonical_erp_linked','unified_asset',parent.external_id,{erpExternalId:erp.external_id});
  return{dieselExternalId:parent.external_id,erpExternalId:erp.external_id};
}

async function unlinkErp(req,input){
  const identity=await requireCapability(req,'assets.manage');
  const registry=await loadRegistry();
  const parent=registry.assetById.get(clean(input.dieselExternalId));
  if(!parent)throw Object.assign(new Error('الأصل الأساسي غير موجود.'),{status:404,code:'CANONICAL_PARENT_NOT_FOUND'});
  const metadata=object(parent.metadata),previous=referenceId(parent);
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(parent.external_id)}`,{metadata:{...metadata,erpReference:null,manualErpReference:null,erpReferenceMode:'manual',erpReferenceUpdatedAt:now()},updated_at:now()});
  await audit(identity,'canonical_erp_unlinked','unified_asset',parent.external_id,{previousErpExternalId:previous||null});
  return{dieselExternalId:parent.external_id,previousErpExternalId:previous||null};
}

async function autoLink(req){
  const identity=await requireCapability(req,'assets.manage');
  const registry=await loadRegistry();
  const erpByPlate=new Map();
  for(const asset of registry.assets){
    if(asset.diesel_expected===true||referenceId(asset))continue;
    const key=normalizePlate(asset.plate_no);
    if(!key)continue;
    const list=erpByPlate.get(key)||[];
    list.push(asset);
    erpByPlate.set(key,list);
  }
  let linked=0,ambiguous=0,unmatched=0;
  for(const parent of registry.assets.filter(row=>row.diesel_expected===true)){
    if(referenceId(parent))continue;
    const matches=erpByPlate.get(normalizePlate(parent.plate_no))||[];
    if(matches.length===1){await linkErp(req,{dieselExternalId:parent.external_id,erpExternalId:matches[0].external_id});linked++;}
    else if(matches.length>1)ambiguous++;
    else unmatched++;
  }
  await audit(identity,'canonical_exact_plate_autolink','master_data','vehicle-registry',{linked,ambiguous,unmatched});
  return{linked,ambiguous,unmatched};
}

async function responsePayload(){
  const registry=await loadRegistry();
  return{
    canonicalAssets:registry.canonicalAssets,
    canonicalEmployees:registry.canonicalEmployees,
    unlinkedTelegramUsers:registry.unlinkedTelegramUsers,
    telegramUsers:registry.users.map(user=>({id:user.id,full_name:user.full_name,role:user.role,employee_external_id:user.employee_external_id||null,username:registry.channels.find(channel=>clean(channel.user_id)===clean(user.id))?.external_username||null})),
    employees:registry.employees.map(row=>({external_id:row.external_id,full_name:row.full_name,role:row.role||null})),
    erpCandidates:registry.assets.filter(row=>row.diesel_expected!==true&&!referenceId(row)&&!registry.canonicalAssets.some(item=>item.erp_external_id===row.external_id)).map(row=>({external_id:row.external_id,asset_no:row.asset_no||null,plate_no:row.plate_no||null,asset_name:row.asset_name||null,make:row.make||null,model:row.model||null})),
    centers:registry.centers,
    workSites:registry.workSites,
    counts:{
      assets:registry.canonicalAssets.length,
      linkedAssets:registry.canonicalAssets.filter(row=>row.linked).length,
      employees:registry.canonicalEmployees.length,
      telegramLinked:registry.canonicalEmployees.filter(row=>row.telegram).length,
      unlinkedTelegram:registry.unlinkedTelegramUsers.length,
      employeesWithVehicle:registry.canonicalEmployees.filter(row=>row.vehicle_external_id).length,
      workingAssets:registry.canonicalAssets.filter(row=>row.operational_status==='in_service').length,
      stoppedAssets:registry.canonicalAssets.filter(row=>row.operational_status!=='in_service').length
    }
  };
}

export async function canonicalMasterData(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){
      await requireCapability(req,'assets.view');
      return json(res,200,{ok:true,...await responsePayload(),generatedAt:now()});
    }
    const input=await body(req);
    const action=clean(input.action,80);
    let result;
    if(action==='save_employee')result=await saveEmployee(req,input);
    else if(action==='delete_employee')result=await deleteEmployee(req,input);
    else if(action==='save_asset'||action==='update_asset')result=await saveAsset(req,input);
    else if(action==='delete_asset')result=await deleteAsset(req,input);
    else if(action==='link_erp')result=await linkErp(req,input);
    else if(action==='unlink_erp')result=await unlinkErp(req,input);
    else if(action==='auto_link_exact_plate')result=await autoLink(req);
    else throw Object.assign(new Error('إجراء السجل الموحد غير معروف.'),{status:400,code:'CANONICAL_ACTION_UNKNOWN'});
    return json(res,200,{ok:true,result,...await responsePayload(),generatedAt:now()});
  }catch(error){errorResponse(res,error);}
}
