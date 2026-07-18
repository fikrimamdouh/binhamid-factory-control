import { errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { select } from '../supabase.js';

const clean=value=>String(value||'').trim();
const safeSelect=(table,query)=>select(table,query).catch(()=>[]);
const riyadhDay=()=>{const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),get=type=>parts.find(part=>part.type===type)?.value||'';return `${get('year')}-${get('month')}-${get('day')}`;};
const latestBy=(rows,key)=>{const output=new Map();for(const row of rows||[]){const id=clean(row?.[key]);if(!id)continue;const old=output.get(id);if(!old||String(row.occurred_at||'')>String(old.occurred_at||''))output.set(id,row);}return output;};
const present=event=>['check_in','shift_start','trip_start'].includes(String(event?.event_type||''));
const label=vehicle=>clean(vehicle.plate_no||vehicle.asset_no||vehicle.external_id)||'مركبة بلا لوحة';

export async function fleetStatus(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'assets.view');
    const since=`${riyadhDay()}T00:00:00+03:00`;
    const [vehicles,users,assignments,events,maintenance]=await Promise.all([
      safeSelect('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,driver_external_id,status&order=plate_no.asc&limit=1000'),
      safeSelect('app_users','active=eq.true&select=id,full_name,role,employee_external_id&limit=2000'),
      safeSelect('employee_assignments','active=eq.true&select=app_user_id,vehicle_external_id,created_at&order=created_at.desc&limit=2000'),
      safeSelect('attendance_events',`occurred_at=gte.${encodeURIComponent(since)}&select=app_user_id,event_type,occurred_at&order=occurred_at.desc&limit=10000`),
      safeSelect('maintenance_orders','vehicle_stopped=eq.true&status=not.in.(closed,cancelled,completed)&select=vehicle_external_id,plate_snapshot,status&limit=1000')
    ]);
    const userById=new Map(users.map(user=>[String(user.id),user]));
    const userByEmployee=new Map(users.filter(user=>clean(user.employee_external_id)).map(user=>[clean(user.employee_external_id),user]));
    const assignmentByVehicle=new Map();
    for(const assignment of assignments)if(clean(assignment.vehicle_external_id)&&!assignmentByVehicle.has(clean(assignment.vehicle_external_id)))assignmentByVehicle.set(clean(assignment.vehicle_external_id),userById.get(String(assignment.app_user_id))||null);
    const attendance=latestBy(events,'app_user_id'),stopped=new Set(maintenance.flatMap(row=>[clean(row.vehicle_external_id),clean(row.plate_snapshot)]).filter(Boolean));
    const rows=vehicles.map(vehicle=>{
      const vehicleId=clean(vehicle.external_id),driver=assignmentByVehicle.get(vehicleId)||userByEmployee.get(clean(vehicle.driver_external_id))||null,event=driver?attendance.get(String(driver.id)):null,maintenanceStopped=stopped.has(vehicleId)||stopped.has(label(vehicle));
      const status=maintenanceStopped?'maintenance':!driver?'unassigned':present(event)?'working':'not_working';
      return{vehicleId,vehicle:label(vehicle),vehicleType:clean(vehicle.vehicle_type),driverId:driver?.id||null,driver:clean(driver?.full_name)||'غير مسند',attendanceEvent:event?.event_type||null,attendanceAt:event?.occurred_at||null,status};
    });
    const summary={total:rows.length,working:rows.filter(row=>row.status==='working').length,notWorking:rows.filter(row=>row.status==='not_working').length,maintenance:rows.filter(row=>row.status==='maintenance').length,unassigned:rows.filter(row=>row.status==='unassigned').length};
    json(res,200,{ok:true,day:riyadhDay(),timezone:'Asia/Riyadh',summary,vehicles:rows,source:'attendance'});
  }catch(error){errorResponse(res,error);}
}
