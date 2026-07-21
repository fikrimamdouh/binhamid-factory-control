import { select } from './supabase.js';

const APP_ROLES=new Set(['employee','driver','mechanic','accountant','block_sales','concrete_sales','collector','warehouse','fuel_operator','hr','procurement','quality','manager','admin']);
const digits=value=>String(value??'').replace(/[^0-9]/g,'').slice(0,15);
const norm=value=>String(value??'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/g,' ').replace(/\s+/g,' ').trim();

export const normalizeNationalId=value=>digits(value);
export const maskNationalId=value=>{const id=digits(value);return id.length<5?'***':`${'*'.repeat(Math.max(3,id.length-4))}${id.slice(-4)}`;};

export function employeeRoleToAppRole(value){
  const raw=String(value??'').trim();
  if(APP_ROLES.has(raw))return raw;
  const text=norm(raw);
  if(!text)return'';
  if(/مدير النظام|system admin|administrator/.test(text))return'admin';
  if(/مدير المصنع|factory manager|plant manager/.test(text))return'manager';
  if(/موارد بشري|human resources|\bhr\b/.test(text))return'hr';
  if(/محاسب|حسابات|accountant|accounting/.test(text))return'accountant';
  if(/مبيعات.*بلوك|بلوك.*مبيعات|block sales/.test(text))return'block_sales';
  if(/مبيعات.*خرسان|خرسان.*مبيعات|concrete sales/.test(text))return'concrete_sales';
  if(/محصل|تحصيل|collector/.test(text))return'collector';
  if(/امين مخزن|أمين مخزن|مخزن|warehouse|storekeeper/.test(text))return'warehouse';
  if(/ديزل|وقود|اسطول|أسطول|fuel|fleet/.test(text))return'fuel_operator';
  if(/ميكانيك|ورشه|ورشة|mechanic|workshop/.test(text))return'mechanic';
  if(/مشتريات|procurement|purchasing/.test(text))return'procurement';
  if(/جوده|جودة|رقابه|رقابة|quality/.test(text))return'quality';
  if(/سائق|driver/.test(text))return'driver';
  if(/عامل|موظف|employee|worker/.test(text))return'employee';
  return'';
}

const assetLabel=row=>[
  row.asset_name||row.vehicle_type||row.asset_type,
  row.asset_no?`أصل ${row.asset_no}`:'',
  row.plate_no?`لوحة ${row.plate_no}`:'',
  row.make,row.model
].filter(Boolean).join(' — ');

export function employeeAssetsSummary(assets=[]){
  if(!assets.length)return'لا توجد معدة أو مركبة مسندة في السجل.';
  return assets.slice(0,8).map((row,index)=>`${index+1}. ${assetLabel(row)}`).join('\n');
}

export async function resolveEmployeeIdentity(nationalId){
  const normalized=digits(nationalId);
  if(normalized.length<8||normalized.length>15)return{ok:false,code:'NATIONAL_ID_INVALID',nationalId:normalized};
  const employees=await select('employees',`national_id=eq.${encodeURIComponent(normalized)}&active=eq.true&select=external_id,employee_no,national_id,full_name,nickname,role,phone,active&limit=3`).catch(()=>[]);
  if(!employees.length)return{ok:false,code:'EMPLOYEE_NOT_FOUND',nationalId:normalized};
  if(employees.length!==1)return{ok:false,code:'EMPLOYEE_ID_AMBIGUOUS',nationalId:normalized};
  const employee=employees[0],role=employeeRoleToAppRole(employee.role);
  if(!role)return{ok:false,code:'EMPLOYEE_ROLE_MISSING',nationalId:normalized,employee};
  let assets=await select('unified_assets',`assigned_employee_external_id=eq.${encodeURIComponent(employee.external_id)}&active=eq.true&select=external_id,asset_type,asset_name,plate_no,asset_no,make,model,operational_status,diesel_expected,cost_center_code&order=asset_type.asc,asset_no.asc.nullslast,plate_no.asc.nullslast&limit=50`).catch(()=>[]);
  if(!assets.length){
    const vehicles=await select('vehicles',`driver_external_id=eq.${encodeURIComponent(employee.external_id)}&active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,status&order=plate_no.asc.nullslast&limit=50`).catch(()=>[]);
    assets=(vehicles||[]).map(row=>({...row,asset_type:'vehicle',asset_name:row.vehicle_type,operational_status:row.status,diesel_expected:true}));
  }
  if(role==='driver'&&!assets.length)return{ok:false,code:'DRIVER_ASSET_MISSING',nationalId:normalized,employee,role,assets};
  return{ok:true,code:'MATCHED',nationalId:normalized,employee,role,assets};
}
