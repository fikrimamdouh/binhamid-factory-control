import { requireAdmin } from '../_lib/auth.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { select, insert, upsert, patch } from '../_lib/supabase.js';

const clean=value=>String(value??'').trim();
const num=(value,fallback=null)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;};

export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    requireAdmin(req);
    if(req.method==='GET'){
      const today=new Date().toISOString().slice(0,10);
      const [sites,assignments,users,vehicles,employees,attendance,driverEvents]=await Promise.all([
        select('work_sites','select=*&order=name.asc&limit=500'),
        select('employee_assignments','select=*,work_sites(id,code,name,address,latitude,longitude,radius_m),app_users(id,full_name,role,active)&order=updated_at.desc&limit=1000'),
        select('user_channels','select=external_id,external_username,active,user_id,app_users(id,full_name,role,active,employee_external_id)&channel=eq.telegram&order=last_seen_at.desc&limit=1000'),
        select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status&order=plate_no.asc&limit=2000'),
        select('employees','active=eq.true&select=external_id,employee_no,full_name,phone,role&order=full_name.asc&limit=3000'),
        select('attendance_events',`occurred_at=gte.${today}T00:00:00Z&select=id,reference_no,event_type,occurred_at,within_geofence,distance_from_site_m,latitude,longitude,app_users(full_name,role),work_sites(name)&order=occurred_at.desc&limit=1000`),
        select('driver_events',`occurred_at=gte.${today}T00:00:00Z&select=id,reference_no,event_type,occurred_at,vehicle_external_id,latitude,longitude,odometer,fuel_liters,fuel_amount,app_users(full_name)&order=occurred_at.desc&limit=1000`)
      ]);
      const normalizedUsers=(users||[]).map(row=>({external_id:row.external_id,external_username:row.external_username,user_id:row.user_id,channel_active:row.active,id:row.app_users?.id||row.user_id,full_name:row.app_users?.full_name||'',role:row.app_users?.role||'pending',active:Boolean(row.app_users?.active&&row.active),employee_external_id:row.app_users?.employee_external_id||''}));
      return json(res,200,{ok:true,sites:sites||[],assignments:assignments||[],users:normalizedUsers,vehicles:vehicles||[],employees:employees||[],attendance:attendance||[],driverEvents:driverEvents||[]});
    }
    const input=await body(req),action=clean(input.action);
    if(action==='save_site'){
      const name=clean(input.name),code=clean(input.code)||`SITE-${Date.now()}`;
      if(!name)throw Object.assign(new Error('اسم موقع العمل مطلوب'),{status:400});
      const values={code,name,address:clean(input.address)||null,latitude:num(input.latitude),longitude:num(input.longitude),radius_m:Math.max(25,Math.min(10000,Math.round(num(input.radiusM,250)))),active:input.active!==false,updated_at:new Date().toISOString()};
      let result;
      if(clean(input.id))result=await patch('work_sites',`id=eq.${encodeURIComponent(clean(input.id))}`,values);
      else result=await upsert('work_sites',[values],'code');
      return json(res,200,{ok:true,site:result?.[0]||values});
    }
    if(action==='assign_user'){
      const appUserId=clean(input.appUserId);
      if(!appUserId)throw Object.assign(new Error('المستخدم مطلوب'),{status:400});
      const values={app_user_id:appUserId,employee_external_id:clean(input.employeeExternalId)||null,site_id:clean(input.siteId)||null,vehicle_external_id:clean(input.vehicleExternalId)||null,job_title:clean(input.jobTitle)||null,shift_name:clean(input.shiftName)||null,active:input.active!==false,updated_at:new Date().toISOString()};
      const result=await upsert('employee_assignments',[values],'app_user_id');
      await patch('app_users',`id=eq.${encodeURIComponent(appUserId)}`,{employee_external_id:values.employee_external_id,updated_at:new Date().toISOString()});
      return json(res,200,{ok:true,assignment:result?.[0]||values});
    }
    if(action==='toggle_site'){
      const id=clean(input.id);if(!id)throw Object.assign(new Error('معرف الموقع مطلوب'),{status:400});
      const result=await patch('work_sites',`id=eq.${encodeURIComponent(id)}`,{active:Boolean(input.active),updated_at:new Date().toISOString()});
      return json(res,200,{ok:true,site:result?.[0]||null});
    }
    throw Object.assign(new Error('الإجراء غير معروف'),{status:400});
  }catch(error){errorResponse(res,error);}
}
