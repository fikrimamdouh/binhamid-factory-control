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
  catch(error){warnings.push({source:label,code:safeCode(error),message:String(error?.message||'').slice(0,180)});console.warn(`[attendance-safe] ${label}`,error?.message||error);return[];}
}
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const mapBy=(rows,key)=>new Map((rows||[]).map(row=>[clean(row?.[key]),row]).filter(([value])=>value));
const deletedRows=rows=>(rows||[]).filter(row=>row.active===false&&object(row.metadata).permanentlyDeleted===true).map(row=>({external_id:row.external_id,national_id:row.national_id||null,employee_no:row.employee_no||null,full_name:row.full_name||null,deleted_at:object(row.metadata).permanentlyDeletedAt||null}));
const activeRows=rows=>(rows||[]).filter(row=>row.active!==false&&object(row.metadata).permanentlyDeleted!==true);

export async function attendanceSafe(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'attendance.view');
    const warnings=[],scope=clean(req.query?.scope);
    if(scope==='employee-sites'){
      const [sites,assignments,employeeRows,appUsers,channels]=await Promise.all([
        safeSelect('work_sites','work_sites','active=eq.true&select=id,code,name,address,latitude,longitude,radius_m,active&order=name.asc&limit=50',warnings),
        safeSelect('employee_assignments','employee_assignments','active=eq.true&select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active,updated_at&order=updated_at.desc&limit=3000',warnings),
        safeSelect('employees','employees','select=external_id,employee_no,national_id,full_name,phone,role,active,metadata&order=full_name.asc&limit=5000',warnings),
        safeSelect('app_users','app_users','active=eq.true&select=id,full_name,role,active,employee_external_id&limit=5000',warnings),
        safeSelect('telegram_users','user_channels','channel=eq.telegram&select=external_id,external_username,active,user_id,last_seen_at&order=last_seen_at.desc&limit=5000',warnings)
      ]);
      const sitesById=mapBy(sites,'id'),channelByUser=mapBy(channels,'user_id'),employees=activeRows(employeeRows),deletedEmployees=deletedRows(employeeRows),enrichedAssignments=(assignments||[]).map(row=>({...row,work_sites:sitesById.get(clean(row.site_id))||null})),normalizedEmployees=employees.map(row=>({...row,work_status:clean(object(row.metadata).manualWorkStatus||object(row.metadata).workStatus||'working')})),users=(appUsers||[]).map(user=>{const channel=channelByUser.get(clean(user.id))||{};return{id:user.id,full_name:user.full_name||'',role:user.role||'employee',active:user.active!==false,employee_external_id:user.employee_external_id||'',telegram_external_id:channel.external_id||'',telegram_username:channel.external_username||''};});
      return json(res,200,{ok:true,degraded:warnings.length>0,warnings,sites:sites||[],assignments:enrichedAssignments,employees:normalizedEmployees,users,deletedEmployees});
    }

    const range=riyadhDayRange();
    const [sites,assignments,channels,appUsers,vehicles,employeeRows,attendance,driverEvents,stateRows]=await Promise.all([
      safeSelect('work_sites','work_sites','select=*&order=name.asc&limit=500',warnings),
      safeSelect('employee_assignments','employee_assignments','select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active,updated_at&order=updated_at.desc&limit=1000',warnings),
      safeSelect('telegram_users','user_channels','channel=eq.telegram&select=external_id,external_username,active,user_id,last_seen_at&order=last_seen_at.desc&limit=1000',warnings),
      safeSelect('app_users','app_users','select=id,full_name,role,active,employee_external_id&limit=2000',warnings),
      safeSelect('vehicles','vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status&order=plate_no.asc&limit=2000',warnings),
      safeSelect('employees','employees','select=external_id,employee_no,national_id,full_name,phone,role,active,metadata&order=full_name.asc&limit=5000',warnings),
      safeSelect('attendance_events','attendance_events',`occurred_at=gte.${encodeURIComponent(range.start)}&occurred_at=lt.${encodeURIComponent(range.end)}&select=id,reference_no,app_user_id,site_id,employee_external_id,event_type,occurred_at,within_geofence,distance_from_site_m,horizontal_accuracy_m,latitude,longitude,note&order=occurred_at.desc&limit=1000`,warnings),
      safeSelect('driver_events','driver_events',`occurred_at=gte.${encodeURIComponent(range.start)}&occurred_at=lt.${encodeURIComponent(range.end)}&select=id,reference_no,app_user_id,event_type,occurred_at,vehicle_external_id,latitude,longitude,odometer,fuel_liters,fuel_amount&order=occurred_at.desc&limit=1000`,warnings),
      safeSelect('app_state_employees','app_state','key=eq.primary&select=payload&limit=1',warnings)
    ]);

    const sitesById=mapBy(sites,'id'),usersById=mapBy(appUsers,'id'),employees=activeRows(employeeRows),deletedEmployees=deletedRows(employeeRows),enrichedAssignments=(assignments||[]).map(row=>({...row,work_sites:sitesById.get(clean(row.site_id))||null,app_users:usersById.get(clean(row.app_user_id))||null})),normalizedUsers=(channels||[]).map(row=>{const user=usersById.get(clean(row.user_id))||{};return{external_id:row.external_id,external_username:row.external_username,user_id:row.user_id,channel_active:row.active,id:user.id||row.user_id,full_name:user.full_name||'',role:user.role||'pending',active:Boolean(user.active&&row.active),employee_external_id:user.employee_external_id||''};}),storedEmployees=stateRows?.[0]?.payload?.legacy?.emp,stored=Array.isArray(storedEmployees)?storedEmployees:[],storedById=new Map(stored.map(row=>[clean(row?.id||row?.external_id),row])),normalizedEmployees=employees.map(row=>{const source=storedById.get(clean(row.external_id)),metadata=object(row.metadata);return{...row,attendance_site_id:clean(source?.attendanceSiteId||source?.workSiteId||source?.siteId)||null,work_status:clean(metadata.manualWorkStatus||metadata.workStatus||'working')};}),enrichedAttendance=(attendance||[]).map(row=>({...row,app_users:usersById.get(clean(row.app_user_id))||null,work_sites:sitesById.get(clean(row.site_id))||null})),enrichedDriverEvents=(driverEvents||[]).map(row=>({...row,app_users:usersById.get(clean(row.app_user_id))||null}));

    return json(res,200,{ok:true,degraded:warnings.length>0,warnings,sites:sites||[],assignments:enrichedAssignments,users:normalizedUsers,vehicles:vehicles||[],employees:normalizedEmployees,deletedEmployees,attendance:enrichedAttendance,driverEvents:enrichedDriverEvents,dayRange:range});
  }catch(error){errorResponse(res,error);}
}
