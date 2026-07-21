import * as XLSX from 'xlsx';
import { body,errorResponse,json,method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { insert,patch,select,upsert } from '../supabase.js';
import { parseUnifiedMasterWorkbook,normalizePlate } from '../master-data-workbook.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const chunks=(rows,size=200)=>{const result=[];for(let i=0;i<rows.length;i+=size)result.push(rows.slice(i,i+size));return result;};
const actorOf=identity=>identity.fullName||identity.appUserId||identity.actor||'system';
const decodeFile=value=>{const raw=String(value||'').replace(/^data:[^,]+,/,'').replace(/\s+/g,'');if(!raw||raw.length>4_000_000)throw Object.assign(new Error('ملف الربط غير موجود أو يتجاوز الحد المسموح.'),{status:400,code:'MASTER_FILE_INVALID'});const buffer=Buffer.from(raw,'base64');if(!buffer.length||buffer.length>2_500_000)throw Object.assign(new Error('ملف الربط غير صالح أو كبير جدًا.'),{status:400,code:'MASTER_FILE_INVALID'});return buffer;};

async function overview(){
  const[employees,assets,vehicles]=await Promise.all([
    select('employees','active=eq.true&select=external_id,national_id,full_name,role,employee_no,site,salary&order=full_name.asc&limit=10000').catch(()=>[]),
    select('unified_assets','active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,assigned_employee_external_id,operational_status,diesel_expected&order=asset_type.asc,asset_no.asc.nullslast&limit=10000').catch(()=>[]),
    select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,driver_external_id,status&order=plate_no.asc.nullslast&limit=10000').catch(()=>[])
  ]);
  const dieselAssets=assets.filter(row=>row.diesel_expected===true);
  return{employees,assets,vehicles,stats:{employees:employees.length,employeesWithIdentity:employees.filter(row=>row.national_id).length,employeesWithRole:employees.filter(row=>row.role).length,assets:assets.length,linkedAssets:assets.filter(row=>row.assigned_employee_external_id).length,dieselAssets:dieselAssets.length,unlinkedDieselAssets:dieselAssets.filter(row=>!row.assigned_employee_external_id).length,vehicles:vehicles.length}};
}

async function assignAssetEmployee(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),assetExternalId=clean(input.assetExternalId,200),employeeExternalId=clean(input.employeeExternalId,200);
  if(!assetExternalId)throw Object.assign(new Error('حدد اللوحة أو الأصل المطلوب ربطه.'),{status:400,code:'MASTER_ASSET_REQUIRED'});
  const asset=(await select('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}&active=eq.true&select=external_id,asset_name,plate_no,asset_no,assigned_employee_external_id,diesel_expected&limit=1`))?.[0];
  if(!asset)throw Object.assign(new Error('اللوحة أو الأصل غير موجود في السجل الدائم.'),{status:404,code:'MASTER_ASSET_NOT_FOUND'});
  let employee=null;
  if(employeeExternalId){
    employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,national_id,role&limit=1`))?.[0];
    if(!employee)throw Object.assign(new Error('الموظف المختار غير موجود أو غير نشط.'),{status:404,code:'MASTER_EMPLOYEE_NOT_FOUND'});
  }
  const previousEmployeeExternalId=clean(asset.assigned_employee_external_id,200)||null,updatedAt=new Date().toISOString(),nextEmployeeExternalId=employee?.external_id||null;
  await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{assigned_employee_external_id:nextEmployeeExternalId,updated_at:updatedAt});
  try{
    await patch('vehicles',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{driver_external_id:nextEmployeeExternalId,updated_at:updatedAt});
  }catch(error){
    await patch('unified_assets',`external_id=eq.${encodeURIComponent(assetExternalId)}`,{assigned_employee_external_id:previousEmployeeExternalId,updated_at:new Date().toISOString()}).catch(()=>{});
    throw error;
  }
  await insert('audit_log',[{actor_type:'web',actor_id:actor,action:nextEmployeeExternalId?'master_asset_employee_linked':'master_asset_employee_unlinked',entity_type:'unified_asset',entity_id:assetExternalId,details:{assetExternalId,plateNo:asset.plate_no||null,assetNo:asset.asset_no||null,previousEmployeeExternalId,nextEmployeeExternalId,employeeName:employee?.full_name||null}}],{prefer:'return=minimal'}).catch(()=>{});
  return{action:'assign_asset_employee',assetExternalId,plateNo:asset.plate_no||null,assetNo:asset.asset_no||null,employeeExternalId:nextEmployeeExternalId,employeeName:employee?.full_name||null};
}

async function importWorkbook(req,input){
  const identity=await requireCapability(req,'assets.manage'),actor=actorOf(identity),buffer=decodeFile(input.fileBase64),workbook=XLSX.read(buffer,{type:'buffer',cellDates:true}),parsed=parseUnifiedMasterWorkbook(workbook,XLSX);
  if(!parsed.employees.length&&!parsed.assets.length)throw Object.assign(new Error('لم يتم العثور على موظفين أو أصول صالحة داخل القالب.'),{status:400,code:'MASTER_FILE_EMPTY'});

  const existingEmployees=await select('employees','select=external_id,national_id&limit=10000').catch(()=>[]),employeeIdByNational=new Map();
  for(const row of existingEmployees||[]){const id=String(row.national_id||'').replace(/[^0-9]/g,'');if(id)employeeIdByNational.set(id,row.external_id);}
  for(const row of parsed.employees)if(!employeeIdByNational.has(row.nationalId))employeeIdByNational.set(row.nationalId,`nid-${row.nationalId}`);
  const employeeValues=parsed.employees.map(row=>({
    external_id:employeeIdByNational.get(row.nationalId),national_id:row.nationalId,employee_no:row.employeeNo,full_name:row.fullName,phone:row.phone,role:row.role,salary:row.salary||0,site:row.site,basic_salary:row.basicSalary||0,housing_allowance:row.housingAllowance||0,transport_allowance:row.transportAllowance||0,total_package:row.totalPackage||0,factory_status:row.factoryStatus,active:row.active!==false,metadata:{source:'unified_master_workbook',notes:row.notes||null,sourceRow:row.sourceRow},source_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()
  }));
  for(const batch of chunks(employeeValues))await upsert('employees',batch,'external_id');

  const existingAssets=await select('unified_assets','select=external_id,asset_no,plate_no&limit=10000').catch(()=>[]),assetByNo=new Map(),assetByPlate=new Map();
  for(const row of existingAssets||[]){if(row.asset_no)assetByNo.set(String(row.asset_no),row.external_id);const plate=normalizePlate(row.plate_no);if(plate)assetByPlate.set(plate,row.external_id);}
  const assetValues=[],vehicleValues=[];
  for(const row of parsed.assets){
    const plateKey=normalizePlate(row.plateNo),externalId=(row.assetNo&&assetByNo.get(String(row.assetNo)))||(plateKey&&assetByPlate.get(plateKey))||(row.assetNo?`erp-${row.assetNo}`:`plate-${plateKey}`),employeeExternalId=row.assignedNationalId?employeeIdByNational.get(row.assignedNationalId)||null:null;
    if(!externalId)continue;
    assetValues.push({external_id:externalId,asset_type:row.assetType,asset_name:row.assetName||externalId,plate_no:row.plateNo||null,asset_no:row.assetNo||null,serial_no:row.serialNo||null,make:row.make||null,model:row.model||null,operational_status:row.operationalStatus||'in_service',diesel_expected:row.dieselExpected,assigned_employee_external_id:employeeExternalId,cost_center_code:row.costCenterCode||null,active:true,source_updated_at:new Date().toISOString(),metadata:row.metadata||{},updated_at:new Date().toISOString()});
    if(row.plateNo||['vehicle','equipment'].includes(row.assetType))vehicleValues.push({external_id:externalId,plate_no:row.plateNo||null,asset_no:row.assetNo||null,vehicle_type:row.assetName||row.assetType,make:row.make||null,model:row.model||null,driver_external_id:employeeExternalId,status:row.operationalStatus||'in_service',active:true,source_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()});
  }
  for(const batch of chunks(assetValues))await upsert('unified_assets',batch,'external_id');
  for(const batch of chunks(vehicleValues))await upsert('vehicles',batch,'external_id');

  const result={fileName:clean(input.fileName,240)||'unified-master.xlsx',employees:employeeValues.length,assets:assetValues.length,vehicles:vehicleValues.length,linkedAssets:assetValues.filter(row=>row.assigned_employee_external_id).length,warnings:parsed.warnings.slice(0,200),warningCount:parsed.warnings.length};
  await insert('master_data_import_runs',[{file_name:result.fileName,actor,employee_count:result.employees,asset_count:result.assets,vehicle_count:result.vehicles,linked_asset_count:result.linkedAssets,warning_count:result.warningCount,summary:result}],{prefer:'return=minimal'}).catch(()=>{});
  await insert('audit_log',[{actor_type:'web',actor_id:actor,action:'persistent_master_data_imported',entity_type:'master_data',entity_id:result.fileName,details:{employees:result.employees,assets:result.assets,vehicles:result.vehicles,linkedAssets:result.linkedAssets,warningCount:result.warningCount}}],{prefer:'return=minimal'}).catch(()=>{});
  return result;
}

export async function masterData(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){await requireCapability(req,'governance.view');return json(res,200,{ok:true,...await overview(),generatedAt:new Date().toISOString()});}
    const input=await body(req,5_000_000),result=input.action==='assign_asset_employee'?await assignAssetEmployee(req,input):await importWorkbook(req,input);return json(res,200,{ok:true,result,...await overview(),generatedAt:new Date().toISOString()});
  }catch(error){errorResponse(res,error);}
}
