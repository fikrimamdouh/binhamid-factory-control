const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const westernDigits=value=>String(value??'').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const digits=value=>westernDigits(value).replace(/[^0-9]/g,'').slice(0,15);
const num=value=>{const parsed=Number(westernDigits(value).replace(/[٬,]/g,'').replace(/٫/g,'.'));return Number.isFinite(parsed)?parsed:0;};
const norm=value=>clean(value,300).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[^a-z0-9\u0600-\u06ff]+/g,' ').replace(/\s+/g,' ').trim();
export const normalizePlate=value=>clean(westernDigits(value),80).toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g,'');

function rowsOf(workbook,xlsx,name){const sheet=workbook?.Sheets?.[name];return sheet?xlsx.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false}):[];}
function headerMap(row){return Object.fromEntries((row||[]).map((value,index)=>[norm(value),index]).filter(([key])=>key));}
function col(map,...aliases){for(const alias of aliases){const key=norm(alias);if(Object.prototype.hasOwnProperty.call(map,key))return map[key];}return-1;}
function findHeader(rows,predicate){for(let index=0;index<Math.min(rows.length,12);index++){const map=headerMap(rows[index]);if(predicate(map))return{index,map};}return null;}
const valueAt=(row,index)=>index>=0?row?.[index]:'';
function assetType(type,group){const text=norm(`${type} ${group}`);if(/سيار|شاحن|قلاب|تريلا|مركب|vehicle|truck/.test(text))return'vehicle';if(/اله|الة|معدات|خلاط|كسارة|لنكر|صهريج|equipment/.test(text))return'equipment';return'fixed_asset';}
function statusOf(value){const text=norm(value);if(/sold|مباع/.test(text))return'sold';if(/out|خارج/.test(text))return'out_of_service';if(/maintenance|صيانه|صيانة|workshop|ورشه|ورشة/.test(text))return'maintenance';if(/stopped|متوقف/.test(text))return'stopped';if(/parked|مركون/.test(text))return'parked';return'in_service';}

export function parseUnifiedMasterWorkbook(workbook,xlsx){
  const warnings=[],employeesById=new Map(),assetsByKey=new Map(),plateSources=new Map();
  const employeeRows=rowsOf(workbook,xlsx,'الموظفون'),employeeHeader=findHeader(employeeRows,map=>col(map,'رقم الهوية / الإقامة','رقم الهوية','الهوية')>=0&&col(map,'اسم الموظف')>=0);
  if(employeeHeader){
    const h=employeeHeader.map,idx={national:col(h,'رقم الهوية / الإقامة','رقم الهوية','الهوية'),name:col(h,'اسم الموظف'),basic:col(h,'الراتب الأساسي'),housing:col(h,'بدل السكن'),transport:col(h,'بدل النقل'),package:col(h,'إجمالي راتب مدد'),factory:col(h,'تابع للمصنع؟'),site:col(h,'الموقع'),role:col(h,'الوظيفة'),actual:col(h,'الراتب الفعلي'),employeeNo:col(h,'الرقم الوظيفي'),phone:col(h,'الجوال'),state:col(h,'الحالة'),notes:col(h,'ملاحظات')};
    for(let i=employeeHeader.index+1;i<employeeRows.length;i++){
      const row=employeeRows[i],nationalId=digits(valueAt(row,idx.national));if(!nationalId)continue;
      if(employeesById.has(nationalId)){warnings.push({code:'DUPLICATE_EMPLOYEE_ID',row:i+1,nationalId});continue;}
      const packageSalary=num(valueAt(row,idx.package)),actualSalary=num(valueAt(row,idx.actual));
      employeesById.set(nationalId,{nationalId,fullName:clean(valueAt(row,idx.name),200)||`موظف ${nationalId.slice(-4)}`,employeeNo:clean(valueAt(row,idx.employeeNo),100)||null,phone:clean(valueAt(row,idx.phone),40)||null,role:clean(valueAt(row,idx.role),120)||null,site:clean(valueAt(row,idx.site),120)||null,salary:actualSalary||packageSalary,basicSalary:num(valueAt(row,idx.basic)),housingAllowance:num(valueAt(row,idx.housing)),transportAllowance:num(valueAt(row,idx.transport)),totalPackage:packageSalary,factoryStatus:clean(valueAt(row,idx.factory),40)||null,active:!/(غير نشط|inactive|موقوف)/i.test(clean(valueAt(row,idx.state),40)),notes:clean(valueAt(row,idx.notes),500)||null,sourceRow:i+1});
    }
  }

  const fuelRows=rowsOf(workbook,xlsx,'لوحات الديزل'),fuelHeader=findHeader(fuelRows,map=>col(map,'اللوحة الموحدة')>=0&&col(map,'نوع الوقود')>=0);
  if(fuelHeader){
    const h=fuelHeader.map,idx={plate:col(h,'اللوحة الموحدة'),original:col(h,'اللوحة كما وردت'),driver:col(h,'اسم السائق/البطاقة'),vehicle:col(h,'وصف المركبة'),fuel:col(h,'نوع الوقود'),notes:col(h,'ملاحظات')};
    for(let i=fuelHeader.index+1;i<fuelRows.length;i++){
      const row=fuelRows[i],plate=clean(valueAt(row,idx.plate),80),plateKey=normalizePlate(plate);if(!plateKey)continue;
      plateSources.set(plateKey,{plateNo:plate||clean(valueAt(row,idx.original),80),assetName:clean(valueAt(row,idx.vehicle),200)||clean(valueAt(row,idx.driver),200)||plate,driverLabel:clean(valueAt(row,idx.driver),160)||null,fuelType:clean(valueAt(row,idx.fuel),40)||null,notes:clean(valueAt(row,idx.notes),500)||null,sourceRow:i+1});
    }
  }

  const fixedRows=rowsOf(workbook,xlsx,'الأصول الثابتة'),fixedHeader=findHeader(fixedRows,map=>col(map,'رقم الأصل ERP')>=0&&col(map,'نوع الأصل')>=0);
  if(fixedHeader){
    const h=fixedHeader.map,idx={assetNo:col(h,'رقم الأصل ERP'),plate:col(h,'رقم اللوحة / التشغيل'),type:col(h,'نوع الأصل'),group:col(h,'المجموعة'),make:col(h,'الماركة والموديل'),year:col(h,'سنة الصنع'),vin:col(h,'رقم الهيكل VIN'),cost:col(h,'تكلفة الشراء'),status:col(h,'الحالة التشغيلية'),site:col(h,'الموقع'),notes:col(h,'ملاحظات')};
    for(let i=fixedHeader.index+1;i<fixedRows.length;i++){
      const row=fixedRows[i],assetNo=clean(westernDigits(valueAt(row,idx.assetNo)),120);if(!assetNo)continue;
      const key=`erp:${assetNo}`;assetsByKey.set(key,{key,assetNo,plateNo:clean(westernDigits(valueAt(row,idx.plate)),80)||null,assetType:assetType(valueAt(row,idx.type),valueAt(row,idx.group)),assetName:clean(valueAt(row,idx.type),200)||assetNo,make:clean(valueAt(row,idx.make),200)||null,model:null,serialNo:clean(valueAt(row,idx.vin),160)||null,operationalStatus:statusOf(valueAt(row,idx.status)),dieselExpected:null,costCenterCode:clean(valueAt(row,idx.site),80)||null,assignedNationalId:null,metadata:{source:'unified_master_workbook',group:clean(valueAt(row,idx.group),160)||null,manufactureYear:clean(westernDigits(valueAt(row,idx.year)),20)||null,purchaseCost:num(valueAt(row,idx.cost)),notes:clean(valueAt(row,idx.notes),500)||null,sourceRow:i+1}});
    }
  }

  const linkRows=rowsOf(workbook,xlsx,'الربط الموحد'),linkHeader=findHeader(linkRows,map=>col(map,'رقم الهوية / الإقامة','رقم الهوية')>=0&&(col(map,'لوحة الديزل')>=0||col(map,'رقم الأصل ERP')>=0));
  if(linkHeader){
    const h=linkHeader.map,idx={action:col(h,'إجراء الاستيراد'),national:col(h,'رقم الهوية / الإقامة'),name:col(h,'اسم الموظف'),actual:col(h,'الراتب الفعلي'),site:col(h,'الموقع'),role:col(h,'الوظيفة'),fuelPlate:col(h,'لوحة الديزل'),assetNo:col(h,'رقم الأصل ERP'),start:col(h,'تاريخ بداية الربط'),allocation:col(h,'نسبة تحميل الراتب %'),notes:col(h,'ملاحظات')};
    const usedAssets=new Map(),usedPlates=new Map();
    for(let i=linkHeader.index+1;i<linkRows.length;i++){
      const row=linkRows[i],action=clean(valueAt(row,idx.action),40);if(action&&/تجاهل|ignore/i.test(action))continue;
      const nationalId=digits(valueAt(row,idx.national));if(!nationalId)continue;
      let employee=employeesById.get(nationalId);if(!employee){employee={nationalId,fullName:clean(valueAt(row,idx.name),200)||`موظف ${nationalId.slice(-4)}`,employeeNo:null,phone:null,role:null,site:null,salary:0,basicSalary:0,housingAllowance:0,transportAllowance:0,totalPackage:0,factoryStatus:null,active:true,notes:null,sourceRow:i+1};employeesById.set(nationalId,employee);warnings.push({code:'EMPLOYEE_CREATED_FROM_LINK',row:i+1,nationalId});}
      employee.role=clean(valueAt(row,idx.role),120)||employee.role;employee.site=clean(valueAt(row,idx.site),120)||employee.site;employee.salary=num(valueAt(row,idx.actual))||employee.salary;
      const plateRaw=clean(westernDigits(valueAt(row,idx.fuelPlate)),80),plateKey=normalizePlate(plateRaw),assetNo=clean(westernDigits(valueAt(row,idx.assetNo)),120);
      let asset=null;
      if(assetNo){asset=assetsByKey.get(`erp:${assetNo}`);if(!asset){asset={key:`erp:${assetNo}`,assetNo,plateNo:null,assetType:'equipment',assetName:assetNo,make:null,model:null,serialNo:null,operationalStatus:'in_service',dieselExpected:null,costCenterCode:null,assignedNationalId:null,metadata:{source:'unified_master_workbook',createdFromLink:true,sourceRow:i+1}};assetsByKey.set(asset.key,asset);warnings.push({code:'ASSET_CREATED_FROM_LINK',row:i+1,assetNo});}}
      if(!asset&&plateKey){const source=plateSources.get(plateKey)||{};const key=`plate:${plateKey}`;asset=assetsByKey.get(key)||{key,assetNo:null,plateNo:source.plateNo||plateRaw,assetType:'vehicle',assetName:source.assetName||plateRaw,make:null,model:null,serialNo:null,operationalStatus:'in_service',dieselExpected:true,costCenterCode:null,assignedNationalId:null,metadata:{source:'fuel_plate',fuelType:source.fuelType||null,driverLabel:source.driverLabel||null,sourceRow:source.sourceRow||i+1}};assetsByKey.set(key,asset);}
      if(asset){
        if(plateKey){const source=plateSources.get(plateKey);asset.plateNo=source?.plateNo||plateRaw;asset.dieselExpected=true;asset.metadata={...(asset.metadata||{}),fuelPlateKey:plateKey,fuelType:source?.fuelType||asset.metadata?.fuelType||null};}
        if(asset.assignedNationalId&&asset.assignedNationalId!==nationalId)warnings.push({code:'ASSET_ASSIGNED_TWICE',row:i+1,asset:asset.assetNo||asset.plateNo,employees:[asset.assignedNationalId,nationalId]});
        asset.assignedNationalId=nationalId;asset.costCenterCode=employee.site||asset.costCenterCode;asset.metadata={...(asset.metadata||{}),linkStart:clean(valueAt(row,idx.start),40)||null,salaryAllocationPct:num(valueAt(row,idx.allocation))||100,linkNotes:clean(valueAt(row,idx.notes),500)||null};
        if(asset.assetNo){if(usedAssets.has(asset.assetNo)&&usedAssets.get(asset.assetNo)!==nationalId)warnings.push({code:'DUPLICATE_ASSET_LINK',row:i+1,assetNo:asset.assetNo});usedAssets.set(asset.assetNo,nationalId);}
        if(plateKey){if(usedPlates.has(plateKey)&&usedPlates.get(plateKey)!==nationalId)warnings.push({code:'DUPLICATE_PLATE_LINK',row:i+1,plate:plateRaw});usedPlates.set(plateKey,nationalId);}
      }
    }
  }

  for(const[plateKey,source]of plateSources){if([...assetsByKey.values()].some(asset=>normalizePlate(asset.plateNo)===plateKey))continue;assetsByKey.set(`plate:${plateKey}`,{key:`plate:${plateKey}`,assetNo:null,plateNo:source.plateNo,assetType:'vehicle',assetName:source.assetName||source.plateNo,make:null,model:null,serialNo:null,operationalStatus:'in_service',dieselExpected:true,costCenterCode:null,assignedNationalId:null,metadata:{source:'fuel_plate',fuelType:source.fuelType||null,driverLabel:source.driverLabel||null,notes:source.notes||null,sourceRow:source.sourceRow}});}
  return{employees:[...employeesById.values()],assets:[...assetsByKey.values()],warnings,stats:{employees:employeesById.size,assets:assetsByKey.size,linkedAssets:[...assetsByKey.values()].filter(row=>row.assignedNationalId).length,fuelPlates:plateSources.size}};
}
