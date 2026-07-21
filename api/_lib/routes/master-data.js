import * as XLSX from 'xlsx';
import { body,errorResponse,json,method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { insert,patch,select,upsert } from '../supabase.js';
import { parseUnifiedMasterWorkbook,normalizePlate } from '../master-data-workbook.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const chunks=(rows,size=200)=>{const result=[];for(let i=0;i<rows.length;i+=size)result.push(rows.slice(i,i+size));return result;};
const actorOf=identity=>identity.fullName||identity.appUserId||identity.actor||'system';
const decodeFile=value=>{const raw=String(value||'').replace(/^data:[^,]+,/,'').replace(/\s+/g,'');if(!raw||raw.length>4_000_000)throw Object.assign(new Error('ملف الربط غير موجود أو يتجاوز الحد المسموح.'),{status:400,code:'MASTER_FILE_INVALID'});const buffer=Buffer.from(raw,'base64');if(!buffer.length||buffer.length>2_500_000)throw Object.assign(new Error('ملف الربط غير صالح أو كبير جدًا.'),{status:400,code:'MASTER_FILE_INVALID'});return buffer;};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const workStatuses=new Set(['working','holiday','leave','suspended','unknown']);
const assetStatuses=new Set(['in_service','maintenance','spare','out_of_service','stopped','parked','sold']);
const now=()=>new Date().toISOString();

async function overview(){
  const[employees,assets,vehicles]=await Promise.all([
    select('employees','active=eq.true&select=external_id,national_id,full_name,role,employee_no,site,salary,metadata&order=full_name.asc&limit=10000').catch(()=>[]),
    select('unified_assets','active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,assigned_employee_external_id,operational_status,diesel_expected,make,model,metadata&order=diesel_expected.desc,asset_type.asc,asset_no.asc.nullslast&limit=10000').catch(()=>[]),
    select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,driver_external_id,status&order=plate_no.asc.nullslast&limit=10000').catch(()=>[])
  ]);
  const dieselAssets=assets.filter(row=>row.diesel_expected===true),working=employees.filter(row=>object(row.metadata).workStatus==='working').length,holiday=employees.filter(row=>object(row.metadata).workStatus==='holiday').length;
  return{employees,assets,vehicles,stats:{employees:employees.length,employeesWithIdentity:employees.filter(row=>row.national_id).length,employeesWithRole:employees.filter(row=>row.role).length,employeesWorking:working,employeesHoliday:holiday,assets:assets.length,linkedAssets:dieselAssets.filter(row=>row.assigned_employee_external_id).length,dieselAssets:dieselAssets.length,unlinkedDieselAssets:dieselAssets.filter(row=>!row.assigned_employee_external_id).length,erpReferencedDieselAssets:dieselAssets.filter(row=>object(row.metadata).erpReference).length,assetsInMaintenance:assets.filter(row=>row.operational_status==='maintenance').length,vehicles:vehicles.length}};
}

async function assignAssetEmployee(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),assetExternalId=clean(input.assetExternalId,200),employeeExternalId=clean(input.employeeExternalId,200);
  if(!assetExternalId)throw Object.assign(new Error('حدد لوحة الديزل المطلوب ربطها.'),{status:400,code:'MASTER_ASSET_REQUIRED'});
  const asset=(await select('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}&active=eq.true&select=external_id,asset_name,plate_no,asset_no,assigned_employee_external_id,diesel_expected&limit=1`))?.[0];
  if(!asset)throw Object.assign(new Error('لوحة الديزل غير موجودة في السجل الدائم.'),{status:404,code:'MASTER_ASSET_NOT_FOUND'});
  if(asset.diesel_expected!==true)throw Object.assign(new Error('ربط الموظف يتم على لوحة الديزل فقط، وليس على أصل ERP.'),{status:400,code:'MASTER_DIESEL_REQUIRED'});
  let employee=null;
  if(employeeExternalId){employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,national_id,role&limit=1`))?.[0];if(!employee)throw Object.assign(new Error('الموظف المختار غير موجود أو غير نشط.'),{status:404,code:'MASTER_EMPLOYEE_NOT_FOUND'});}
  const previousEmployeeExternalId=clean(asset.assigned_employee_external_id,200)||null,updatedAt=now(),nextEmployeeExternalId=employee?.external_id||null;
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{assigned_employee_external_id:nextEmployeeExternalId,updated_at:updatedAt});
  try{await patch('vehicles',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{driver_external_id:nextEmployeeExternalId,updated_at:updatedAt});}
  catch(error){await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{assigned_employee_external_id:previousEmployeeExternalId,updated_at:now()}).catch(()=>{});throw error;}
  await insert('audit_log',[{actor_type:'web',actor_id:actor,action:nextEmployeeExternalId?'master_diesel_employee_linked':'master_diesel_employee_unlinked',entity_type:'unified_asset',entity_id:assetExternalId,details:{assetExternalId,plateNo:asset.plate_no||null,previousEmployeeExternalId,nextEmployeeExternalId,employeeName:employee?.full_name||null}}],{prefer:'return=minimal'}).catch(()=>{});
  return{action:'assign_asset_employee',assetExternalId,plateNo:asset.plate_no||null,employeeExternalId:nextEmployeeExternalId,employeeName:employee?.full_name||null};
}

function erpSnapshot(asset){const metadata=object(asset?.metadata);return asset?{externalId:asset.external_id,assetNo:asset.asset_no||null,oldPlate:metadata.erpOldPlate||asset.plate_no||null,newPlate:metadata.erpNewPlate||null,assetName:asset.asset_name||null,assetType:asset.asset_type||null,make:asset.make||null,model:asset.model||null,purchaseCost:Number(metadata.purchaseCost||0),operationalStatus:asset.operational_status||null}:null;}

async function assignErpReference(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),dieselAssetExternalId=clean(input.dieselAssetExternalId,200),erpAssetExternalId=clean(input.erpAssetExternalId,200);
  if(!dieselAssetExternalId)throw Object.assign(new Error('حدد لوحة الديزل أولًا.'),{status:400,code:'MASTER_DIESEL_REQUIRED'});
  const dieselAsset=(await select('unified_assets',`external_id=eq.${encodeURIComponent(dieselAssetExternalId)}&active=eq.true&select=external_id,plate_no,diesel_expected,metadata&limit=1`))?.[0];
  if(!dieselAsset||dieselAsset.diesel_expected!==true)throw Object.assign(new Error('السجل المختار ليس لوحة ديزل.'),{status:404,code:'MASTER_DIESEL_NOT_FOUND'});
  let erpAsset=null;
  if(erpAssetExternalId){erpAsset=(await select('unified_assets',`external_id=eq.${encodeURIComponent(erpAssetExternalId)}&active=eq.true&select=external_id,asset_no,plate_no,asset_name,asset_type,make,model,operational_status,diesel_expected,metadata&limit=1`))?.[0];if(!erpAsset||erpAsset.diesel_expected===true)throw Object.assign(new Error('اختر أصل ERP مستقلًا، وليس لوحة ديزل أخرى.'),{status:404,code:'MASTER_ERP_NOT_FOUND'});}
  const metadata=object(dieselAsset.metadata),reference=erpSnapshot(erpAsset),nextMetadata={...metadata,erpReference:reference,manualErpReference:reference,erpReferenceMode:'manual',erpReferenceUpdatedAt:now()};
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(dieselAssetExternalId)}`,{metadata:nextMetadata,updated_at:now()});
  await insert('audit_log',[{actor_type:'web',actor_id:actor,action:reference?'master_diesel_erp_reference_linked':'master_diesel_erp_reference_unlinked',entity_type:'unified_asset',entity_id:dieselAssetExternalId,details:{plateNo:dieselAsset.plate_no||null,erpAssetExternalId:reference?.externalId||null,erpAssetNo:reference?.assetNo||null,purchaseCost:reference?.purchaseCost||0}}],{prefer:'return=minimal'}).catch(()=>{});
  return{action:'assign_erp_reference',dieselAssetExternalId,plateNo:dieselAsset.plate_no||null,erpReference:reference};
}

async function updateEmployeeStatus(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),employeeExternalId=clean(input.employeeExternalId,200),workStatus=clean(input.workStatus,40);
  if(!employeeExternalId||!workStatuses.has(workStatus))throw Object.assign(new Error('حدد الموظف وحالة الدوام الصحيحة.'),{status:400,code:'MASTER_EMPLOYEE_STATUS_INVALID'});
  const employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,metadata&limit=1`))?.[0];
  if(!employee)throw Object.assign(new Error('الموظف غير موجود أو غير نشط.'),{status:404,code:'MASTER_EMPLOYEE_NOT_FOUND'});
  const metadata={...object(employee.metadata),workStatus,manualWorkStatus:workStatus,workStatusUpdatedAt:now()};
  await patch('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}`,{metadata,updated_at:now()});
  await insert('audit_log',[{actor_type:'web',actor_id:actor,action:'master_employee_work_status_updated',entity_type:'employee',entity_id:employeeExternalId,details:{employeeName:employee.full_name,workStatus}}],{prefer:'return=minimal'}).catch(()=>{});
  return{action:'update_employee_status',employeeExternalId,employeeName:employee.full_name,workStatus};
}

async function updateAssetStatus(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),assetExternalId=clean(input.assetExternalId,200),operationalStatus=clean(input.operationalStatus,40);
  if(!assetExternalId||!assetStatuses.has(operationalStatus))throw Object.assign(new Error('حدد المركبة أو المعدة والحالة الصحيحة.'),{status:400,code:'MASTER_ASSET_STATUS_INVALID'});
  const asset=(await select('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}&active=eq.true&select=external_id,asset_name,plate_no,asset_no,metadata&limit=1`))?.[0];
  if(!asset)throw Object.assign(new Error('المركبة أو المعدة غير موجودة.'),{status:404,code:'MASTER_ASSET_NOT_FOUND'});
  const metadata={...object(asset.metadata),manualOperationalStatus:operationalStatus,operationalStatusUpdatedAt:now()};
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{operational_status:operationalStatus,metadata,updated_at:now()});
  await patch('vehicles',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{status:operationalStatus,updated_at:now()}).catch(()=>{});
  await insert('audit_log',[{actor_type:'web',actor_id:actor,action:'master_asset_operational_status_updated',entity_type:'unified_asset',entity_id:assetExternalId,details:{assetName:asset.asset_name,plateNo:asset.plate_no||null,assetNo:asset.asset_no||null,operationalStatus}}],{prefer:'return=minimal'}).catch(()=>{});
  return{action:'update_asset_status',assetExternalId,assetName:asset.asset_name,operationalStatus};
}

async function importWorkbook(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),buffer=decodeFile(input.fileBase64),workbook=XLSX.read(buffer,{type:'buffer',cellDates:true}),parsed=parseUnifiedMasterWorkbook(workbook,XLSX);
  if(!parsed.employees.length&&!parsed.assets.length)throw Object.assign(new Error('لم يتم العثور على موظفين أو أصول صالحة داخل القالب.'),{status:400,code:'MASTER_FILE_EMPTY'});

  const existingEmployees=await select('employees','select=external_id,national_id,role,site,active,metadata&limit=10000').catch(()=>[]),employeeByNational=new Map();
  for(const row of existingEmployees||[]){const id=String(row.national_id||'').replace(/[^0-9]/g,'');if(id)employeeByNational.set(id,row);}
  const employeeIdByNational=new Map();
  for(const row of parsed.employees){const existing=employeeByNational.get(row.nationalId);employeeIdByNational.set(row.nationalId,existing?.external_id||`nid-${row.nationalId}`);}
  const employeeValues=parsed.employees.map(row=>{const existing=employeeByNational.get(row.nationalId)||{},existingMetadata=object(existing.metadata),manualStatus=existingMetadata.manualWorkStatus,workStatus=manualStatus||row.workStatus||existingMetadata.workStatus||'unknown';return{external_id:employeeIdByNational.get(row.nationalId),national_id:row.nationalId,employee_no:row.employeeNo,full_name:row.fullName,phone:row.phone,role:row.role||existing.role||null,salary:row.salary||0,site:row.site||existing.site||null,basic_salary:row.basicSalary||0,housing_allowance:row.housingAllowance||0,transport_allowance:row.transportAllowance||0,total_package:row.totalPackage||0,factory_status:row.factoryStatus,active:row.active!==false&&existing.active!==false,metadata:{...existingMetadata,source:'unified_master_workbook',notes:row.notes||existingMetadata.notes||null,sourceRow:row.sourceRow,sourceWorkStatus:row.workStatus||null,workStatus},source_updated_at:now(),updated_at:now()};});
  for(const batch of chunks(employeeValues))await upsert('employees',batch,'external_id');

  const existingAssets=await select('unified_assets','select=external_id,asset_no,plate_no,assigned_employee_external_id,operational_status,diesel_expected,metadata&limit=10000').catch(()=>[]),assetByNo=new Map(),assetByPlate=new Map();
  for(const row of existingAssets||[]){if(row.asset_no)assetByNo.set(String(row.asset_no),row);const plate=normalizePlate(row.plate_no);if(plate)assetByPlate.set(plate,row);}
  const assetValues=[],vehicleValues=[];
  for(const row of parsed.assets){
    const plateKey=normalizePlate(row.plateNo),existing=row.dieselExpected===true?(plateKey?assetByPlate.get(plateKey):null):((row.assetNo&&assetByNo.get(String(row.assetNo)))||(plateKey&&assetByPlate.get(plateKey))),externalId=existing?.external_id||(row.dieselExpected===true?`plate-${plateKey}`:(row.assetNo?`erp-${row.assetNo}`:`asset-${plateKey}`)),parsedEmployee=row.assignedNationalId?employeeIdByNational.get(row.assignedNationalId)||null:null,employeeExternalId=parsedEmployee||existing?.assigned_employee_external_id||null;
    if(!externalId)continue;
    const existingMetadata=object(existing?.metadata),rowMetadata=object(row.metadata),manualErp=existingMetadata.erpReferenceMode==='manual',erpReference=manualErp?existingMetadata.erpReference:(rowMetadata.erpReference||existingMetadata.erpReference||null),manualOperationalStatus=existingMetadata.manualOperationalStatus,operationalStatus=manualOperationalStatus||row.operationalStatus||existing?.operational_status||'in_service',metadata={...existingMetadata,...rowMetadata,erpReference,sourceErpReference:rowMetadata.sourceErpReference||existingMetadata.sourceErpReference||null};
    assetValues.push({external_id:externalId,asset_type:row.assetType,asset_name:row.assetName||externalId,plate_no:row.plateNo||existing?.plate_no||null,asset_no:row.assetNo||existing?.asset_no||null,serial_no:row.serialNo||null,make:row.make||null,model:row.model||null,operational_status:operationalStatus,diesel_expected:row.dieselExpected===true,assigned_employee_external_id:employeeExternalId,cost_center_code:row.costCenterCode||null,active:true,source_updated_at:now(),metadata,updated_at:now()});
    if(row.plateNo||['vehicle','equipment'].includes(row.assetType))vehicleValues.push({external_id:externalId,plate_no:row.plateNo||existing?.plate_no||null,asset_no:row.assetNo||existing?.asset_no||null,vehicle_type:row.assetName||row.assetType,make:row.make||null,model:row.model||null,driver_external_id:employeeExternalId,status:operationalStatus,active:true,source_updated_at:now(),updated_at:now()});
  }
  for(const batch of chunks(assetValues))await upsert('unified_assets',batch,'external_id');
  for(const batch of chunks(vehicleValues))await upsert('vehicles',batch,'external_id');

  const dieselValues=assetValues.filter(row=>row.diesel_expected===true),result={fileName:clean(input.fileName,240)||'unified-master.xlsx',employees:employeeValues.length,assets:assetValues.length,vehicles:vehicleValues.length,linkedAssets:dieselValues.filter(row=>row.assigned_employee_external_id).length,erpReferences:dieselValues.filter(row=>object(row.metadata).erpReference).length,warnings:parsed.warnings.slice(0,200),warningCount:parsed.warnings.length};
  await insert('master_data_import_runs',[{file_name:result.fileName,actor,employee_count:result.employees,asset_count:result.assets,vehicle_count:result.vehicles,linked_asset_count:result.linkedAssets,warning_count:result.warningCount,summary:result}],{prefer:'return=minimal'}).catch(()=>{});
  await insert('audit_log',[{actor_type:'web',actor_id:actor,action:'persistent_master_data_imported',entity_type:'master_data',entity_id:result.fileName,details:{employees:result.employees,assets:result.assets,vehicles:result.vehicles,linkedAssets:result.linkedAssets,erpReferences:result.erpReferences,warningCount:result.warningCount}}],{prefer:'return=minimal'}).catch(()=>{});
  return result;
}

export async function masterData(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){await requireCapability(req,'governance.view');return json(res,200,{ok:true,...await overview(),generatedAt:now()});}
    const input=await body(req,5_000_000);let result;
    if(input.action==='assign_asset_employee')result=await assignAssetEmployee(req,input);
    else if(input.action==='assign_erp_reference')result=await assignErpReference(req,input);
    else if(input.action==='update_employee_status')result=await updateEmployeeStatus(req,input);
    else if(input.action==='update_asset_status')result=await updateAssetStatus(req,input);
    else result=await importWorkbook(req,input);
    return json(res,200,{ok:true,result,...await overview(),generatedAt:now()});
  }catch(error){errorResponse(res,error);}
}
