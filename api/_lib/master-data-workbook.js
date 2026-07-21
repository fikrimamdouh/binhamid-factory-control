const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const digits=value=>westernDigits(value).replace(/[^0-9]/g,'').slice(0,15);
const num=value=>{const parsed=Number(westernDigits(value).replace(/[٬,]/g,'').replace(/٫/g,'.'));return Number.isFinite(parsed)?parsed:0;};
const norm=value=>clean(value,300).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[^a-z0-9\u0600-\u06ff]+/g,' ').replace(/\s+/g,' ').trim();
export const normalizePlate=value=>clean(westernDigits(value),80).toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g,'');
const plateDigits=value=>normalizePlate(value).replace(/[^0-9]/g,'');

function rowsOf(workbook,xlsx,name){const sheet=workbook?.Sheets?.[name];return sheet?xlsx.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false}):[];}
function headerMap(row){return Object.fromEntries((row||[]).map((value,index)=>[norm(value),index]).filter(([key])=>key));}
function col(map,...aliases){for(const alias of aliases){const key=norm(alias);if(Object.prototype.hasOwnProperty.call(map,key))return map[key];}return-1;}
function findHeader(rows,predicate){for(let index=0;index<Math.min(rows.length,12);index++){const map=headerMap(rows[index]);if(predicate(map))return{index,map};}return null;}
const valueAt=(row,index)=>index>=0?row?.[index]:'';
function assetType(type,group){const text=norm(`${type} ${group}`);if(/سيار|شاحن|قلاب|تريلا|مركب|vehicle|truck/.test(text))return'vehicle';if(/اله|الة|معدات|خلاط|كسارة|لنكر|صهريج|equipment/.test(text))return'equipment';return'fixed_asset';}
function statusOf(value){const text=norm(value);if(/sold|مباع/.test(text))return'sold';if(/out|خارج/.test(text))return'out_of_service';if(/maintenance|صيانه|صيانة|workshop|ورشه|ورشة/.test(text))return'maintenance';if(/spare|احتياط/.test(text))return'spare';if(/stopped|متوقف/.test(text))return'stopped';if(/parked|مركون/.test(text))return'parked';return'in_service';}
function workStatusOf(value){const text=norm(value);if(/holiday|vacation|اجازه|إجازة|اجازة/.test(text))return'holiday';if(/leave|غياب|اجازه مرض/.test(text))return'leave';if(/suspend|ايقاف|إيقاف/.test(text))return'suspended';if(/inactive|غير نشط|منتهي/.test(text))return'inactive';if(/working|على راس العمل|على رأس العمل|دوام/.test(text))return'working';return'unknown';}
function looksLikeWorkStatus(value){return workStatusOf(value)!=='unknown';}
function snapshotErp(asset){if(!asset)return null;return{externalKey:asset.key,assetNo:asset.assetNo||null,oldPlate:asset.metadata?.erpOldPlate||asset.plateNo||null,newPlate:asset.metadata?.erpNewPlate||null,assetType:asset.assetType||null,assetName:asset.assetName||null,make:asset.make||null,model:asset.model||null,purchaseCost:Number(asset.metadata?.purchaseCost||0),operationalStatus:asset.operationalStatus||null};}

export function parseUnifiedMasterWorkbook(workbook,xlsx){
  const warnings=[],employeesById=new Map(),assetsByKey=new Map(),plateSources=new Map(),erpAssetsByNo=new Map();

  const employeeRows=rowsOf(workbook,xlsx,'الموظفون'),employeeHeader=findHeader(employeeRows,map=>col(map,'رقم الهوية / الإقامة','رقم الهوية','الهوية')>=0&&col(map,'اسم الموظف')>=0);
  if(employeeHeader){
    const h=employeeHeader.map,idx={national:col(h,'رقم الهوية / الإقامة','رقم الهوية','الهوية'),name:col(h,'اسم الموظف'),basic:col(h,'الراتب الأساسي'),housing:col(h,'بدل السكن'),transport:col(h,'بدل النقل'),package:col(h,'إجمالي راتب مدد'),factory:col(h,'تابع للمصنع؟'),site:col(h,'الموقع'),workStatus:col(h,'حالة الدوام','حالة العمل','حالة الموظف'),role:col(h,'الوظيفة'),actual:col(h,'الراتب الفعلي'),employeeNo:col(h,'الرقم الوظيفي'),phone:col(h,'الجوال'),state:col(h,'الحالة','حالة السجل'),notes:col(h,'ملاحظات')};
    for(let i=employeeHeader.index+1;i<employeeRows.length;i++){
      const row=employeeRows[i],nationalId=digits(valueAt(row,idx.national));if(!nationalId)continue;
      if(employeesById.has(nationalId)){warnings.push({code:'DUPLICATE_EMPLOYEE_ID',row:i+1,nationalId});continue;}
      const packageSalary=num(valueAt(row,idx.package)),actualSalary=num(valueAt(row,idx.actual));
      let site=clean(valueAt(row,idx.site),120)||null,rawWorkStatus=clean(valueAt(row,idx.workStatus),80);
      if(!rawWorkStatus&&looksLikeWorkStatus(site)){rawWorkStatus=site;site=null;}
      const workStatus=workStatusOf(rawWorkStatus);
      employeesById.set(nationalId,{nationalId,fullName:clean(valueAt(row,idx.name),200)||`موظف ${nationalId.slice(-4)}`,employeeNo:clean(valueAt(row,idx.employeeNo),100)||null,phone:clean(valueAt(row,idx.phone),40)||null,role:clean(valueAt(row,idx.role),120)||null,site,salary:actualSalary||packageSalary,basicSalary:num(valueAt(row,idx.basic)),housingAllowance:num(valueAt(row,idx.housing)),transportAllowance:num(valueAt(row,idx.transport)),totalPackage:packageSalary,factoryStatus:clean(valueAt(row,idx.factory),40)||null,workStatus,active:!/(غير نشط|inactive|موقوف)/i.test(clean(valueAt(row,idx.state),40)),notes:clean(valueAt(row,idx.notes),500)||null,sourceRow:i+1});
    }
  }

  const fuelRows=rowsOf(workbook,xlsx,'لوحات الديزل'),fuelHeader=findHeader(fuelRows,map=>col(map,'اللوحة الموحدة')>=0&&col(map,'نوع الوقود')>=0);
  if(fuelHeader){
    const h=fuelHeader.map,idx={plate:col(h,'اللوحة الموحدة'),original:col(h,'اللوحة كما وردت'),driver:col(h,'اسم السائق/البطاقة'),vehicle:col(h,'وصف المركبة'),alternateDriver:col(h,'اسم إضافي بالمصدر','Column1'),fuel:col(h,'نوع الوقود'),notes:col(h,'ملاحظات')};
    for(let i=fuelHeader.index+1;i<fuelRows.length;i++){
      const row=fuelRows[i],plate=clean(valueAt(row,idx.plate),80),plateKey=normalizePlate(plate);if(!plateKey)continue;
      plateSources.set(plateKey,{plateNo:plate||clean(valueAt(row,idx.original),80),originalPlate:clean(valueAt(row,idx.original),80)||null,assetName:clean(valueAt(row,idx.vehicle),200)||clean(valueAt(row,idx.driver),200)||plate,driverLabel:clean(valueAt(row,idx.driver),160)||null,alternateDriverLabel:clean(valueAt(row,idx.alternateDriver),160)||null,fuelType:clean(valueAt(row,idx.fuel),40)||null,notes:clean(valueAt(row,idx.notes),500)||null,sourceRow:i+1});
    }
  }

  const suffixCandidates=new Map();
  for(const[plateKey,source]of plateSources){const suffix=plateDigits(source.plateNo);if(!suffix)continue;const list=suffixCandidates.get(suffix)||[];list.push(plateKey);suffixCandidates.set(suffix,list);}

  const fixedRows=rowsOf(workbook,xlsx,'الأصول الثابتة'),fixedHeader=findHeader(fixedRows,map=>col(map,'رقم الأصل ERP')>=0&&col(map,'نوع الأصل')>=0);
  if(fixedHeader){
    const h=fixedHeader.map,idx={assetNo:col(h,'رقم الأصل ERP'),oldPlate:col(h,'رقم اللوحة القديمة / التشغيل','رقم اللوحة / التشغيل','اللوحة القديمة','رقم اللوحة'),newPlate:col(h,'اللوحة الجديدة / لوحة الديزل','رقم اللوحة الجديدة','اللوحة الجديدة','لوحة الديزل'),sourceStatus:col(h,'الحالة الفعلية من ERP','الحالة الفعلية','Column1'),type:col(h,'نوع الأصل'),group:col(h,'المجموعة'),make:col(h,'الماركة والموديل'),year:col(h,'سنة الصنع'),vin:col(h,'رقم الهيكل VIN'),cost:col(h,'تكلفة الشراء'),status:col(h,'الحالة التشغيلية'),site:col(h,'الموقع'),notes:col(h,'ملاحظات')};
    for(let i=fixedHeader.index+1;i<fixedRows.length;i++){
      const row=fixedRows[i],assetNo=clean(westernDigits(valueAt(row,idx.assetNo)),120);if(!assetNo)continue;
      const oldPlate=clean(westernDigits(valueAt(row,idx.oldPlate)),80)||null,explicitNewPlate=clean(westernDigits(valueAt(row,idx.newPlate)),80)||null,sourceStatus=clean(valueAt(row,idx.sourceStatus),80),officialStatus=clean(valueAt(row,idx.status),80);
      let matchedFuelPlateKey=null;
      const explicitKey=normalizePlate(explicitNewPlate);if(explicitKey&&plateSources.has(explicitKey))matchedFuelPlateKey=explicitKey;
      if(!matchedFuelPlateKey){const oldKey=normalizePlate(oldPlate);if(oldKey&&plateSources.has(oldKey))matchedFuelPlateKey=oldKey;}
      if(!matchedFuelPlateKey){const suffix=plateDigits(explicitNewPlate||oldPlate),matches=suffixCandidates.get(suffix)||[];if(suffix&&matches.length===1)matchedFuelPlateKey=matches[0];}
      const key=`erp:${assetNo}`,operationalStatus=statusOf(sourceStatus||officialStatus),asset={key,assetNo,plateNo:oldPlate,assetType:assetType(valueAt(row,idx.type),valueAt(row,idx.group)),assetName:clean(valueAt(row,idx.type),200)||assetNo,make:clean(valueAt(row,idx.make),200)||null,model:null,serialNo:clean(valueAt(row,idx.vin),160)||null,operationalStatus,dieselExpected:false,costCenterCode:clean(valueAt(row,idx.site),80)||null,assignedNationalId:null,metadata:{source:'unified_master_workbook',group:clean(valueAt(row,idx.group),160)||null,manufactureYear:clean(westernDigits(valueAt(row,idx.year)),20)||null,purchaseCost:num(valueAt(row,idx.cost)),notes:clean(valueAt(row,idx.notes),500)||null,sourceRow:i+1,sourceOperationalStatus:sourceStatus||officialStatus||null,erpOldPlate:oldPlate,erpNewPlate:explicitNewPlate||(matchedFuelPlateKey?plateSources.get(matchedFuelPlateKey)?.plateNo:null),matchedFuelPlateKey}};
      assetsByKey.set(key,asset);erpAssetsByNo.set(assetNo,asset);
    }
  }

  const fuelAsset=(plateKey)=>{
    const source=plateSources.get(plateKey)||{},key=`plate:${plateKey}`;
    let asset=assetsByKey.get(key);
    if(!asset){asset={key,assetNo:null,plateNo:source.plateNo||plateKey,assetType:'vehicle',assetName:source.assetName||source.plateNo||plateKey,make:null,model:null,serialNo:null,operationalStatus:'in_service',dieselExpected:true,costCenterCode:null,assignedNationalId:null,metadata:{source:'fuel_plate',fuelPlateKey:plateKey,originalPlate:source.originalPlate||null,fuelType:source.fuelType||null,driverLabel:source.driverLabel||null,alternateDriverLabel:source.alternateDriverLabel||null,notes:source.notes||null,sourceRow:source.sourceRow}};assetsByKey.set(key,asset);}
    return asset;
  };

  const linkRows=rowsOf(workbook,xlsx,'الربط الموحد'),linkHeader=findHeader(linkRows,map=>col(map,'رقم الهوية / الإقامة','رقم الهوية')>=0&&(col(map,'لوحة الديزل')>=0||col(map,'رقم الأصل ERP')>=0));
  if(linkHeader){
    const h=linkHeader.map,idx={action:col(h,'إجراء الاستيراد'),national:col(h,'رقم الهوية / الإقامة'),name:col(h,'اسم الموظف'),actual:col(h,'الراتب الفعلي'),site:col(h,'الموقع'),role:col(h,'الوظيفة'),fuelPlate:col(h,'لوحة الديزل'),assetNo:col(h,'رقم الأصل ERP'),start:col(h,'تاريخ بداية الربط'),allocation:col(h,'نسبة تحميل الراتب %'),notes:col(h,'ملاحظات')};
    const usedAssets=new Map(),usedPlates=new Map();
    for(let i=linkHeader.index+1;i<linkRows.length;i++){
      const row=linkRows[i],action=clean(valueAt(row,idx.action),40);if(action&&/تجاهل|ignore/i.test(action))continue;
      const nationalId=digits(valueAt(row,idx.national));if(!nationalId)continue;
      let employee=employeesById.get(nationalId);if(!employee){employee={nationalId,fullName:clean(valueAt(row,idx.name),200)||`موظف ${nationalId.slice(-4)}`,employeeNo:null,phone:null,role:null,site:null,salary:0,basicSalary:0,housingAllowance:0,transportAllowance:0,totalPackage:0,factoryStatus:null,workStatus:'unknown',active:true,notes:null,sourceRow:i+1};employeesById.set(nationalId,employee);warnings.push({code:'EMPLOYEE_CREATED_FROM_LINK',row:i+1,nationalId});}
      employee.role=clean(valueAt(row,idx.role),120)||employee.role;employee.site=clean(valueAt(row,idx.site),120)||employee.site;employee.salary=num(valueAt(row,idx.actual))||employee.salary;
      const plateRaw=clean(westernDigits(valueAt(row,idx.fuelPlate)),80),plateKey=normalizePlate(plateRaw),assetNo=clean(westernDigits(valueAt(row,idx.assetNo)),120);
      let asset=null;
      if(plateKey){asset=fuelAsset(plateKey);asset.dieselExpected=true;const source=plateSources.get(plateKey);if(source){asset.plateNo=source.plateNo||plateRaw;asset.assetName=source.assetName||asset.assetName;asset.metadata={...(asset.metadata||{}),fuelPlateKey:plateKey,fuelType:source.fuelType||asset.metadata?.fuelType||null};}}
      else if(assetNo){asset=erpAssetsByNo.get(assetNo);if(!asset){asset={key:`erp:${assetNo}`,assetNo,plateNo:null,assetType:'equipment',assetName:assetNo,make:null,model:null,serialNo:null,operationalStatus:'in_service',dieselExpected:false,costCenterCode:null,assignedNationalId:null,metadata:{source:'unified_master_workbook',createdFromLink:true,sourceRow:i+1}};assetsByKey.set(asset.key,asset);erpAssetsByNo.set(assetNo,asset);warnings.push({code:'ASSET_CREATED_FROM_LINK',row:i+1,assetNo});}}
      if(asset){
        if(assetNo&&plateKey){const erpAsset=erpAssetsByNo.get(assetNo);if(erpAsset)asset.metadata={...(asset.metadata||{}),sourceErpReference:snapshotErp(erpAsset),erpReference:snapshotErp(erpAsset),erpReferenceMode:'source'};else warnings.push({code:'ERP_REFERENCE_NOT_FOUND',row:i+1,assetNo,plate:plateRaw});}
        if(asset.assignedNationalId&&asset.assignedNationalId!==nationalId)warnings.push({code:'ASSET_ASSIGNED_TWICE',row:i+1,asset:asset.assetNo||asset.plateNo,employees:[asset.assignedNationalId,nationalId]});
        asset.assignedNationalId=nationalId;asset.costCenterCode=employee.site||asset.costCenterCode;asset.metadata={...(asset.metadata||{}),linkStart:clean(valueAt(row,idx.start),40)||null,salaryAllocationPct:num(valueAt(row,idx.allocation))||100,linkNotes:clean(valueAt(row,idx.notes),500)||null};
        if(assetNo){if(usedAssets.has(assetNo)&&usedAssets.get(assetNo)!==nationalId)warnings.push({code:'DUPLICATE_ASSET_LINK',row:i+1,assetNo});usedAssets.set(assetNo,nationalId);}
        if(plateKey){if(usedPlates.has(plateKey)&&usedPlates.get(plateKey)!==nationalId)warnings.push({code:'DUPLICATE_PLATE_LINK',row:i+1,plate:plateRaw});usedPlates.set(plateKey,nationalId);}
      }
    }
  }

  const erpByFuelPlate=new Map();
  for(const asset of erpAssetsByNo.values()){const key=asset.metadata?.matchedFuelPlateKey;if(!key)continue;const current=erpByFuelPlate.get(key);if(!current)erpByFuelPlate.set(key,asset);else erpByFuelPlate.set(key,null);}
  for(const plateKey of plateSources.keys()){
    const asset=fuelAsset(plateKey),erpAsset=erpByFuelPlate.get(plateKey);
    if(erpAsset&&!asset.metadata?.erpReference){const ref=snapshotErp(erpAsset);asset.metadata={...(asset.metadata||{}),sourceErpReference:ref,erpReference:ref,erpReferenceMode:'source'};}
  }

  return{employees:[...employeesById.values()],assets:[...assetsByKey.values()],warnings,stats:{employees:employeesById.size,assets:assetsByKey.size,linkedAssets:[...assetsByKey.values()].filter(row=>row.assignedNationalId).length,fuelPlates:plateSources.size,erpReferences:[...assetsByKey.values()].filter(row=>row.dieselExpected===true&&row.metadata?.erpReference).length}};
}
