import { body, errorResponse, json, method } from '../http.js';
import { validateTelegramWebApp } from '../telegram-webapp.js';
import { insert, patch, select, upsert } from '../supabase.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const MANAGERS=new Set(['admin','manager','accountant']);
const ASSIGNERS=new Set(['admin','manager']);
function numeric(value,min=0,max=1_000_000_000){const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Object.assign(new Error('قيمة رقمية غير صحيحة'),{status:422});return n;}
async function identityFor(initData){
  const verified=validateTelegramWebApp(initData),rows=await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(String(verified.user.id))}&active=eq.true&select=user_id,app_users(id,full_name,role,active)&limit=1`),user=rows?.[0]?.app_users;
  if(!user?.active)throw Object.assign(new Error('حساب Telegram غير معتمد'),{status:403});
  return{verified,user};
}
function canManage(identity){return MANAGERS.has(identity.user.role);}
async function audit(identity,action,type,id,details={}){return insert('audit_log',[{actor_type:'telegram_webapp',actor_id:String(identity.verified.user.id),action,entity_type:type,entity_id:String(id||''),details:{app_user_id:identity.user.id,...details}}],{prefer:'return=minimal'}).catch(()=>{});}
async function profile(identity){return{user:{name:identity.user.full_name,role:identity.user.role},canManage:canManage(identity),canAssign:ASSIGNERS.has(identity.user.role)};}
async function customers(identity){
  if(!canManage(identity))throw Object.assign(new Error('هذه الشاشة للإدارة والمحاسب فقط'),{status:403});
  return select('customers','select=id,external_id,customer_code,customer_name,phone,credit_limit,payment_days,active&order=customer_name.asc&limit=300');
}
async function saveCustomer(identity,input){
  if(!canManage(identity))throw Object.assign(new Error('لا تملك صلاحية تعديل العملاء'),{status:403});
  const id=clean(input.id,100),customerName=clean(input.customerName,500),customerCode=clean(input.customerCode,120),phone=clean(input.phone,80);
  if(!id||!customerName||!customerCode)throw Object.assign(new Error('الاسم وكود العميل مطلوبان'),{status:400});
  const rows=await patch('customers',`id=eq.${encodeURIComponent(id)}`,{customer_name:customerName,customer_code:customerCode,phone:phone||null,credit_limit:numeric(input.creditLimit||0),payment_days:Math.round(numeric(input.paymentDays||0,0,3650)),active:input.active!==false,updated_at:new Date().toISOString()});
  await audit(identity,'telegram_mini_customer_updated','customer',id,{customer_code:customerCode});return rows?.[0]||null;
}
async function failedImports(identity){
  if(!canManage(identity))throw Object.assign(new Error('هذه الشاشة للإدارة والمحاسب فقط'),{status:403});
  return select('imports','status=in.(validation_failed,failed,ready_for_review)&select=id,created_at,original_name,report_type,status,error_count,warning_count,summary,submitted_by,source_chat_id&order=created_at.desc&limit=100');
}
async function assignmentData(identity){
  if(!ASSIGNERS.has(identity.user.role))throw Object.assign(new Error('إسناد السائقين للإدارة فقط'),{status:403});
  const [users,vehicles,assignments]=await Promise.all([select('app_users','active=eq.true&role=in.(driver,mechanic,fuel_operator)&select=id,full_name,role,employee_external_id&order=full_name.asc&limit=300'),select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,make,model,status&order=plate_no.asc&limit=300'),select('employee_assignments','select=id,app_user_id,employee_external_id,vehicle_external_id,job_title,shift_name,active&limit=300')]);
  return{users:users||[],vehicles:vehicles||[],assignments:assignments||[]};
}
async function saveAssignment(identity,input){
  if(!ASSIGNERS.has(identity.user.role))throw Object.assign(new Error('لا تملك صلاحية إسناد المركبات'),{status:403});
  const appUserId=clean(input.appUserId,100),vehicleExternalId=clean(input.vehicleExternalId,120);if(!appUserId)throw Object.assign(new Error('اختر السائق'),{status:400});
  const rows=await upsert('employee_assignments',[{app_user_id:appUserId,vehicle_external_id:vehicleExternalId||null,job_title:clean(input.jobTitle,200)||null,shift_name:clean(input.shiftName,120)||null,active:true,assigned_by:identity.user.id,assigned_at:new Date().toISOString(),updated_at:new Date().toISOString()}],'app_user_id');
  await audit(identity,'telegram_mini_driver_assignment','employee_assignment',appUserId,{vehicle_external_id:vehicleExternalId||null});return rows?.[0]||null;
}
export async function telegramMiniApp(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const input=await body(req),identity=await identityFor(input.initData),action=clean(input.action,40);
    if(action==='profile')return json(res,200,{ok:true,...await profile(identity)});
    if(action==='customers')return json(res,200,{ok:true,customers:await customers(identity)});
    if(action==='save_customer')return json(res,200,{ok:true,customer:await saveCustomer(identity,input)});
    if(action==='failed_imports')return json(res,200,{ok:true,imports:await failedImports(identity)});
    if(action==='assignment_data')return json(res,200,{ok:true,...await assignmentData(identity)});
    if(action==='save_assignment')return json(res,200,{ok:true,assignment:await saveAssignment(identity,input)});
    throw Object.assign(new Error('إجراء Mini App غير معروف'),{status:400});
  }catch(error){errorResponse(res,error);}
}
