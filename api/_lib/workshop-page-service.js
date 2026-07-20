import { select } from './supabase.js';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const encode=value=>encodeURIComponent(String(value));

export async function listWorkshopAssetsForPage({search='',limit=100}={}){
  const text=clean(search,120).replace(/[,*()]/g,' '),query=['active=eq.true','select=external_id,asset_type,asset_name,plate_no,asset_no,serial_no,make,model,operational_status,cost_center_code','order=asset_name.asc',`limit=${Math.min(Math.max(Number(limit)||100,1),500)}`];
  if(text){const value=encode(`*${text}*`);query.push(`or=(external_id.ilike.${value},asset_name.ilike.${value},plate_no.ilike.${value},asset_no.ilike.${value},serial_no.ilike.${value},make.ilike.${value},model.ilike.${value})`);}
  return await select('unified_assets',query.join('&'))||[];
}

export async function listWorkshopTechniciansForPage({search='',limit=100}={}){
  const text=clean(search,120).replace(/[,*()]/g,' '),query=['active=eq.true','role=in.(mechanic,manager,admin)','select=id,full_name,nickname,role,employee_external_id','order=full_name.asc',`limit=${Math.min(Math.max(Number(limit)||100,1),300)}`];
  if(text){const value=encode(`*${text}*`);query.push(`or=(full_name.ilike.${value},nickname.ilike.${value},employee_external_id.ilike.${value})`);}
  const users=await select('app_users',query.join('&')).catch(()=>[]);
  return(users||[]).map(user=>({
    id:user.employee_external_id||user.id,
    appUserId:user.id,
    fullName:user.full_name,
    nickname:user.nickname||'',
    role:user.role
  }));
}
