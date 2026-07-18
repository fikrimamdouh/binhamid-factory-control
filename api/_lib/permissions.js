import { requireAdminOrDevice } from './auth.js';
import { select } from './supabase.js';

export const ROLE_CAPABILITIES=Object.freeze({
  admin:['*'],
  manager:['dashboard.manager','daily_report.view','costs.view','audit.view','governance.view','credit_override.approve','assets.view','compliance.view','handover.view'],
  accountant:['daily_report.view','daily_report.import','daily_report.approve','costs.view','costs.calculate','governance.view','financial_period.manage','credit_override.request','custody.manage','custody.approve'],
  block_sales:['daily_report.view'],
  concrete_sales:['daily_report.view'],
  mechanic:['maintenance.manage','assets.view'],
  fuel_operator:['fuel.import','assets.view'],
  hr:['costs.view','governance.view','compliance.manage','assets.view'],
  procurement:['maintenance.manage','assets.view'],
  driver:[],employee:[],collector:[],warehouse:[],quality:[],pending:[]
});

export function capabilitiesForRole(role){return[...(ROLE_CAPABILITIES[String(role||'pending')]||[])];}
export function roleAllows(role,capability){const values=capabilitiesForRole(role);return values.includes('*')||values.includes(capability);}
function header(req,name){const value=req?.headers?.[name];return Array.isArray(value)?String(value[0]||'').trim():String(value||'').trim();}
function accessError(message,status,code,extra={}){return Object.assign(new Error(message),{status,code,...extra});}

// Resolve only identities that do not require a database user lookup.
// A device may act alone solely for its explicitly signed technical capabilities.
export function resolveCapabilityGateway(gateway,appUserId,capability){
  const userId=String(appUserId||'').trim();
  if(gateway?.kind==='admin'&&!userId)return{...gateway,role:'admin',capabilities:['*'],appUserId:null,fullName:'مدير النظام'};
  if(!userId){
    if(gateway?.kind==='device'&&gateway.capabilities?.includes(capability))return{...gateway,appUserId:null,fullName:'جهاز المصنع'};
    throw accessError('هوية مستخدم معتمد مطلوبة لتنفيذ هذه العملية',401,'APP_USER_REQUIRED',{capability});
  }
  return null;
}

export async function requireCapability(req,capability){
  if(!String(capability||'').trim())throw accessError('اسم الصلاحية مطلوب',500,'CAPABILITY_NAME_REQUIRED');
  // Authenticate the transport first. Business capability enforcement happens against app_users below.
  const gateway=requireAdminOrDevice(req),appUserId=header(req,'x-app-user-id'),resolved=resolveCapabilityGateway(gateway,appUserId,capability);
  if(resolved)return resolved;
  const users=await select('app_users',`id=eq.${encodeURIComponent(appUserId)}&active=eq.true&select=id,full_name,role,active&limit=1`),user=users?.[0];
  if(!user)throw accessError('المستخدم غير معتمد أو موقوف',403,'USER_NOT_ACTIVE');
  const [roleRows,userRows]=await Promise.all([
    select('role_capabilities',`role=eq.${encodeURIComponent(user.role)}&allowed=eq.true&select=capability&limit=500`).catch(()=>[]),
    select('user_capabilities',`app_user_id=eq.${encodeURIComponent(user.id)}&select=capability,allowed&limit=500`).catch(()=>[])
  ]);
  const roleCaps=new Set([...(ROLE_CAPABILITIES[user.role]||[]),...(roleRows||[]).map(row=>row.capability).filter(Boolean)]),overrides=new Map((userRows||[]).map(row=>[String(row.capability||''),Boolean(row.allowed)]));
  const explicit=overrides.get(capability),wildcard=overrides.get('*'),allowed=explicit!==undefined?explicit:wildcard!==undefined?wildcard:(roleCaps.has('*')||roleCaps.has(capability));
  if(!allowed)throw accessError(`ليست لديك صلاحية ${capability}`,403,'CAPABILITY_REQUIRED',{capability});
  const effective=new Set([...roleCaps].filter(value=>overrides.get(value)!==false));
  for(const [value,isAllowed] of overrides)if(isAllowed)effective.add(value);else effective.delete(value);
  return{...gateway,appUserId:user.id,fullName:user.full_name,role:user.role,capabilities:[...effective]};
}
