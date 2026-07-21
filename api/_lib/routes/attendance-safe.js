import { json, method, errorResponse } from '../http.js';
import { select } from '../supabase.js';
import { requireCapability } from '../permissions.js';

const clean=value=>String(value??'').trim();
const safeCode=error=>String(error?.code||'').replace(/[^A-Z0-9_-]/gi,'').slice(0,80)||'QUERY_UNAVAILABLE';
function riyadhDayRange(){
  const day=new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10),start=new Date(`${day}T00:00:00+03:00`),end=new Date(start.getTime()+24*60*60*1000);
  return{start:start.toISOString(),end:end.toISOString()};
}

async function safeSelect(label,table,query,warnings){
  try{return await select(table,query);}
  catch(error){
    warnings.push({source:label,code:safeCode(error)});
    console.warn(`[attendance-safe] ${label}`,error?.message||error);
    return [];
  }
}

export async function attendanceSafe(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'attendance.view');
    const warnings=[],scope=clean(req.query?.scope);
    if(scope==='employee-sites'){
      const [sites,assignments]=await Promise.all([
        safeSelect('work_sites','work_sites','active=eq.true&select=id,code,name,address,latitude,longitude,radius_m,active&order=name.asc&limit=50',warnings),
        safeSelect('employee_assignments','employee_assignments','active=eq.true&select=app_user_id,employee_external_id,site_id,active,updated_at,work_sites(id,code,name,address,latitude,longitude,radius_m,active)&order=updated_at.desc&limit=3000',warnings)
      ]);
      return json(res,200,{ok:true,degraded:warnings.length>0,warnings,sites:sites||[],assignments:assignments||[],employees:[]});
    }
    const range=riyadhDayRange();
    const [sites,assignments,users,vehicles,employees,attendance,driverEvents,stateRows]=await Promise.all([
      safeSelect('work_sites','work_sites','select=*&order=name.asc&limit=500',warnings),
      safeSelect('employee_assignments','employee_assignments','select=*,work_sites(id,code,name,address,latitude,longitude,radius_m),app_users(id,full_name,role,active)&order=updated_at.desc&limit=1000',warnings),
      safeSelect('telegram_users','user_channels','select=external_id,external_username,active,user_id,app_users(id,full_name,role,active,employee_external_id)&channel=eq.telegram&order=last_seen_at.desc&limit=1000',warnings),
      safeSelect('vehicles','vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status&order=plate_no.asc&limit=2000',warnings),
      safeSelect('employees','employees','active=eq.true&select=external_id,employee_no,full_name,phone,role&order=full_name.asc&limit=3000',warnings),
      safeSelect('attendance_events','attendance_events',`occurred_at=gte.${encodeURIComponent(range.start)}&occurred_at=lt.${encodeURIComponent(range.end)}&select=id,reference_no,event_type,occurred_at,within_geofence,distance_from_site_m,latitude,longitude,app_users(full_name,role),work_sites(name)&order=occurred_at.desc&limit=1000`,warnings),
      safeSelect('driver_events','driver_events',`occurred_at=gte.${encodeURIComponent(range.start)}&occurred_at=lt.${encodeURIComponent(range.end)}&select=id,reference_no,event_type,occurred_at,vehicle_external_id,latitude,longitude,odometer,fuel_liters,fuel_amount,app_users(full_name)&order=occurred_at.desc&limit=1000`,warnings),
      safeSelect('app_state_employees','app_state','key=eq.primary&select=payload&limit=1',warnings)
    ]);
    const normalizedUsers=(users||[]).map(row=>({
      external_id:row.external_id,
      external_username:row.external_username,
      user_id:row.user_id,
      channel_active:row.active,
      id:row.app_users?.id||row.user_id,
      full_name:row.app_users?.full_name||'',
      role:row.app_users?.role||'pending',
      active:Boolean(row.app_users?.active&&row.active),
      employee_external_id:row.app_users?.employee_external_id||''
    }));
    const storedEmployees=stateRows?.[0]?.payload?.legacy?.emp;
    const stored=Array.isArray(storedEmployees)?storedEmployees:[];
    const storedById=new Map(stored.map(row=>[clean(row?.id||row?.external_id),row]));
    const normalizedEmployees=(employees||[]).map(row=>{
      const source=storedById.get(clean(row.external_id));
      return{...row,attendance_site_id:clean(source?.attendanceSiteId||source?.workSiteId||source?.siteId)||null};
    });
    return json(res,200,{
      ok:true,
      degraded:warnings.length>0,
      warnings,
      sites:sites||[],
      assignments:assignments||[],
      users:normalizedUsers,
      vehicles:vehicles||[],
      employees:normalizedEmployees,
      attendance:attendance||[],
      driverEvents:driverEvents||[],
      dayRange:range
    });
  }catch(error){errorResponse(res,error);}
}
