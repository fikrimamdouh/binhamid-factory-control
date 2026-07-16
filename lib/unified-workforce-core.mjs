const EMPLOYEE_HEADERS={
  source:['المصدر','source'], identity:['رقم الهوية / الإقامة','رقم الهوية','الهوية','الإقامة','national_id','nationalId','nid'],
  name:['اسم الموظف','الاسم','full_name','fullName','name'], baseSalary:['الراتب الأساسي','الاساسي','baseSalary','base_salary'],
  housingAllowance:['بدل السكن','housingAllowance','housing_allowance'], transportAllowance:['بدل النقل','transportAllowance','transport_allowance'],
  totalSalary:['إجمالي راتب مدد','إجمالي الراتب','totalSalary','total_salary'], factoryAffiliation:['تابع للمصنع؟','تابع للمصنع','factoryAffiliation','factory_affiliation'],
  site:['الموقع','جهة العمل','site','location'], role:['الوظيفة','المسمى الوظيفي','role','jobTitle','job_title'], actualSalary:['الراتب الفعلي','actualSalary','actual_salary','salary'],
  employeeNo:['الرقم الوظيفي','رقم الموظف','employeeNo','employee_no','no'], phone:['الجوال','رقم الجوال','phone','tel'], status:['الحالة','status'], notes:['ملاحظات','notes']
};
const ASSET_HEADERS={
  assetNo:['رقم الأصل ERP','رقم الأصل','assetNo','asset_no','acct'], assetPlate:['رقم اللوحة / التشغيل','لوحة الأصل / التشغيل','رقم التشغيل','assetPlate','asset_plate'],
  type:['نوع الأصل','assetType','asset_type','type'], group:['المجموعة','assetGroup','asset_group','group'], makeModel:['الماركة والموديل','makeModel','make_model'],
  year:['سنة الصنع','year'], vin:['رقم الهيكل VIN','رقم الهيكل','vin','chassis'], cost:['تكلفة الشراء','purchaseCost','purchase_cost','cost'],
  status:['الحالة التشغيلية','الحالة','status'], site:['الموقع','site','location'], notes:['ملاحظات','notes']
};
const LINK_HEADERS={
  action:['إجراء الاستيراد','الإجراء','action'], factoryAffiliation:['تابع للمصنع؟','تابع للمصنع','factoryAffiliation'], identity:EMPLOYEE_HEADERS.identity,
  name:EMPLOYEE_HEADERS.name, baseSalary:EMPLOYEE_HEADERS.baseSalary, housingAllowance:EMPLOYEE_HEADERS.housingAllowance,
  transportAllowance:EMPLOYEE_HEADERS.transportAllowance, totalSalary:EMPLOYEE_HEADERS.totalSalary, actualSalary:EMPLOYEE_HEADERS.actualSalary,
  site:EMPLOYEE_HEADERS.site, role:EMPLOYEE_HEADERS.role, fuelPlate:['لوحة الديزل','اللوحة الموحدة','fuelPlate','fuel_plate','plate'],
  fuelDriverName:['اسم بطاقة الوقود','اسم السائق/البطاقة','fuelDriverName','fuel_driver_name','driverName'], fuelVehicleDescription:['وصف المركبة بالديزل','وصف المركبة','fuelVehicleDescription'],
  fuelType:['نوع الوقود','fuelType','fuel_type'], assetNo:ASSET_HEADERS.assetNo, assetPlate:ASSET_HEADERS.assetPlate,
  assetType:ASSET_HEADERS.type, group:ASSET_HEADERS.group, makeModel:ASSET_HEADERS.makeModel, cost:ASSET_HEADERS.cost,
  matchStatus:['حالة المطابقة','matchStatus'], startDate:['تاريخ بداية الربط','startDate','start_date'], allocation:['نسبة تحميل الراتب %','نسبة التحميل','allocation'], notes:['ملاحظات','notes']
};
const FUEL_PLATE_KEYS=['plate','plateNo','plate_no','vehiclePlate','vehicle_plate','fuelPlate','fuel_plate','اللوحة','رقم اللوحة','لوحة السيارة','اللوحه','اللوحة الموحدة','اللوحة كما وردت'];
const FUEL_DRIVER_KEYS=['driver','driverName','driver_name','employeeName','employee_name','السائق','اسم السائق','اسم السائق/البطاقة','اسم بطاقة الوقود'];

export const TEMPLATE_SHEETS={links:'الربط الموحد',employees:'الموظفون',fuelPlates:'لوحات الديزل',assets:'الأصول الثابتة'};
export function clean(value){return String(value??'').trim();}
export function normalizeIdentity(value){return clean(value).replace(/[\s\u200e\u200f-]/g,'').replace(/\.0$/,'');}
export function normalizeName(value){return clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[^\p{L}\p{N}]+/gu,'');}
export function normalizePlate(value){
  const s=clean(value).toUpperCase().replace(/[\u200e\u200f]/g,' ');
  const latin=s.match(/[A-Z]{2,4}\s*[-/]?\s*\d{2,6}/);
  if(latin)return latin[0].trim().replace(/\s*[-/]\s*/,'-').replace(/\s+/g,'');
  return s.replace(/[^A-Z0-9\u0600-\u06FF]+/g,'-').replace(/^-+|-+$/g,'');
}
export function numberValue(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(String(value).replace(/,/g,'').replace(/٪|%/g,''));
  return Number.isFinite(n)?n:null;
}
export function pick(row,aliases){
  if(!row||typeof row!=='object')return '';
  for(const key of aliases){if(Object.prototype.hasOwnProperty.call(row,key)&&clean(row[key])!=='')return row[key];}
  const normalized=new Map(Object.keys(row).map(k=>[normalizeName(k),k]));
  for(const key of aliases){const found=normalized.get(normalizeName(key));if(found&&clean(row[found])!=='')return row[found];}
  return '';
}
function activeFromStatus(value){const s=normalizeName(value);return !['موقوف','غيرنشط','inactive','stopped','ملغي'].includes(s);}
function nonBlank(target,key,value){if(value!==null&&value!==undefined&&clean(value)!=='')target[key]=value;}
function canonicalEmployee(row){
  const identity=normalizeIdentity(pick(row,EMPLOYEE_HEADERS.identity));
  const baseSalary=numberValue(pick(row,EMPLOYEE_HEADERS.baseSalary));
  const housingAllowance=numberValue(pick(row,EMPLOYEE_HEADERS.housingAllowance));
  const transportAllowance=numberValue(pick(row,EMPLOYEE_HEADERS.transportAllowance));
  let totalSalary=numberValue(pick(row,EMPLOYEE_HEADERS.totalSalary));
  if(totalSalary===null&&[baseSalary,housingAllowance,transportAllowance].some(v=>v!==null)) totalSalary=(baseSalary||0)+(housingAllowance||0)+(transportAllowance||0);
  return {identity,name:clean(pick(row,EMPLOYEE_HEADERS.name)),baseSalary,housingAllowance,transportAllowance,totalSalary,
    actualSalary:numberValue(pick(row,EMPLOYEE_HEADERS.actualSalary)),factoryAffiliation:clean(pick(row,EMPLOYEE_HEADERS.factoryAffiliation)),
    site:clean(pick(row,EMPLOYEE_HEADERS.site)),role:clean(pick(row,EMPLOYEE_HEADERS.role)),employeeNo:normalizeIdentity(pick(row,EMPLOYEE_HEADERS.employeeNo)),
    phone:clean(pick(row,EMPLOYEE_HEADERS.phone)),active:activeFromStatus(pick(row,EMPLOYEE_HEADERS.status)),notes:clean(pick(row,EMPLOYEE_HEADERS.notes)),source:clean(pick(row,EMPLOYEE_HEADERS.source))};
}
function canonicalAsset(row){return {assetNo:normalizeIdentity(pick(row,ASSET_HEADERS.assetNo)),assetPlate:clean(pick(row,ASSET_HEADERS.assetPlate)),type:clean(pick(row,ASSET_HEADERS.type)),group:clean(pick(row,ASSET_HEADERS.group)),makeModel:clean(pick(row,ASSET_HEADERS.makeModel)),year:clean(pick(row,ASSET_HEADERS.year)),vin:clean(pick(row,ASSET_HEADERS.vin)),cost:numberValue(pick(row,ASSET_HEADERS.cost)),status:clean(pick(row,ASSET_HEADERS.status)),site:clean(pick(row,ASSET_HEADERS.site)),notes:clean(pick(row,ASSET_HEADERS.notes))};}
function canonicalLink(row){
  const action=clean(pick(row,LINK_HEADERS.action))||'تحديث/إنشاء';
  return {action,identity:normalizeIdentity(pick(row,LINK_HEADERS.identity)),name:clean(pick(row,LINK_HEADERS.name)),factoryAffiliation:clean(pick(row,LINK_HEADERS.factoryAffiliation)),baseSalary:numberValue(pick(row,LINK_HEADERS.baseSalary)),housingAllowance:numberValue(pick(row,LINK_HEADERS.housingAllowance)),transportAllowance:numberValue(pick(row,LINK_HEADERS.transportAllowance)),totalSalary:numberValue(pick(row,LINK_HEADERS.totalSalary)),actualSalary:numberValue(pick(row,LINK_HEADERS.actualSalary)),site:clean(pick(row,LINK_HEADERS.site)),role:clean(pick(row,LINK_HEADERS.role)),fuelPlate:normalizePlate(pick(row,LINK_HEADERS.fuelPlate)),fuelDriverName:clean(pick(row,LINK_HEADERS.fuelDriverName)),fuelVehicleDescription:clean(pick(row,LINK_HEADERS.fuelVehicleDescription)),fuelType:clean(pick(row,LINK_HEADERS.fuelType)),assetNo:normalizeIdentity(pick(row,LINK_HEADERS.assetNo)),assetPlate:clean(pick(row,LINK_HEADERS.assetPlate)),assetType:clean(pick(row,LINK_HEADERS.assetType)),group:clean(pick(row,LINK_HEADERS.group)),makeModel:clean(pick(row,LINK_HEADERS.makeModel)),cost:numberValue(pick(row,LINK_HEADERS.cost)),matchStatus:clean(pick(row,LINK_HEADERS.matchStatus)),startDate:clean(pick(row,LINK_HEADERS.startDate)),allocation:numberValue(pick(row,LINK_HEADERS.allocation))??100,notes:clean(pick(row,LINK_HEADERS.notes))};
}
function existingEmployeeIdentity(row){return normalizeIdentity(row?.nid||row?.nationalId||row?.national_id||row?.identity);}
function existingEmployeeNo(row){return normalizeIdentity(row?.no||row?.employeeNo||row?.employee_no);}
function existingAssetNo(row){return normalizeIdentity(row?.acct||row?.assetNo||row?.asset_no||row?.externalAssetNo);}
function existingFuelPlate(row){return normalizePlate(row?.fuelPlate||row?.fuel_plate||row?.plate||row?.plateNo||row?.plate_no);}
function actionType(action){const a=normalizeName(action);if(a.includes('الغاء')||a.includes('إلغاء')||a==='unlink'||a==='remove')return 'unlink';if(a.includes('لاتغيير')||a==='skip'||a==='ignore')return 'skip';return 'upsert';}

export function workbookRows(XLSX,workbook){
  if(!XLSX?.utils?.sheet_to_json)throw new Error('مكتبة قراءة Excel غير متاحة داخل البرنامج.');
  const sheet=(name)=>workbook.Sheets?.[name];
  if(!sheet(TEMPLATE_SHEETS.links))throw new Error('ورقة «الربط الموحد» غير موجودة في الملف.');
  return {
    employees:sheet(TEMPLATE_SHEETS.employees)?XLSX.utils.sheet_to_json(sheet(TEMPLATE_SHEETS.employees),{defval:'',raw:false}):[],
    assets:sheet(TEMPLATE_SHEETS.assets)?XLSX.utils.sheet_to_json(sheet(TEMPLATE_SHEETS.assets),{defval:'',raw:false}):[],
    links:XLSX.utils.sheet_to_json(sheet(TEMPLATE_SHEETS.links),{defval:'',raw:false,range:3})
  };
}

export function buildImportPlan(source,current={}){
  const employees=(source.employees||[]).map(canonicalEmployee).filter(x=>x.identity||x.employeeNo||x.name);
  const assets=(source.assets||[]).map(canonicalAsset).filter(x=>x.assetNo||x.assetPlate||x.type);
  const employeeByIdentity=new Map(employees.filter(x=>x.identity).map(x=>[x.identity,x]));
  const assetByNo=new Map(assets.filter(x=>x.assetNo).map(x=>[x.assetNo,x]));
  const links=[];
  for(const raw of source.links||[]){
    const row=canonicalLink(raw);
    if(!row.identity&&!row.assetNo&&!row.fuelPlate)continue;
    const emp=employeeByIdentity.get(row.identity);
    if(emp){for(const key of ['name','factoryAffiliation','site','role'])if(!row[key])row[key]=emp[key];for(const key of ['baseSalary','housingAllowance','transportAllowance','totalSalary','actualSalary'])if(row[key]===null)row[key]=emp[key];}
    const asset=assetByNo.get(row.assetNo);
    if(asset){if(!row.assetPlate)row.assetPlate=asset.assetPlate;if(!row.assetType)row.assetType=asset.type;if(!row.group)row.group=asset.group;if(!row.makeModel)row.makeModel=asset.makeModel;if(row.cost===null)row.cost=asset.cost;}
    links.push(row);
  }
  const errors=[],warnings=[];
  const seenEmployee=new Map(),seenAsset=new Map(),seenPlate=new Map();
  links.forEach((row,index)=>{
    const rowNo=index+5,type=actionType(row.action);row.type=type;row.rowNo=rowNo;
    if(type==='skip')return;
    if(!row.identity)errors.push(`الصف ${rowNo}: رقم الهوية/الإقامة مطلوب.`);
    if(type==='upsert'&&!row.assetNo)errors.push(`الصف ${rowNo}: رقم الأصل ERP مطلوب.`);
    if(type==='upsert'&&!row.fuelPlate)errors.push(`الصف ${rowNo}: لوحة الديزل مطلوبة.`);
    if(type==='upsert'){
      for(const [map,key,label] of [[seenEmployee,row.identity,'الموظف'],[seenAsset,row.assetNo,'الأصل'],[seenPlate,row.fuelPlate,'اللوحة']]){
        if(!key)continue;const old=map.get(key);if(old)errors.push(`الصفان ${old} و${rowNo}: ${label} مستخدم في أكثر من ربط فعال.`);else map.set(key,rowNo);
      }
    }
  });
  const currentEmployees=current.employees||[],currentAssets=current.assets||[],currentLinks=current.links||[];
  const currentEmpIdentity=new Set(currentEmployees.map(existingEmployeeIdentity).filter(Boolean));
  const currentEmpNo=new Set(currentEmployees.map(existingEmployeeNo).filter(Boolean));
  const currentAssetNo=new Set(currentAssets.map(existingAssetNo).filter(Boolean));
  const linkUpserts=links.filter(x=>x.type==='upsert'),unlinks=links.filter(x=>x.type==='unlink');
  const employeeCreates=employees.filter(x=>!currentEmpIdentity.has(x.identity)&&!currentEmpNo.has(x.employeeNo)).length;
  const employeeUpdates=employees.length-employeeCreates;
  const assetCreates=assets.filter(x=>!currentAssetNo.has(x.assetNo)).length;
  const assetUpdates=assets.length-assetCreates;
  for(const row of linkUpserts){if(!employeeByIdentity.has(row.identity)&&!currentEmpIdentity.has(row.identity))warnings.push(`الصف ${row.rowNo}: الموظف غير موجود في ورقة الموظفين؛ سيُنشأ من بيانات الربط المتاحة.`);if(!assetByNo.has(row.assetNo)&&!currentAssetNo.has(row.assetNo))warnings.push(`الصف ${row.rowNo}: الأصل غير موجود في ورقة الأصول؛ سيُنشأ من بيانات الربط المتاحة.`);}
  return {employees,assets,links,errors:[...new Set(errors)],warnings:[...new Set(warnings)],summary:{employeeCreates,employeeUpdates,assetCreates,assetUpdates,linkUpserts:linkUpserts.length,unlinks:unlinks.length,ignored:links.filter(x=>x.type==='skip').length,currentLinks:currentLinks.length}};
}

function mergeEmployee(old,row){
  const out={...(old||{})};
  const id=old?.id||`emp-${row.identity||row.employeeNo||Math.random().toString(36).slice(2,10)}`;
  out.id=id;nonBlank(out,'nid',row.identity);nonBlank(out,'nationalId',row.identity);nonBlank(out,'no',row.employeeNo);nonBlank(out,'employeeNo',row.employeeNo);nonBlank(out,'name',row.name);nonBlank(out,'fullName',row.name);
  for(const key of ['baseSalary','housingAllowance','transportAllowance','totalSalary','actualSalary'])if(row[key]!==null)out[key]=row[key];
  const effective=row.actualSalary??row.totalSalary??row.baseSalary;if(effective!==null&&effective!==undefined)out.salary=effective;
  nonBlank(out,'factoryAffiliation',row.factoryAffiliation);nonBlank(out,'site',row.site);nonBlank(out,'role',row.role);nonBlank(out,'tel',row.phone);nonBlank(out,'phone',row.phone);nonBlank(out,'notes',row.notes);nonBlank(out,'source',row.source);out.act=row.active!==false;return out;
}
function mergeAsset(old,row){
  const out={...(old||{})};out.id=old?.id||`asset-${row.assetNo||Math.random().toString(36).slice(2,10)}`;nonBlank(out,'acct',row.assetNo);nonBlank(out,'assetNo',row.assetNo);nonBlank(out,'assetPlate',row.assetPlate);if(!out.plate&&row.assetPlate)out.plate=row.assetPlate;nonBlank(out,'type',row.type);nonBlank(out,'group',row.group);nonBlank(out,'makeModel',row.makeModel);if(row.makeModel&&!out.make)out.make=row.makeModel;nonBlank(out,'year',row.year);nonBlank(out,'vin',row.vin);if(row.cost!==null)out.cost=row.cost;nonBlank(out,'status',row.status);nonBlank(out,'site',row.site);nonBlank(out,'notes',row.notes);out.act=normalizeName(row.status)!=='موقوف';return out;
}
function findEmployee(employees,identity,employeeNo=''){return employees.find(x=>existingEmployeeIdentity(x)===identity)||(employeeNo?employees.find(x=>existingEmployeeNo(x)===employeeNo):null);}
function findAsset(assets,assetNo,plate=''){return assets.find(x=>existingAssetNo(x)===assetNo)||(plate?assets.find(x=>existingFuelPlate(x)===plate):null);}
function rowValueByAliases(row,aliases){return pick(row,aliases);}
export function remapFuelRows(fuelRows,links,employees,assets){
  const active=(links||[]).filter(x=>x.active!==false);
  const byPlate=new Map(active.map(x=>[normalizePlate(x.fuelPlate||x.plate),x]).filter(x=>x[0]));
  const byDriver=new Map(active.map(x=>[normalizeName(x.fuelDriverName||x.employeeName),x]).filter(x=>x[0]));
  let mapped=0;
  for(const row of fuelRows||[]){
    const plate=normalizePlate(rowValueByAliases(row,FUEL_PLATE_KEYS));const driver=normalizeName(rowValueByAliases(row,FUEL_DRIVER_KEYS));const link=byPlate.get(plate)||byDriver.get(driver);if(!link)continue;
    const emp=findEmployee(employees,link.employeeIdentity||link.nationalId)||employees.find(x=>x.id===link.employeeId);const asset=findAsset(assets,link.assetNo,link.fuelPlate)||assets.find(x=>x.id===link.assetId);
    row.employeeExternalId=emp?.id||link.employeeId||'';row.employee_external_id=row.employeeExternalId;row.employeeNationalId=link.employeeIdentity||link.nationalId||existingEmployeeIdentity(emp);row.employeeName=emp?.name||emp?.fullName||link.employeeName||'';
    row.vehicleExternalId=asset?.id||link.assetId||'';row.vehicle_external_id=row.vehicleExternalId;row.assetNo=link.assetNo||existingAssetNo(asset);row.asset_no=row.assetNo;row.unifiedLinkId=link.id||'';row.fuelPlate=link.fuelPlate||plate;mapped++;
  }
  return mapped;
}

export function applyImportPlan(target,plan){
  if(plan.errors?.length)throw new Error('لا يمكن الاعتماد قبل معالجة أخطاء الملف.');
  const employees=target.employees,assets=target.assets,links=target.links,fuel=target.fuel||[];
  for(const row of plan.employees){const old=findEmployee(employees,row.identity,row.employeeNo),merged=mergeEmployee(old,row);if(old)employees[employees.indexOf(old)]=merged;else employees.push(merged);}
  for(const row of plan.assets){const old=findAsset(assets,row.assetNo),merged=mergeAsset(old,row);if(old)assets[assets.indexOf(old)]=merged;else assets.push(merged);}
  let linked=0,unlinked=0;
  for(const row of plan.links){
    if(row.type==='skip')continue;
    let emp=findEmployee(employees,row.identity);if(!emp){emp=mergeEmployee(null,{...row,employeeNo:'',phone:'',active:true,source:'قالب الربط الموحد'});employees.push(emp);}
    let asset=findAsset(assets,row.assetNo,row.fuelPlate);if(row.type==='unlink'){
      for(let i=links.length-1;i>=0;i--){const l=links[i];if((row.identity&&normalizeIdentity(l.employeeIdentity||l.nationalId)===row.identity)||(row.assetNo&&normalizeIdentity(l.assetNo)===row.assetNo)||(row.fuelPlate&&normalizePlate(l.fuelPlate)===row.fuelPlate)){links.splice(i,1);unlinked++;}}
      if(asset&&(!asset.drv||asset.drv===emp.id)){asset.drv='';asset.driverEmployeeId='';asset.fuelPlate='';}
      continue;
    }
    if(!asset){asset=mergeAsset(null,{assetNo:row.assetNo,assetPlate:row.assetPlate,type:row.assetType,group:row.group,makeModel:row.makeModel,cost:row.cost,status:'فعال',site:row.site,notes:row.notes});assets.push(asset);}
    for(let i=links.length-1;i>=0;i--){const l=links[i];if(l.active!==false&&((l.employeeId&&l.employeeId===emp.id)||(normalizeIdentity(l.assetNo)===row.assetNo)||(normalizePlate(l.fuelPlate)===row.fuelPlate)))links.splice(i,1);}
    const link={id:`link-${emp.id}-${asset.id}`,employeeId:emp.id,employeeIdentity:row.identity,nationalId:row.identity,employeeNo:emp.no||emp.employeeNo||'',employeeName:emp.name||emp.fullName||row.name,assetId:asset.id,assetNo:row.assetNo,assetPlate:row.assetPlate||asset.assetPlate||asset.plate||'',fuelPlate:row.fuelPlate,fuelDriverName:row.fuelDriverName,fuelVehicleDescription:row.fuelVehicleDescription,fuelType:row.fuelType,startDate:row.startDate||new Date().toISOString().slice(0,10),salaryAllocationPercent:row.allocation??100,notes:row.notes,active:true,updatedAt:new Date().toISOString()};
    links.push(link);asset.assetPlate=asset.assetPlate||asset.plate||row.assetPlate;asset.plate=row.fuelPlate;asset.fuelPlate=row.fuelPlate;asset.drv=emp.id;asset.driverEmployeeId=emp.id;asset.driverNationalId=row.identity;asset.unifiedLinkId=link.id;emp.assetId=asset.id;emp.assetNo=row.assetNo;emp.fuelPlate=row.fuelPlate;emp.unifiedLinkId=link.id;linked++;
  }
  const mappedFuel=remapFuelRows(fuel,links,employees,assets);
  return {linked,unlinked,mappedFuel,employees:employees.length,assets:assets.length,links:links.length};
}
