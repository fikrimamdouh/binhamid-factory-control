import { requireAdminOrDevice } from './auth.js';
import { select } from './supabase.js';

export const ROLE_CAPABILITIES=Object.freeze({
  admin:['*'],
  manager:['dashboard.manager','daily_report.view','daily_report.approve','imports.read','imports.manage','costs.view','audit.view','governance.view','credit_override.approve','assets.view','maintenance.manage','compliance.view','handover.view','accounting.view','mix_design.view','mix_design.manage','mix_design.calculate','mix_design.approve','mix_material_prices.manage'],
  accountant:['daily_report.view','daily_report.import','daily_report.approve','imports.read','imports.manage','costs.view','costs.calculate','governance.view','financial_period.manage','credit_override.request','custody.manage','custody.approve','accounting.view','accounting.post','mix_design.view','mix_design.manage','mix_design.calculate','mix_design.approve','mix_material_prices.manage'],
  block_sales:['daily_report.view'],
  concrete_sales:['daily_report.view','mix_design.price.view'],
  mechanic:['maintenance.manage','assets.view'],
  fuel_operator:['fuel.import','assets.view'],
  hr:['costs.view','governance.view','compliance.manage','assets.view'],
  procurement:['maintenance.manage','assets.view'],
  quality:['mix_design.view','mix_design.manage'],
  driver:[],employee:[],collector:[],warehouse:[],pending:[]
});

export function capabilitiesForRole(role){return[...(ROLE_CAPABILITIES[String(role||'pending')]||[])];}
export function roleAllows(role,capability){const values=capabilitiesForRole(role);return values.includes('*')||values.includes(capability);}
function capabilitySets(role,roleRows=[],userRows=[]){
  const roleCaps=new Set([...(ROLE_CAPABILITIES[String(role||'pending')]||[]),...(roleRows||[]).filter(row=>row?.allowed!==false).map(row=>String(row?.capability||'')).filter(Boolean)]);
  const overrides=new Map((userRows||[]).map(row=>[String(row?.capability||''),Boolean(row?.allowed)]).filter(([value])=>value));
  return{roleCaps,overrides};
}
function allowsCapability(roleCaps,overrides,capability){
  const explicit=overrides.get(capability),wildcard=overrides.get('*');
  return explicit!==undefined?explicit:wildcard!==undefined?wildcard:(roleCaps.has('*')||roleCaps.has(capability));
}
export function capabilityAllowed(role,capability,roleRows=[],userRows=[]){
  const {roleCaps,overrides}=capabilitySets(role,roleRows,userRows);
  return allowsCapability(roleCaps,overrides,capability);
}
function header(req,name){const value=req?.headers?.[name];return Array.isArray(value)?String(value[0]||'').trim():String(value||'').trim();}
function accessError(message,status,code,extra={}){return Object.assign(new Error(message),{status,code,...extra});}

export function resolveCapabilityGateway(gateway,appUserId,capability){
  const userId=String(appUserId||'').trim();
  if(gateway?.kind==='admin'&&!userId)return{...gateway,role:'admin',capabilities:['*'],appUserId:null,fullName:'مدير النظام'};
  if(!userId){
    if(gateway?.kind==='device'&&gateway.capabilities?.includes(capability))return{...gateway,appUserId:null,fullName:'جهاز المصنع'};
    throw accessError('هوية مستخدم معتمد مطلوبة لتنفيذ هذه العملية',401,'APP_USER_REQUIRED',{capability});
  }
  if(gateway?.kind==='device'&&gateway.appUserId&&gateway.appUserId!==userId)throw accessError('جلسة الدخول لا تطابق المستخدم المطلوب',403,'DEVICE_USER_MISMATCH');
  return null;
}

export async function requireCapability(req,capability){
  if(!String(capability||'').trim())throw accessError('اسم الصلاحية مطلوب',500,'CAPABILITY_NAME_REQUIRED');
  // A transport-only device cookie never authenticates an app user. Passing the
  // requested capability here makes such a cookie fail closed before a caller
  // supplied x-app-user-id can be used for an authorization decision.
  const gateway=requireAdminOrDevice(req,capability),appUserId=header(req,'x-app-user-id'),resolved=resolveCapabilityGateway(gateway,appUserId,capability);
  if(resolved)return resolved;
  const users=await select('app_users',`id=eq.${encodeURIComponent(appUserId)}&active=eq.true&select=id,full_name,role,active&limit=1`),user=users?.[0];
  if(!user)throw accessError('المستخدم غير معتمد أو موقوف',403,'USER_NOT_ACTIVE');
  const [roleRows,userRows]=await Promise.all([
    select('role_capabilities',`role=eq.${encodeURIComponent(user.role)}&allowed=eq.true&select=capability&limit=500`).catch(()=>[]),
    select('user_capabilities',`app_user_id=eq.${encodeURIComponent(user.id)}&select=capability,allowed&limit=500`).catch(()=>[])
  ]);
  const {roleCaps,overrides}=capabilitySets(user.role,roleRows,userRows),allowed=allowsCapability(roleCaps,overrides,capability);
  if(!allowed)throw accessError(`ليست لديك صلاحية ${capability}`,403,'CAPABILITY_REQUIRED',{capability});
  const effective=new Set([...roleCaps].filter(value=>overrides.get(value)!==false));
  for(const [value,isAllowed] of overrides)if(isAllowed)effective.add(value);else effective.delete(value);
  return{...gateway,appUserId:user.id,fullName:user.full_name,role:user.role,capabilities:[...effective]};
}