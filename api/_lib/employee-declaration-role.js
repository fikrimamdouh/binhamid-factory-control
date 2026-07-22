import { patch, select } from './supabase.js';

const clean=(value,max=500)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const now=()=>new Date().toISOString();

export const DECLARATION_ROLES=new Set([
  'employee','driver','accountant','mechanic','block_sales','concrete_sales',
  'collector','warehouse','fuel_operator','hr','procurement','quality','manager'
]);

function norm(value){
  return clean(value,300).toLowerCase()
    .replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
    .replace(/[ًٌٍَُِّْـ]/g,'').replace(/[^a-z0-9\u0600-\u06ff]+/g,' ')
    .replace(/\s+/g,' ').trim();
}

export function roleFromJobTitle(value=''){
  const text=norm(value);if(!text)return'';
  if(/(?:مبيعات.*بلوك|بلوك.*مبيعات|block.*sales|sales.*block)/.test(text))return'block_sales';
  if(/(?:مبيعات.*خرسان|خرسان.*مبيعات|concrete.*sales|sales.*concrete)/.test(text))return'concrete_sales';
  if(/(?:سائق|driver)/.test(text))return'driver';
  if(/(?:محاسب|حسابات|accountant|accounting)/.test(text))return'accountant';
  if(/(?:ميكاني|ورشه|ورشة|صيانه|صيانة|mechanic|workshop|maintenance)/.test(text))return'mechanic';
  if(/(?:محصل|تحصيل|collector|collection)/.test(text))return'collector';
  if(/(?:مخزن|مستودع|امين مستودع|أمين مستودع|warehouse|storekeeper)/.test(text))return'warehouse';
  if(/(?:ديزل|وقود|fuel)/.test(text))return'fuel_operator';
  if(/(?:موارد بشري|شؤون موظفين|human resources|\bhr\b)/.test(text))return'hr';
  if(/(?:مشتريات|procurement|purchasing)/.test(text))return'procurement';
  if(/(?:جوده|جودة|رقابه|رقابة|quality|control)/.test(text))return'quality';
  if(/(?:مدير|manager)/.test(text))return'manager';
  return'';
}

export function resolveEmployeeDeclarationRole({jobTitle='',telegramRole='',employeeRole=''}={}){
  const fromJob=roleFromJobTitle(jobTitle);if(fromJob)return{role:fromJob,source:'job_title'};
  const telegram=clean(telegramRole,80);if(DECLARATION_ROLES.has(telegram)&&telegram!=='employee')return{role:telegram,source:'telegram_role'};
  const current=DECLARATION_ROLES.has(clean(employeeRole,80))?clean(employeeRole,80):roleFromJobTitle(employeeRole);
  if(current)return{role:current,source:'employee_role'};
  if(telegram==='employee')return{role:'employee',source:'telegram_role'};
  return{role:'employee',source:'default'};
}

async function applyRole(employee,options={}){
  if(!employee||employee.active===false)throw Object.assign(new Error('سجل الموظف غير موجود أو موقوف.'),{status:404,code:'DECLARATION_EMPLOYEE_NOT_FOUND'});
  const resolved=resolveEmployeeDeclarationRole({jobTitle:options.jobTitle,telegramRole:options.telegramRole,employeeRole:employee.role}),metadata=object(employee.metadata),stamp=now(),nextMetadata={...metadata,declarationRole:resolved.role,declarationRoleSource:options.source||resolved.source,declarationRoleUpdatedAt:stamp};
  if(clean(options.jobTitle,240))nextMetadata.assignmentJobTitle=clean(options.jobTitle,240);
  const changed=clean(employee.role,80)!==resolved.role||metadata.declarationRole!==resolved.role||metadata.declarationRoleSource!==(options.source||resolved.source);
  if(changed)await patch('employees',`external_id=eq.${encodeURIComponent(employee.external_id)}`,{role:resolved.role,metadata:nextMetadata,updated_at:stamp});
  return{employeeExternalId:employee.external_id,employeeName:employee.full_name||null,previousRole:employee.role||null,role:resolved.role,source:options.source||resolved.source,changed};
}

export async function syncEmployeeDeclarationRole(employeeExternalId,options={}){
  const id=clean(employeeExternalId,200);if(!id)throw Object.assign(new Error('معرف الموظف مطلوب لتحديث نموذج الخطاب.'),{status:400,code:'DECLARATION_EMPLOYEE_REQUIRED'});
  const employee=(await select('employees',`external_id=eq.${encodeURIComponent(id)}&active=eq.true&select=external_id,full_name,role,active,metadata&limit=1`))?.[0];
  return applyRole(employee,options);
}

export async function reconcileLinkedEmployeeDeclarationRoles(){
  const[assignments,users,employees]=await Promise.all([
    select('employee_assignments','active=eq.true&select=app_user_id,employee_external_id,job_title,active,updated_at&order=updated_at.desc&limit=5000').catch(()=>[]),
    select('app_users','active=eq.true&select=id,role,active,employee_external_id&limit=5000').catch(()=>[]),
    select('employees','active=eq.true&select=external_id,full_name,role,active,metadata&limit=5000').catch(()=>[])
  ]);
  const usersById=new Map((users||[]).map(row=>[clean(row.id,200),row])),employeesById=new Map((employees||[]).map(row=>[clean(row.external_id,200),row])),targets=new Map();
  for(const assignment of assignments||[]){const user=usersById.get(clean(assignment.app_user_id,200)),employeeId=clean(assignment.employee_external_id||user?.employee_external_id,200);if(!employeeId)continue;if(!targets.has(employeeId))targets.set(employeeId,{employeeId,jobTitle:assignment.job_title||'',telegramRole:user?.role||'',source:'linked_assignment'});}
  for(const user of users||[]){const employeeId=clean(user.employee_external_id,200);if(employeeId&&!targets.has(employeeId))targets.set(employeeId,{employeeId,jobTitle:'',telegramRole:user.role||'',source:'linked_telegram_user'});}
  let changed=0,unchanged=0,missing=0;const results=[];
  for(const target of targets.values()){
    const employee=employeesById.get(target.employeeId);if(!employee){missing++;continue;}
    const result=await applyRole(employee,target);results.push(result);if(result.changed)changed++;else unchanged++;
  }
  return{linked:targets.size,changed,unchanged,missing,results:results.slice(0,200)};
}
