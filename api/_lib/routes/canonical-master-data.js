import { body,errorResponse,json,method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { insert,patch,select,upsert } from '../supabase.js';
import { normalizePlate } from '../master-data-workbook.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const now=()=>new Date().toISOString();
const today=()=>now().slice(0,10);
const actorOf=identity=>identity.fullName||identity.appUserId||identity.actor||'system';
const STATUSES=new Set(['in_service','maintenance','spare','out_of_service','stopped','parked','sold']);
const CENTERS=new Set(['general','block','concrete']);

function referenceId(asset){const ref=object(object(asset).metadata).erpReference;return clean(ref.externalId||ref.externalKey,200);}
function employeeStatus(employee){const metadata=object(employee.metadata);return clean(metadata.manualWorkStatus||metadata.workStatus||'working',40);}
function linkedTelegram(employeeExternalId,assignments,usersById){
  const rows=(assignments||[]).filter(row=>clean(row.employee_external_id)===clean(employeeExternalId)&&row.active!==false).sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||''))),assignment=rows[0]||null,user=assignment?usersById.get(clean(assignment.app_user_id))||null:null;
  return{assignment,user};
}
function canonicalProjection(asset,erp){
  const metadata=object(asset.metadata),overrides=object(metadata.canonicalOverrides),ref=object(metadata.erpReference),linked=Boolean(erp||referenceId(asset));
  return{
    canonical_external_id:asset.external_id,
    diesel_external_id:asset.diesel_expected===true?asset.external_id:null,
    erp_external_id:erp?.external_id||referenceId(asset)||null,
    source_type:linked?'diesel_erp':asset.diesel_expected===true?'diesel':'erp',
    linked,
    plate_no:clean(overrides.plateNo||asset.plate_no||erp?.plate_no||ref.newPlate||ref.oldPlate),
    asset_no:clean(overrides.assetNo||erp?.asset_no||ref.assetNo||asset.asset_no),
    asset_name:clean(overrides.assetName||erp?.asset_name||ref.assetName||asset.asset_name||asset.asset_type),
    asset_type:clean(overrides.assetType||erp?.asset_type||ref.assetType||asset.asset_type||'vehicle'),
    make:clean(overrides.make||erp?.make||ref.make||asset.make),
    model:clean(overrides.model||erp?.model||ref.model||asset.model),
    operational_status:clean(overrides.operationalStatus||asset.operational_status||erp?.operational_status||ref.operationalStatus||'in_service'),
    employee_external_id:clean(asset.assigned_employee_external_id||erp?.assigned_employee_external_id),
    cost_center_code:clean(asset.cost_center_code||erp?.cost_center_code||metadata.costCenterCode),
    purchase_cost:Number(overrides.purchaseCost??object(erp?.metadata).purchaseCost??ref.purchaseCost??metadata.purchaseCost??0),
    source_rows:linked?2:1
  };
}
async function loadRegistry(){
  const[assets,employees,vehicles,assignments,users,centers]=await Promise.all([
    select('unified_assets','active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,assigned_employee_external_id,operational_status,diesel_expected,make,model,cost_center_code,metadata&order=diesel_expected.desc,asset_name.asc&limit=10000'),
    select('employees','active=eq.true&select=external_id,employee_no,national_id,full_name,phone,role,site,metadata&order=full_name.asc&limit=10000'),
    select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status&limit=10000').catch(()=>[]),
    select('employee_assignments','active=eq.true&select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active,updated_at&order=updated_at.desc&limit=5000').catch(()=>[]),
    select('app_users','active=eq.true&select=id,full_name,role,active,employee_external_id&limit=5000').catch(()=>[]),
    select('cost_centers','active=eq.true&code=in.(general,block,concrete)&select=id,code,name_ar&order=code.asc').catch(()=>[])
  ]);
  const assetById=new Map((assets||[]).map(row=>[clean(row.external_id),row])),referenced=new Set(),canonicalAssets=[];
  for(const asset of assets||[]){
    if(asset.diesel_expected!==true)continue;
    const erpId=referenceId(asset),erp=erpId?assetById.get(erpId)||null:null;if(erpId)referenced.add(erpId);canonicalAssets.push(canonicalProjection(asset,erp));
  }
  for(const asset of assets||[]){if(asset.diesel_expected===true||referenced.has(clean(asset.external_id)))continue;canonicalAssets.push(canonicalProjection(asset,null));}
  const usersById=new Map((users||[]).map(row=>[clean(row.id),row])),linkedUserIds=new Set(),canonicalEmployees=(employees||[]).map(employee=>{const{assignment,user}=linkedTelegram(employee.external_id,assignments,usersById);if(user)linkedUserIds.add(clean(user.id));return{external_id:employee.external_id,employee_no:employee.employee_no||null,national_id:employee.national_id||null,full_name:employee.full_name,phone:employee.phone||null,role:employee.role||assignment?.job_title||'employee',site:employee.site||null,work_status:employeeStatus(employee),telegram:user?{id:user.id,full_name:user.full_name,role:user.role,job_title:assignment?.job_title||null,shift_name:assignment?.shift_name||null,site_id:assignment?.site_id||null,vehicle_external_id:assignment?.vehicle_external_id||null}:null};}),unlinkedTelegramUsers=(users||[]).filter(user=>!linkedUserIds.has(clean(user.id))&&!clean(user.employee_external_id)).map(user=>({id:user.id,full_name:user.full_name,role:user.role}));
  return{assets:assets||[],assetById,vehicles:vehicles||[],employees:employees||[],canonicalAssets,canonicalEmployees,unlinkedTelegramUsers,assignments:assignments||[],users:users||[],centers:centers||[]};
}
function resolveCanonical(registry,id){
  const direct=registry.assetById.get(clean(id));if(!direct)return null;
  if(direct.diesel_expected===true){const erpId=referenceId(direct);return{canonical:direct,erp:erpId?registry.assetById.get(erpId)||null:null};}
  const parent=(registry.assets||[]).find(row=>row.diesel_expected===true&&referenceId(row)===clean(direct.external_id));return parent?{canonical:parent,erp:direct}:{canonical:direct,erp:null};
}
async function audit(identity,action,entityId,details){await insert('audit_log',[{actor_type:'web',actor_id:actorOf(identity),action,entity_type:'unified_asset',entity_id:clean(entityId,200),details}],{prefer:'return=minimal'}).catch(error=>console.error('[canonical master audit]',error));}
async function assignCostCenter(identity,assetExternalId,costCenterCode,linkedErpId){
  if(!costCenterCode)return;if(!CENTERS.has(costCenterCode))throw Object.assign(new Error('مركز التكلفة يجب أن يكون عام أو بلوك أو خرسانة.'),{status:400,code:'CANONICAL_COST_CENTER_INVALID'});
  const center=(await select('cost_centers',`code=eq.${encodeURIComponent(costCenterCode)}&active=eq.true&select=id,code,name_ar&limit=1`))?.[0];if(!center)throw Object.assign(new Error('مركز التكلفة غير موجود أو غير نشط.'),{status:409,code:'CANONICAL_COST_CENTER_NOT_READY'});
  const stamp=now(),effective=today(),actor=actorOf(identity);await patch('asset_cost_center_assignments',`asset_external_id=eq.${encodeURIComponent(assetExternalId)}&active=eq.true`,{active:false,effective_to:effective,updated_at:stamp});await upsert('asset_cost_center_assignments',[{asset_external_id:assetExternalId,asset_type:'vehicle',cost_center_id:center.id,effective_from:effective,effective_to:null,active:true,operational_exception:false,exception_reason:null,created_by:actor,updated_at:stamp}],'asset_external_id,effective_from,cost_center_id');await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{cost_center_code:costCenterCode,updated_at:stamp});if(linkedErpId)await patch('unified_assets',`external_id=eq.${encodeURIComponent(linkedErpId)}`,{cost_center_code:costCenterCode,updated_at:stamp}).catch(error=>console.error('[canonical master cost mirror]',error));
}
async function updateCanonicalAsset(req,input){
  const identity=await requireCapability(req,'assets.manage'),registry=await loadRegistry(),resolved=resolveCanonical(registry,input.assetExternalId);if(!resolved)throw Object.assign(new Error('الأصل المطلوب غير موجود أو غير نشط.'),{status:404,code:'CANONICAL_ASSET_NOT_FOUND'});
  const{canonical,erp}=resolved,plateNo=clean(input.plateNo,100),assetNo=clean(input.assetNo,120),assetName=clean(input.assetName,300),assetType=clean(input.assetType,80)||canonical.asset_type||erp?.asset_type||'vehicle',make=clean(input.make,160),model=clean(input.model,160),status=clean(input.operationalStatus,50)||canonical.operational_status||'in_service',employeeExternalId=clean(input.employeeExternalId,200),costCenterCode=clean(input.costCenterCode,40);
  if(!assetName&&!plateNo&&!assetNo)throw Object.assign(new Error('أدخل اسم الأصل أو اللوحة أو رقم الأصل قبل الحفظ.'),{status:400,code:'CANONICAL_ASSET_FIELDS_REQUIRED'});if(!STATUSES.has(status))throw Object.assign(new Error('الحالة التشغيلية غير صحيحة.'),{status:400,code:'CANONICAL_ASSET_STATUS_INVALID'});
  if(plateNo){const key=normalizePlate(plateNo),collision=registry.canonicalAssets.find(row=>normalizePlate(row.plate_no)===key&&!new Set([canonical.external_id,erp?.external_id].filter(Boolean)).has(row.canonical_external_id));if(collision)throw Object.assign(new Error(`اللوحة ${plateNo} مرتبطة بأصل آخر بالفعل.`),{status:409,code:'CANONICAL_PLATE_DUPLICATE'});}
  let employee=null;if(employeeExternalId){employee=registry.employees.find(row=>clean(row.external_id)===employeeExternalId);if(!employee)throw Object.assign(new Error('الموظف المختار غير موجود أو غير نشط.'),{status:404,code:'CANONICAL_EMPLOYEE_NOT_FOUND'});}
  const stamp=now(),metadata=object(canonical.metadata),overrides={plateNo,assetNo,assetName,assetType,make,model,operationalStatus:status,updatedAt:stamp,updatedBy:actorOf(identity)},canonicalValues={asset_type:assetType,asset_name:assetName||canonical.asset_name||erp?.asset_name||canonical.external_id,plate_no:plateNo||canonical.plate_no||erp?.plate_no||null,asset_no:assetNo||canonical.asset_no||erp?.asset_no||null,make:make||canonical.make||erp?.make||null,model:model||canonical.model||erp?.model||null,operational_status:status,assigned_employee_external_id:employeeExternalId||null,metadata:{...metadata,canonicalOverrides:overrides},updated_at:stamp};
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(canonical.external_id)}`,canonicalValues);
  if(erp){const erpMetadata=object(erp.metadata),erpValues={asset_type:assetType,asset_name:canonicalValues.asset_name,plate_no:canonicalValues.plate_no,asset_no:canonicalValues.asset_no,make:canonicalValues.make,model:canonicalValues.model,operational_status:status,assigned_employee_external_id:employeeExternalId||null,metadata:{...erpMetadata,canonicalMasterExternalId:canonical.external_id,canonicalOverrides:overrides},updated_at:stamp};await patch('unified_assets',`external_id=eq.${encodeURIComponent(erp.external_id)}`,erpValues);const nextReference={...object(metadata.erpReference),externalId:erp.external_id,assetNo:erpValues.asset_no,oldPlate:erpValues.plate_no,newPlate:erpValues.plate_no,assetName:erpValues.asset_name,assetType:erpValues.asset_type,make:erpValues.make,model:erpValues.model,operationalStatus:status,purchaseCost:Number(erpMetadata.purchaseCost||object(metadata.erpReference).purchaseCost||0)};await patch('unified_assets',`external_id=eq.${encodeURIComponent(canonical.external_id)}`,{metadata:{...metadata,canonicalOverrides:overrides,erpReference:nextReference},updated_at:stamp});}
  for(const id of [canonical.external_id,erp?.external_id].filter(Boolean))await patch('vehicles',`external_id=eq.${encodeURIComponent(id)}`,{plate_no:canonicalValues.plate_no,asset_no:canonicalValues.asset_no,vehicle_type:canonicalValues.asset_name,make:canonicalValues.make,model:canonicalValues.model,driver_external_id:employeeExternalId||null,status,updated_at:stamp}).catch(error=>console.error('[canonical master vehicle mirror]',id,error));
  await assignCostCenter(identity,canonical.external_id,costCenterCode,erp?.external_id||null);await audit(identity,'canonical_asset_updated',canonical.external_id,{canonicalExternalId:canonical.external_id,erpExternalId:erp?.external_id||null,plateNo:canonicalValues.plate_no,assetNo:canonicalValues.asset_no,assetName:canonicalValues.asset_name,employeeExternalId:employeeExternalId||null,costCenterCode:costCenterCode||null,sourceRows:erp?2:1});return{canonicalExternalId:canonical.external_id,erpExternalId:erp?.external_id||null,employeeName:employee?.full_name||null};
}
async function linkErp(req,input){
  const identity=await requireCapability(req,'assets.manage'),registry=await loadRegistry(),diesel=registry.assetById.get(clean(input.dieselExternalId)),erp=registry.assetById.get(clean(input.erpExternalId));if(!diesel||diesel.diesel_expected!==true)throw Object.assign(new Error('اختر سجل الديزل الصحيح.'),{status:404,code:'CANONICAL_DIESEL_NOT_FOUND'});if(!erp||erp.diesel_expected===true)throw Object.assign(new Error('اختر أصل ERP مستقلًا.'),{status:404,code:'CANONICAL_ERP_NOT_FOUND'});const owner=registry.assets.find(row=>row.diesel_expected===true&&referenceId(row)===clean(erp.external_id)&&clean(row.external_id)!==clean(diesel.external_id));if(owner)throw Object.assign(new Error('أصل ERP مرتبط بسيارة أخرى بالفعل.'),{status:409,code:'CANONICAL_ERP_ALREADY_LINKED'});const metadata=object(diesel.metadata),erpMetadata=object(erp.metadata),reference={externalId:erp.external_id,assetNo:erp.asset_no||null,oldPlate:erp.plate_no||null,newPlate:erp.plate_no||null,assetName:erp.asset_name||null,assetType:erp.asset_type||null,make:erp.make||null,model:erp.model||null,purchaseCost:Number(erpMetadata.purchaseCost||0),operationalStatus:erp.operational_status||null};await patch('unified_assets',`external_id=eq.${encodeURIComponent(diesel.external_id)}`,{metadata:{...metadata,erpReference:reference,manualErpReference:reference,erpReferenceMode:'manual',erpReferenceUpdatedAt:now()},updated_at:now()});await audit(identity,'canonical_erp_linked',diesel.external_id,{erpExternalId:erp.external_id});return{dieselExternalId:diesel.external_id,erpExternalId:erp.external_id};
}
async function unlinkErp(req,input){const identity=await requireCapability(req,'assets.manage'),registry=await loadRegistry(),diesel=registry.assetById.get(clean(input.dieselExternalId));if(!diesel||diesel.diesel_expected!==true)throw Object.assign(new Error('سجل الديزل غير موجود.'),{status:404,code:'CANONICAL_DIESEL_NOT_FOUND'});const metadata=object(diesel.metadata),previous=referenceId(diesel);await patch('unified_assets',`external_id=eq.${encodeURIComponent(diesel.external_id)}`,{metadata:{...metadata,erpReference:null,manualErpReference:null,erpReferenceMode:'manual',erpReferenceUpdatedAt:now()},updated_at:now()});await audit(identity,'canonical_erp_unlinked',diesel.external_id,{previousErpExternalId:previous||null});return{dieselExternalId:diesel.external_id,previousErpExternalId:previous||null};}
async function autoLink(req){const identity=await requireCapability(req,'assets.manage'),registry=await loadRegistry(),erpByPlate=new Map();for(const asset of registry.assets){if(asset.diesel_expected===true)continue;const key=normalizePlate(asset.plate_no);if(!key)continue;const list=erpByPlate.get(key)||[];list.push(asset);erpByPlate.set(key,list);}let linked=0,ambiguous=0,unmatched=0;for(const diesel of registry.assets.filter(row=>row.diesel_expected===true)){if(referenceId(diesel))continue;const matches=erpByPlate.get(normalizePlate(diesel.plate_no))||[];if(matches.length===1){await linkErp(req,{dieselExternalId:diesel.external_id,erpExternalId:matches[0].external_id});linked++;}else if(matches.length>1)ambiguous++;else unmatched++;}await audit(identity,'canonical_exact_plate_autolink','vehicle-registry',{linked,ambiguous,unmatched});return{linked,ambiguous,unmatched};}
async function responsePayload(){const registry=await loadRegistry();return{canonicalAssets:registry.canonicalAssets,canonicalEmployees:registry.canonicalEmployees,unlinkedTelegramUsers:registry.unlinkedTelegramUsers,employees:registry.employees.map(row=>({external_id:row.external_id,full_name:row.full_name,role:row.role||null})),erpCandidates:registry.assets.filter(row=>row.diesel_expected!==true&&!registry.canonicalAssets.some(item=>item.erp_external_id===row.external_id)).map(row=>({external_id:row.external_id,asset_no:row.asset_no||null,plate_no:row.plate_no||null,asset_name:row.asset_name||null,make:row.make||null,model:row.model||null})),centers:registry.centers,counts:{assets:registry.canonicalAssets.length,linkedAssets:registry.canonicalAssets.filter(row=>row.linked).length,employees:registry.canonicalEmployees.length,telegramLinked:registry.canonicalEmployees.filter(row=>row.telegram).length,unlinkedTelegram:registry.unlinkedTelegramUsers.length}};}

export async function canonicalMasterData(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{if(req.method==='GET'){await requireCapability(req,'assets.view');return json(res,200,{ok:true,...await responsePayload(),generatedAt:now()});}const input=await body(req),action=clean(input.action,80),result=action==='update_asset'?await updateCanonicalAsset(req,input):action==='link_erp'?await linkErp(req,input):action==='unlink_erp'?await unlinkErp(req,input):action==='auto_link_exact_plate'?await autoLink(req):(()=>{throw Object.assign(new Error('إجراء السجل الموحد غير معروف.'),{status:400,code:'CANONICAL_ACTION_UNKNOWN'});})();return json(res,200,{ok:true,result,...await responsePayload(),generatedAt:now()});}catch(error){errorResponse(res,error);}
}
