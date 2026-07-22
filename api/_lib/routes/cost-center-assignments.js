import { body,errorResponse,json,method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { insert,patch,select,upsert } from '../supabase.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const today=()=>now().slice(0,10);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const ALLOWED=new Set(['general','block','concrete']);
const LABELS=Object.freeze({general:'عام',block:'بلوك',concrete:'خرسانة'});
const actorOf=identity=>identity.fullName||identity.appUserId||identity.actor||'system';

function linkedErpIds(assets){const ids=new Set();for(const asset of assets||[]){if(asset.diesel_expected!==true)continue;const ref=object(asset.metadata).erpReference,id=clean(ref?.externalId||ref?.externalKey,200);if(id)ids.add(id);}return ids;}
function currentAssignment(rows,idField){const map=new Map();for(const row of rows||[]){const id=clean(row?.[idField],200);if(id&&!map.has(id))map.set(id,row);}return map;}
async function centerByCode(code){const rows=await select('cost_centers',`code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,code,name_ar&limit=1`);const center=rows?.[0];if(!center)throw Object.assign(new Error('مركز التكلفة غير موجود أو غير نشط.'),{status:409,code:'COST_CENTER_NOT_READY'});return center;}
async function audit(identity,action,entityType,entityId,details){await insert('audit_log',[{actor_type:'web',actor_id:actorOf(identity),action,entity_type:entityType,entity_id:entityId,details}],{prefer:'return=minimal'}).catch(error=>console.error('[cost center assignment audit]',error));}

async function overview(){
  const[centers,employees,assets,employeeAssignments,assetAssignments]=await Promise.all([
    select('cost_centers','active=eq.true&code=in.(general,block,concrete)&select=id,code,name_ar,center_type&order=code.asc'),
    select('employees','active=eq.true&select=external_id,full_name,role,employee_no,site,metadata&order=full_name.asc&limit=10000'),
    select('unified_assets','active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,diesel_expected,make,model,cost_center_code,metadata&order=diesel_expected.desc,asset_type.asc,asset_no.asc.nullslast&limit=10000'),
    select('employee_cost_assignments','active=eq.true&select=employee_external_id,cost_center_id,allocation_percent,effective_from,effective_to,updated_at&order=effective_from.desc,updated_at.desc&limit=10000'),
    select('asset_cost_center_assignments','active=eq.true&select=asset_external_id,asset_type,cost_center_id,effective_from,effective_to,updated_at&order=effective_from.desc,updated_at.desc&limit=10000')
  ]);
  const centerById=new Map((centers||[]).map(center=>[center.id,center])),employeeById=currentAssignment(employeeAssignments,'employee_external_id'),assetById=currentAssignment(assetAssignments,'asset_external_id'),erpLinked=linkedErpIds(assets),visibleAssets=(assets||[]).filter(asset=>asset.diesel_expected===true||!erpLinked.has(asset.external_id));
  const decoratedEmployees=(employees||[]).map(employee=>{const assignment=employeeById.get(employee.external_id),center=centerById.get(assignment?.cost_center_id),metadata=object(employee.metadata),code=center?.code||metadata.costCenterCode||null;return{...employee,cost_center_code:ALLOWED.has(code)?code:null,cost_center_name:center?.name_ar||LABELS[code]||null,allocation_percent:Number(assignment?.allocation_percent||0)};});
  const decoratedAssets=visibleAssets.map(asset=>{const assignment=assetById.get(asset.external_id),center=centerById.get(assignment?.cost_center_id),metadata=object(asset.metadata),code=center?.code||asset.cost_center_code||metadata.costCenterCode||null,ref=object(metadata.erpReference);return{...asset,cost_center_code:ALLOWED.has(code)?code:null,cost_center_name:center?.name_ar||LABELS[code]||null,erp_reference:ref.externalId||ref.externalKey?ref:null};});
  const counts={employees:{general:0,block:0,concrete:0,unassigned:0},assets:{general:0,block:0,concrete:0,unassigned:0}};
  for(const employee of decoratedEmployees)counts.employees[employee.cost_center_code||'unassigned']++;
  for(const asset of decoratedAssets)counts.assets[asset.cost_center_code||'unassigned']++;
  return{centers:(centers||[]).filter(center=>ALLOWED.has(center.code)),employees:decoratedEmployees,assets:decoratedAssets,counts};
}

async function assignEmployee(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),employeeExternalId=clean(input.employeeExternalId,200),costCenterCode=clean(input.costCenterCode,40);
  if(!employeeExternalId||!ALLOWED.has(costCenterCode))throw Object.assign(new Error('حدد الموظف ومركز التكلفة: عام أو بلوك أو خرسانة.'),{status:400,code:'EMPLOYEE_COST_CENTER_INVALID'});
  const employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,metadata&limit=1`))?.[0];
  if(!employee)throw Object.assign(new Error('الموظف غير موجود أو غير نشط.'),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  const center=await centerByCode(costCenterCode),effectiveFrom=today(),stamp=now(),metadata={...object(employee.metadata),costCenterCode,costCenterName:center.name_ar,costCenterUpdatedAt:stamp};
  await patch('employee_cost_assignments',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true`,{active:false,effective_to:effectiveFrom,updated_at:stamp});
  await upsert('employee_cost_assignments',[{employee_external_id:employeeExternalId,cost_center_id:center.id,allocation_percent:100,effective_from:effectiveFrom,effective_to:null,active:true,created_by:actor,updated_at:stamp}],'employee_external_id,cost_center_id,effective_from');
  await patch('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}`,{metadata,updated_at:stamp});
  await audit(identity,'employee_cost_center_assigned','employee',employeeExternalId,{employeeName:employee.full_name,costCenterCode,costCenterName:center.name_ar,allocationPercent:100,effectiveFrom});
  return{action:'assign_employee_cost_center',employeeExternalId,employeeName:employee.full_name,costCenterCode,costCenterName:center.name_ar,allocationPercent:100};
}

async function assignAsset(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),assetExternalId=clean(input.assetExternalId,200),costCenterCode=clean(input.costCenterCode,40);
  if(!assetExternalId||!ALLOWED.has(costCenterCode))throw Object.assign(new Error('حدد المركبة أو المعدة ومركز التكلفة: عام أو بلوك أو خرسانة.'),{status:400,code:'ASSET_COST_CENTER_INVALID'});
  const asset=(await select('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}&active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,diesel_expected,metadata&limit=1`))?.[0];
  if(!asset)throw Object.assign(new Error('المركبة أو المعدة غير موجودة أو غير نشطة.'),{status:404,code:'ASSET_NOT_FOUND'});
  const center=await centerByCode(costCenterCode),effectiveFrom=today(),stamp=now(),metadata={...object(asset.metadata),costCenterCode,costCenterName:center.name_ar,costCenterUpdatedAt:stamp},assetType=['vehicle','equipment','fixed_asset'].includes(asset.asset_type)?asset.asset_type:'vehicle';
  await patch('asset_cost_center_assignments',`asset_external_id=eq.${encodeURIComponent(assetExternalId)}&active=eq.true`,{active:false,effective_to:effectiveFrom,updated_at:stamp});
  await upsert('asset_cost_center_assignments',[{asset_external_id:assetExternalId,asset_type:assetType,cost_center_id:center.id,effective_from:effectiveFrom,effective_to:null,active:true,operational_exception:false,exception_reason:null,created_by:actor,updated_at:stamp}],'asset_external_id,effective_from,cost_center_id');
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{cost_center_code:costCenterCode,metadata,updated_at:stamp});
  const ref=object(asset.metadata).erpReference,erpExternalId=clean(ref.externalId||ref.externalKey,200);
  if(erpExternalId)await patch('unified_assets',`external_id=eq.${encodeURIComponent(erpExternalId)}`,{cost_center_code:costCenterCode,updated_at:stamp}).catch(error=>console.error('[cost center ERP mirror]',error));
  await audit(identity,'asset_cost_center_assigned','unified_asset',assetExternalId,{assetName:asset.asset_name,plateNo:asset.plate_no||null,assetNo:asset.asset_no||null,costCenterCode,costCenterName:center.name_ar,effectiveFrom,canonicalAsset:true});
  return{action:'assign_asset_cost_center',assetExternalId,assetName:asset.asset_name,plateNo:asset.plate_no||null,costCenterCode,costCenterName:center.name_ar};
}

export async function costCenterAssignments(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){await requireCapability(req,'assets.manage');return json(res,200,{ok:true,...await overview(),generatedAt:now()});}
    const input=await body(req),action=clean(input.action,80);let result;
    if(action==='assign_employee_cost_center')result=await assignEmployee(req,input);
    else if(action==='assign_asset_cost_center')result=await assignAsset(req,input);
    else throw Object.assign(new Error('إجراء مركز التكلفة غير معروف.'),{status:400,code:'COST_CENTER_ACTION_UNKNOWN'});
    return json(res,200,{ok:true,result,...await overview(),generatedAt:now()});
  }catch(error){errorResponse(res,error);}
}
