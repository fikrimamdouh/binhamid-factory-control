import { select } from './supabase.js';
import { sendMessage } from './telegram.js';

const FLEET_STATUS_ROLES=new Set(['admin','manager','mechanic','driver','fuel_operator']);
const day=()=>{const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),get=type=>parts.find(part=>part.type===type)?.value||'';return `${get('year')}-${get('month')}-${get('day')}`;};
const requiredSelect=async(table,query,label)=>{try{return await select(table,query)||[];}catch(error){throw Object.assign(new Error(`تعذر قراءة ${label}. لم يتم إصدار حالة أسطول ناقصة.`),{status:503,code:'FLEET_STATUS_READ_FAILED',sourceTable:table,cause:error});}};
const latestBy=(rows,key)=>{const result=new Map();for(const row of rows||[]){const id=String(row?.[key]||'');if(!id)continue;const old=result.get(id);if(!old||String(row.occurred_at||'')>String(old.occurred_at||''))result.set(id,row);}return result;};
const present=event=>['check_in','shift_start','trip_start'].includes(String(event?.event_type||''));
const clean=value=>String(value||'').trim();
const label=row=>clean(row.plate_no||row.plate||row.asset_no||row.external_id)||'مركبة بلا لوحة';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export async function getFleetAttendanceStatus(identity=null){
  if(!identity?.active||!FLEET_STATUS_ROLES.has(identity.role))throw Object.assign(new Error('ليست لديك صلاحية عرض حالة الأسطول.'),{status:403});
  const since=`${day()}T00:00:00+03:00`;
  const [vehicles,users,assignments,events,maintenance]=await Promise.all([
    requiredSelect('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,driver_external_id,status&order=plate_no.asc&limit=1000','المركبات'),
    requiredSelect('app_users','active=eq.true&select=id,full_name,role,employee_external_id&limit=2000','المستخدمين النشطين'),
    requiredSelect('employee_assignments','active=eq.true&select=app_user_id,vehicle_external_id,created_at&order=created_at.desc&limit=2000','ربط الموظفين بالمركبات'),
    requiredSelect('attendance_events',`occurred_at=gte.${encodeURIComponent(since)}&select=app_user_id,event_type,occurred_at&order=occurred_at.desc&limit=10000`,'حضور السائقين'),
    requiredSelect('maintenance_orders','vehicle_stopped=eq.true&status=not.in.(closed,cancelled,completed)&select=vehicle_external_id,plate_snapshot,status&limit=1000','أوامر الصيانة المفتوحة')
  ]);
  const userById=new Map(users.map(user=>[String(user.id),user]));
  const userByEmployee=new Map(users.filter(user=>clean(user.employee_external_id)).map(user=>[clean(user.employee_external_id),user]));
  const assignmentByVehicle=new Map();
  for(const assignment of assignments)if(clean(assignment.vehicle_external_id)&&!assignmentByVehicle.has(clean(assignment.vehicle_external_id)))assignmentByVehicle.set(clean(assignment.vehicle_external_id),userById.get(String(assignment.app_user_id))||null);
  const attendance=latestBy(events,'app_user_id'),stopped=new Set(maintenance.flatMap(row=>[clean(row.vehicle_external_id),clean(row.plate_snapshot)]).filter(Boolean));
  let rows=vehicles.map(vehicle=>{
    const vehicleId=clean(vehicle.external_id),driver=assignmentByVehicle.get(vehicleId)||userByEmployee.get(clean(vehicle.driver_external_id))||null,event=driver?attendance.get(String(driver.id)):null,maintenanceStopped=stopped.has(vehicleId)||stopped.has(label(vehicle));
    const status=maintenanceStopped?'maintenance':!driver?'unassigned':present(event)?'working':'not_working';
    return{vehicleId,vehicle:label(vehicle),vehicleType:clean(vehicle.vehicle_type),driverId:driver?.id||null,driver:clean(driver?.full_name)||'غير مسند',attendanceEvent:event?.event_type||null,attendanceAt:event?.occurred_at||null,status};
  });
  if(identity.role==='driver')rows=rows.filter(row=>String(row.driverId)===String(identity.user_id));
  return rows;
}

export async function sendFleetAttendanceStatus(chatId,query='',identity=null){
  let rows;try{rows=await getFleetAttendanceStatus(identity);}catch(error){return sendMessage(chatId,esc(error.message));}
  const search=clean(query).toLowerCase();if(search)rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(search));
  if(!rows.length)return sendMessage(chatId,identity?.role==='driver'?'لا توجد مركبة مسندة لحسابك. راجع مدير النظام.':'لا توجد مركبات فعالة مسجلة في النظام.');
  const working=rows.filter(row=>row.status==='working'),notWorking=rows.filter(row=>row.status==='not_working'),maintenance=rows.filter(row=>row.status==='maintenance'),unassigned=rows.filter(row=>row.status==='unassigned');
  const status=row=>row.status==='working'?'يعمل — السائق حاضر':row.status==='maintenance'?'متوقف للصيانة':row.status==='unassigned'?'غير مسند':'غير عامل — السائق غير حاضر';
  let text=`<b>حالة الأسطول اليوم من الحضور والانصراف</b>\n\nإجمالي المركبات: <b>${rows.length}</b>\nيعمل (السائق حاضر): <b>${working.length}</b>\nغير عامل (السائق غير حاضر): <b>${notWorking.length}</b>\nمتوقف للصيانة: <b>${maintenance.length}</b>\nغير مسند: <b>${unassigned.length}</b>\n\nهذه حالة تشغيل مبنية على حضور السائقين وربطهم بالمركبات، ولا تعرض مواقع المركبات.`;
  text+=`\n\n${rows.slice(0,28).map(row=>`• <b>${esc(row.vehicle)}</b> — ${esc(status(row))}\n  السائق: ${esc(row.driver)}${row.attendanceAt?` — آخر حركة: ${esc(String(row.attendanceAt).replace('T',' ').slice(0,16))}`:''}`).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900));
}
