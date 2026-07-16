import { requireAdmin } from './auth.js';
import { select } from './supabase.js';

export const ROLE_CAPABILITIES=Object.freeze({
  admin:['*'],
  manager:['dashboard.manager','daily_report.view','costs.view','audit.view'],
  accountant:['daily_report.view','daily_report.import','daily_report.approve','costs.view','costs.calculate'],
  block_sales:['daily_report.view'],
  concrete_sales:['daily_report.view'],
  mechanic:['maintenance.manage'],
  fuel_operator:['fuel.import'],
  hr:['costs.view'],
  procurement:['maintenance.manage'],
  driver:[],employee:[],collector:[],warehouse:[],quality:[],pending:[]
});

export function capabilitiesForRole(role){return [...(ROLE_CAPABILITIES[String(role||'pending')]||[])];}
export function roleAllows(role,capability){const values=capabilitiesForRole(role);return values.includes('*')||values.includes(capability);}

function header(req,name){const value=req?.headers?.[name];return Array.isArray(value)?value[0]:String(value||'').trim();}

export async function requireCapability(req,capability){
  const gateway=requireAdmin(req);
  const appUserId=header(req,'x-app-user-id');
  if(!appUserId)return{...gateway,role:'admin',capabilities:['*'],appUserId:null};
  const users=await select('app_users',`id=eq.${encodeURIComponent(appUserId)}&active=eq.true&select=id,full_name,role,active&limit=1`),user=users?.[0];
  if(!user)throw Object.assign(new Error('المستخدم غير معتمد أو موقوف'),{status:403,code:'USER_NOT_ACTIVE'});
  const [roleRows,userRows]=await Promise.all([
    select('role_capabilities',`role=eq.${encodeURIComponent(user.role)}&allowed=eq.true&select=capability&limit=500`).catch(()=>[]),
    select('user_capabilities',`app_user_id=eq.${encodeURIComponent(user.id)}&select=capability,allowed&limit=500`).catch(()=>[])
  ]);
  const roleCaps=new Set([...(ROLE_CAPABILITIES[user.role]||[]),...(roleRows||[]).map(row=>row.capability)]),overrides=new Map((userRows||[]).map(row=>[row.capability,Boolean(row.allowed)]));
  const explicit=overrides.get(capability),wildcard=overrides.get('*');
  const allowed=explicit!==undefined?explicit:wildcard!==undefined?wildcard:(roleCaps.has('*')||roleCaps.has(capability));
  if(!allowed)throw Object.assign(new Error(`ليست لديك صلاحية ${capability}`),{status:403,code:'CAPABILITY_REQUIRED',capability});
  return{...gateway,appUserId:user.id,fullName:user.full_name,role:user.role,capabilities:[...roleCaps]};
}
