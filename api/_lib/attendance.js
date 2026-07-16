import { requireAdmin } from '../_lib/auth.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { select, insert, upsert, patch, rpc } from '../_lib/supabase.js';
import { validateTelegramWebApp } from '../_lib/telegram-webapp.js';

const clean=value=>String(value??'').trim();
const num=(value,fallback=null)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;};
function haversine(lat1,lon1,lat2,lon2){
  const toRad=value=>Number(value)*Math.PI/180,R=6371000,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
async function telegramIdentity(externalId){
  const rows=await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(String(externalId))}&active=eq.true&select=user_id,app_users(id,full_name,role,active,employee_external_id)&limit=1`),row=rows?.[0];
  if(!row?.app_users?.active)throw Object.assign(new Error('حسابك غير معتمد أو موقوف'),{status:403});
  return{userId:row.user_id,externalId:String(externalId),...row.app_users};
}
async function assignmentFor(userId){
  return(await select('employee_assignments',`app_user_id=eq.${userId}&active=eq.true&select=*,work_sites(id,code,name,address,latitude,longitude,radius_m,active)&limit=1`))?.[0]||null;
}
async function recordWebAppAttendance(input){
  const verified=validateTelegramWebApp(input.initData),identity=await telegramIdentity(verified.user.id),assignment=await assignmentFor(identity.userId),site=assignment?.work_sites;
  if(!assignment)throw Object.assign(new Error('لم يتم ربط حسابك بموظف وموقع عمل'),{status:409});
  if(!site?.active||site.latitude==null||site.longitude==null)throw Object.assign(new Error('موقع العمل غير مكتمل أو غير مفعل'),{status:409});
  const eventType=clean(input.eventType);
  if(!['check_in','check_out'].includes(eventType))throw Object.assign(new Error('نوع حركة الحضور غير صحيح'),{status:400});
  const latitude=num(input.latitude),longitude=num(input.longitude),accuracy=num(input.accuracy),capturedAt=new Date(input.capturedAt||0),capturedAge=Date.now()-capturedAt.getTime();
  if(latitude==null||longitude==null||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Object.assign(new Error('إحداثيات GPS غير صحيحة'),{status:400});
  if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>150)throw Object.assign(new Error(`دقة الموقع غير كافية (${Math.round(accuracy||0)} متر)`),{status:422});
  if(!Number.isFinite(capturedAt.getTime())||capturedAge< -30000||capturedAge>120000)throw Object.assign(new Error('قراءة الموقع قديمة. أعد فتح شاشة الحضور'),{status:422});
  const distance=haversine(latitude,longitude,Number(site.latitude),Number(site.longitude)),within=distance<=Number(site.radius_m||250);
  const recent=await select('attendance_events',`app_user_id=eq.${identity.userId}&event_type=eq.${eventType}&occurred_at=gte.${encodeURIComponent(new Date(Date.now()-5*60000).toISOString())}&select=reference_no,occurred_at,distance_from_site_m,within_geofence&order=occurred_at.desc&limit=1`);
  if(recent?.[0])return{ok:true,duplicate:true,accepted:Boolean(recent[0].within_geofence),reference:recent[0].reference_no,eventType,site:{name:site.name,radiusM:site.radius_m},distanceM:Number(recent[0].distance_from_site_m||0),occurredAt:recent[0].occurred_at,employee:identity.full_name};
  const refResult=await rpc('next_document_no',{p_prefix:'ATT'}),reference=String(Array.isArray(refResult)?refResult[0]?.next_document_no||refResult[0]||'':refResult||''),occurredAt=new Date().toISOString();
  await insert('attendance_events',[{reference_no:reference,app_user_id:identity.userId,employee_external_id:assignment.employee_external_id||identity.employee_external_id||null,site_id:assignment.site_id,event_type:eventType,latitude,longitude,horizontal_accuracy_m:Number(accuracy.toFixed(2)),distance_from_site_m:Number(distance.toFixed(2)),within_geofence:within,note:within?'GPS مباشر داخل النطاق':'محاولة GPS مباشرة خارج النطاق — لم تعتمد كحضور صحيح',source_chat_id:`webapp:${verified.user.id}`,source_message_id:verified.queryId||null,occurred_at:occurredAt}]);
  return{ok:true,duplicate:false,accepted:within,reference,eventType,site:{name:site.name,radiusM:site.radius_m},distanceM:Number(distance.toFixed(1)),accuracyM:Number(accuracy.toFixed(1)),occurredAt,employee:identity.full_name};
}

export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='POST'){
      const input=await body(req),action=clean(input.action);
      if(action==='webapp_attendance')return json(res,200,await recordWebAppAttendance(input));
      requireAdmin(req);
      if(action==='save_site'){
        const name=clean(input.name),code=clean(input.code)||`SITE-${Date.now()}`;
        if(!name)throw Object.assign(new Error('اسم موقع العمل مطلوب'),{status:400});
        const values={code,name,address:clean(input.address)||null,latitude:num(input.latitude),longitude:num(input.longitude),radius_m:Math.max(25,Math.min(10000,Math.round(num(input.radiusM,250)))),active:input.active!==false,updated_at:new Date().toISOString()};
        const result=clean(input.id)?await patch('work_sites',`id=eq.${encodeURIComponent(clean(input.id))}`,values):await upsert('work_sites',[values],'code');
        return json(res,200,{ok:true,site:result?.[0]||values});
      }
      if(action==='assign_user'){
        const appUserId=clean(input.appUserId);if(!appUserId)throw Object.assign(new Error('المستخدم مطلوب'),{status:400});
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
    }
    requireAdmin(req);
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
  }catch(error){errorResponse(res,error);}
}
