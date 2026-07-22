import { requireCapability } from '../_lib/permissions.js';
import { json, method, body, errorResponse } from '../_lib/http.js';
import { select, insert, upsert, patch, rpc } from '../_lib/supabase.js';
import { validateTelegramWebApp } from '../_lib/telegram-webapp.js';
import { ROLES } from '../_lib/domain.js';

const clean=value=>String(value??'').trim();
const num=(value,fallback=null)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const EMPLOYEE_STATUSES=new Set(['working','holiday','leave','suspended']);
const DEFAULT_SITES=Object.freeze([
  {code:'FACTORY_MAIN',name:'مصنع بن حامد الرئيسي',address:'المصنع — رابط الموقع المعتمد',mapUrl:'https://maps.app.goo.gl/6JgcFbnj4mKrKwhL7',radiusM:250},
  {code:'STATION_MAIN',name:'محطة بن حامد',address:'المحطة — رابط الموقع المعتمد',mapUrl:'https://maps.app.goo.gl/KKk8PVWEnvyGCb1V7',radiusM:250}
]);

function haversine(lat1,lon1,lat2,lon2){
  const toRad=value=>Number(value)*Math.PI/180,R=6371000,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function riyadhDayRange(){
  const day=new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10),start=new Date(`${day}T00:00:00+03:00`),end=new Date(start.getTime()+24*60*60*1000);
  return{start:start.toISOString(),end:end.toISOString()};
}
const actorOf=identity=>identity?.fullName||identity?.appUserId||identity?.actor||'system';
async function audit(identity,action,entityType,entityId,details={}){
  await insert('audit_log',[{actor_type:'web',actor_id:actorOf(identity),action,entity_type:entityType,entity_id:String(entityId||''),details}],{prefer:'return=minimal'}).catch(()=>{});
}
async function safeSelect(label,table,query,warnings){
  try{return await select(table,query);}
  catch(error){warnings.push({source:label,code:String(error?.code||'QUERY_UNAVAILABLE').slice(0,80),message:String(error?.message||'').slice(0,180)});console.warn(`[attendance admin] ${label}`,error?.message||error);return[];}
}
function mapBy(rows,key){return new Map((rows||[]).map(row=>[clean(row?.[key]),row]).filter(([value])=>value));}

async function telegramIdentity(externalId){
  const channel=(await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(String(externalId))}&active=eq.true&select=user_id,external_id&limit=1`))?.[0];
  if(!channel?.user_id)throw Object.assign(new Error('حساب Telegram غير مرتبط بمستخدم معتمد'),{status:403,code:'ATTENDANCE_USER_INACTIVE'});
  const user=(await select('app_users',`id=eq.${encodeURIComponent(channel.user_id)}&active=eq.true&select=id,full_name,role,active,employee_external_id&limit=1`))?.[0];
  if(!user?.active)throw Object.assign(new Error('حسابك غير معتمد أو موقوف'),{status:403,code:'ATTENDANCE_USER_INACTIVE'});
  return{userId:user.id,externalId:String(externalId),...user};
}
async function storedEmployeeSites(){
  const rows=await select('app_state','key=eq.primary&select=employees:payload->legacy->emp&limit=1').catch(()=>[]),employees=rows?.[0]?.employees;
  return Array.isArray(employees)?employees:[];
}
async function defaultSiteForEmployee(employeeExternalId){
  const id=clean(employeeExternalId);if(!id)return null;
  const employees=await storedEmployeeSites(),employee=employees.find(row=>clean(row?.id||row?.external_id)===id),siteId=clean(employee?.attendanceSiteId||employee?.workSiteId||employee?.siteId);
  if(!siteId)return null;
  const site=(await select('work_sites',`id=eq.${encodeURIComponent(siteId)}&active=eq.true&select=id,code,name,address,latitude,longitude,radius_m,active&limit=1`).catch(()=>[]))?.[0];
  return site?{employee,site}:null;
}
async function assignmentFor(userId,employeeExternalId=''){
  const row=(await select('employee_assignments',`app_user_id=eq.${encodeURIComponent(userId)}&active=eq.true&select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active&limit=1`))?.[0]||null;
  let site=row?.site_id?(await select('work_sites',`id=eq.${encodeURIComponent(row.site_id)}&active=eq.true&select=id,code,name,address,latitude,longitude,radius_m,active&limit=1`).catch(()=>[]))?.[0]:null;
  if(site)return{...row,work_sites:site};
  const fallback=await defaultSiteForEmployee(employeeExternalId||row?.employee_external_id);if(!fallback)return row;
  return{...(row||{}),app_user_id:userId,employee_external_id:clean(employeeExternalId||row?.employee_external_id),site_id:fallback.site.id,active:true,work_sites:fallback.site,inherited_site:true};
}
async function recordWebAppAttendance(input){
  const verified=validateTelegramWebApp(input.initData),identity=await telegramIdentity(verified.user.id),assignment=await assignmentFor(identity.userId,identity.employee_external_id),site=assignment?.work_sites;
  if(!assignment||!assignment.employee_external_id||!assignment.site_id)throw Object.assign(new Error('لم يتم ربط حسابك بموظف وموقع عمل'),{status:409,code:'ATTENDANCE_ASSIGNMENT_REQUIRED'});
  if(!site?.active||site.latitude==null||site.longitude==null)throw Object.assign(new Error('موقع العمل غير مكتمل أو غير مفعل'),{status:409,code:'ATTENDANCE_SITE_INVALID'});
  const eventType=clean(input.eventType);if(!['check_in','check_out'].includes(eventType))throw Object.assign(new Error('نوع حركة الحضور غير صحيح'),{status:400,code:'ATTENDANCE_EVENT_INVALID'});
  const latitude=num(input.latitude),longitude=num(input.longitude),accuracy=num(input.accuracy),capturedAt=new Date(input.capturedAt||0),capturedAge=Date.now()-capturedAt.getTime();
  if(latitude==null||longitude==null||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Object.assign(new Error('إحداثيات GPS غير صحيحة'),{status:400,code:'ATTENDANCE_GPS_INVALID'});
  if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>150)throw Object.assign(new Error(`دقة الموقع غير كافية (${Math.round(accuracy||0)} متر)`),{status:422,code:'ATTENDANCE_GPS_ACCURACY'});
  if(!Number.isFinite(capturedAt.getTime())||capturedAge< -30000||capturedAge>120000)throw Object.assign(new Error('قراءة الموقع قديمة. أعد فتح شاشة الحضور'),{status:422,code:'ATTENDANCE_GPS_STALE'});
  const distance=haversine(latitude,longitude,Number(site.latitude),Number(site.longitude)),within=distance<=Number(site.radius_m||250);
  const recent=await select('attendance_events',`app_user_id=eq.${identity.userId}&event_type=eq.${eventType}&within_geofence=eq.true&occurred_at=gte.${encodeURIComponent(new Date(Date.now()-5*60000).toISOString())}&select=reference_no,occurred_at,distance_from_site_m,within_geofence&order=occurred_at.desc&limit=1`);
  if(recent?.[0])return{ok:true,duplicate:true,accepted:true,reference:recent[0].reference_no,eventType,site:{name:site.name,radiusM:site.radius_m},distanceM:Number(recent[0].distance_from_site_m||0),occurredAt:recent[0].occurred_at,employee:identity.full_name};
  const refResult=await rpc('next_document_no',{p_prefix:'ATT'}),reference=String(Array.isArray(refResult)?refResult[0]?.next_document_no||refResult[0]||'':refResult||''),occurredAt=new Date().toISOString();
  await insert('attendance_events',[{reference_no:reference,app_user_id:identity.userId,employee_external_id:assignment.employee_external_id||identity.employee_external_id||null,site_id:assignment.site_id,event_type:eventType,latitude,longitude,horizontal_accuracy_m:Number(accuracy.toFixed(2)),distance_from_site_m:Number(distance.toFixed(2)),within_geofence:within,note:within?'GPS مباشر داخل النطاق':'محاولة GPS مباشرة خارج النطاق — لم تعتمد كحضور صحيح',source_chat_id:`webapp:${verified.user.id}`,source_message_id:verified.queryId||null,occurred_at:occurredAt}]);
  return{ok:true,duplicate:false,accepted:within,reference,eventType,site:{name:site.name,radiusM:site.radius_m},distanceM:Number(distance.toFixed(1)),accuracyM:Number(accuracy.toFixed(1)),occurredAt,employee:identity.full_name};
}

async function setEmployeeSite(input){
  const employeeExternalId=clean(input.employeeExternalId),siteId=clean(input.siteId);if(!employeeExternalId)throw Object.assign(new Error('سجل الموظف مطلوب'),{status:400,code:'ATTENDANCE_EMPLOYEE_REQUIRED'});
  const employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,active&limit=1`))?.[0];if(!employee)throw Object.assign(new Error('سجل الموظف غير موجود أو موقوف'),{status:409,code:'ATTENDANCE_EMPLOYEE_INVALID'});
  let site=null;if(siteId){site=(await select('work_sites',`id=eq.${encodeURIComponent(siteId)}&active=eq.true&select=id,code,name,latitude,longitude,radius_m,active&limit=1`))?.[0];if(!site||site.latitude==null||site.longitude==null)throw Object.assign(new Error('موقع الحضور غير فعال أو إحداثياته غير مكتملة'),{status:409,code:'ATTENDANCE_SITE_INVALID'});}
  const users=await select('app_users',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=id&limit=100`).catch(()=>[]);if(!users?.length)return{employee,site,linkedUsers:0,assignments:[]};
  const ids=users.map(row=>row.id).filter(Boolean),oldRows=ids.length?await select('employee_assignments',`app_user_id=in.(${ids.join(',')})&select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active,updated_at&limit=100`).catch(()=>[]):[],oldByUser=new Map((oldRows||[]).map(row=>[row.app_user_id,row]));
  const stamp=new Date().toISOString(),assignments=await Promise.all(ids.map(async appUserId=>{const previous=oldByUser.get(appUserId);if(!siteId){if(!previous)return null;return(await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}`,{site_id:null,active:false,updated_at:stamp}))?.[0]||{...previous,site_id:null,active:false,updated_at:stamp};}const values={app_user_id:appUserId,employee_external_id:employeeExternalId,site_id:siteId,vehicle_external_id:previous?.vehicle_external_id||null,job_title:previous?.job_title||null,shift_name:previous?.shift_name||null,active:previous?previous.active!==false:true,updated_at:stamp};return(await upsert('employee_assignments',[values],'app_user_id'))?.[0]||values;}));
  return{employee,site,linkedUsers:ids.length,assignments:assignments.filter(Boolean)};
}
async function saveAssignment(input){
  const appUserId=clean(input.appUserId),externalId=clean(input.externalId),employeeExternalId=clean(input.employeeExternalId),vehicleExternalId=clean(input.vehicleExternalId),role=clean(input.role),active=input.active!==false;let siteId=clean(input.siteId);
  if(!siteId&&employeeExternalId)siteId=(await defaultSiteForEmployee(employeeExternalId))?.site?.id||'';
  if(!appUserId||!externalId)throw Object.assign(new Error('مستخدم Telegram مطلوب'),{status:400,code:'ATTENDANCE_USER_REQUIRED'});if(!ROLES.includes(role)||role==='pending')throw Object.assign(new Error('الدور غير صحيح'),{status:400,code:'ATTENDANCE_ROLE_INVALID'});if(!employeeExternalId)throw Object.assign(new Error('اختر سجل الموظف'),{status:400,code:'ATTENDANCE_EMPLOYEE_REQUIRED'});if(!siteId)throw Object.assign(new Error('اختر موقع العمل من صفحة الموظفين أو شاشة الحضور'),{status:400,code:'ATTENDANCE_SITE_REQUIRED'});
  const [channelRows,employeeRows,siteRows,vehicleRows,previousRows]=await Promise.all([
    select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(externalId)}&user_id=eq.${encodeURIComponent(appUserId)}&select=user_id,external_id,active&limit=1`),
    select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,active&limit=1`),
    select('work_sites',`id=eq.${encodeURIComponent(siteId)}&active=eq.true&select=id,name,latitude,longitude,active&limit=1`),
    vehicleExternalId?select('vehicles',`external_id=eq.${encodeURIComponent(vehicleExternalId)}&active=eq.true&select=external_id,active&limit=1`):Promise.resolve([]),
    select('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}&select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active,updated_at&limit=1`).catch(()=>[])
  ]);
  const channel=channelRows?.[0],employee=employeeRows?.[0],site=siteRows?.[0],previous=previousRows?.[0]||null;if(!channel)throw Object.assign(new Error('ربط Telegram غير موجود لهذا المستخدم'),{status:409,code:'ATTENDANCE_TELEGRAM_LINK_MISSING'});if(!employee)throw Object.assign(new Error('سجل الموظف غير موجود أو موقوف'),{status:409,code:'ATTENDANCE_EMPLOYEE_INVALID'});if(!site||site.latitude==null||site.longitude==null)throw Object.assign(new Error('موقع العمل غير فعال أو إحداثياته غير مكتملة'),{status:409,code:'ATTENDANCE_SITE_INVALID'});if(vehicleExternalId&&!vehicleRows?.[0])throw Object.assign(new Error('المركبة غير موجودة أو موقوفة'),{status:409,code:'ATTENDANCE_VEHICLE_INVALID'});
  const values={app_user_id:appUserId,employee_external_id:employeeExternalId,site_id:siteId,vehicle_external_id:vehicleExternalId||null,job_title:clean(input.jobTitle)||null,shift_name:clean(input.shiftName)||null,active,updated_at:new Date().toISOString()},assignment=(await upsert('employee_assignments',[values],'app_user_id'))?.[0]||values;
  try{const approved=await rpc('approve_telegram_user',{p_external_id:externalId,p_full_name:employee.full_name||externalId,p_role:role,p_active:active,p_employee_external_id:employeeExternalId});return{assignment,approved};}
  catch(error){if(previous)await upsert('employee_assignments',[previous],'app_user_id').catch(()=>{});else await patch('employee_assignments',`app_user_id=eq.${encodeURIComponent(appUserId)}`,{active:false,updated_at:new Date().toISOString()}).catch(()=>{});throw error;}
}

function coordinatesFromText(value){
  const text=String(value||'');let decoded=text;try{decoded=decodeURIComponent(text);}catch{}
  const patterns=[/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,/[?&](?:q|query|ll|center)=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,/"latitude"\s*:\s*(-?\d{1,2}(?:\.\d+)?).*?"longitude"\s*:\s*(-?\d{1,3}(?:\.\d+)?)/s];
  for(const pattern of patterns){const match=decoded.match(pattern);if(match){const latitude=Number(match[1]),longitude=Number(match[2]);if(Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180)return{latitude,longitude};}}
  return null;
}
async function resolveDefaultSite(preset){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  try{
    const response=await fetch(preset.mapUrl,{redirect:'follow',signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 BinHamid-Attendance-Setup/1.0','Accept-Language':'ar,en;q=0.8'}}),html=(await response.text()).slice(0,800000),coords=coordinatesFromText(response.url)||coordinatesFromText(html);
    if(!coords)throw Object.assign(new Error(`تعذر استخراج إحداثيات ${preset.name} تلقائيًا. افتح الرابط واضغط قراءة موقعي الحالي من الموقع نفسه.`),{status:502,code:'ATTENDANCE_MAP_RESOLVE_FAILED',siteCode:preset.code});
    return{...preset,...coords};
  }catch(error){if(error?.name==='AbortError')throw Object.assign(new Error(`انتهت مهلة قراءة رابط ${preset.name}. أعد المحاولة أو استخدم قراءة موقعي الحالي.`),{status:504,code:'ATTENDANCE_MAP_RESOLVE_TIMEOUT',siteCode:preset.code});throw error;}
  finally{clearTimeout(timer);}
}
async function seedDefaultSites(identity){
  const resolved=await Promise.all(DEFAULT_SITES.map(resolveDefaultSite)),stamp=new Date().toISOString(),rows=resolved.map(site=>({code:site.code,name:site.name,address:`${site.address} — ${site.mapUrl}`,latitude:site.latitude,longitude:site.longitude,radius_m:site.radiusM,active:true,updated_at:stamp})),saved=await upsert('work_sites',rows,'code');
  await audit(identity,'attendance_default_sites_seeded','work_sites','FACTORY_MAIN,STATION_MAIN',{sites:rows.map(row=>({code:row.code,latitude:row.latitude,longitude:row.longitude,radiusM:row.radius_m}))});
  return{sites:saved?.length?saved:rows};
}
async function updateEmployeeStatus(input,identity){
  const employeeExternalId=clean(input.employeeExternalId),workStatus=clean(input.workStatus);if(!employeeExternalId||!EMPLOYEE_STATUSES.has(workStatus))throw Object.assign(new Error('حدد الموظف وحالة صحيحة'),{status:400,code:'EMPLOYEE_STATUS_INVALID'});
  const employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,metadata&limit=1`))?.[0];if(!employee)throw Object.assign(new Error('الموظف غير موجود أو موقوف'),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  const metadata={...object(employee.metadata),workStatus,manualWorkStatus:workStatus,workStatusUpdatedAt:new Date().toISOString(),workStatusUpdatedBy:actorOf(identity)},updated=(await patch('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}`,{metadata,updated_at:new Date().toISOString()}))?.[0]||{...employee,metadata};
  await audit(identity,'employee_work_status_updated','employee',employeeExternalId,{employeeName:employee.full_name,workStatus});return{employee:updated,workStatus};
}
async function deactivateEmployee(input,identity){
  const employeeExternalId=clean(input.employeeExternalId),reason=clean(input.reason)||'حذف آمن من شاشة الموظفين';if(!employeeExternalId)throw Object.assign(new Error('حدد الموظف المطلوب حذفه'),{status:400,code:'EMPLOYEE_REQUIRED'});
  const employee=(await select('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=external_id,full_name,metadata&limit=1`))?.[0];if(!employee)throw Object.assign(new Error('الموظف غير موجود أو محذوف بالفعل'),{status:404,code:'EMPLOYEE_NOT_FOUND'});
  const linkedUsers=await select('app_users',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}&active=eq.true&select=id,full_name,role&limit=100`).catch(()=>[]);if((linkedUsers||[]).some(row=>row.role==='admin'))throw Object.assign(new Error('لا يمكن حذف الموظف المرتبط بحساب مدير النظام. افصل حساب المدير أولًا.'),{status:409,code:'EMPLOYEE_OWNER_PROTECTED'});
  const stamp=new Date().toISOString();
  await patch('employee_assignments',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{active:false,updated_at:stamp}).catch(()=>[]);
  await patch('app_users',`employee_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{active:false,updated_at:stamp}).catch(()=>[]);
  await patch('vehicles',`driver_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{driver_external_id:null,updated_at:stamp}).catch(()=>[]);
  await patch('unified_assets',`assigned_employee_external_id=eq.${encodeURIComponent(employeeExternalId)}`,{assigned_employee_external_id:null,updated_at:stamp}).catch(()=>[]);
  const metadata={...object(employee.metadata),workStatus:'terminated',manualWorkStatus:'terminated',deactivatedAt:stamp,deactivatedBy:actorOf(identity),deactivationReason:reason},updated=(await patch('employees',`external_id=eq.${encodeURIComponent(employeeExternalId)}`,{active:false,metadata,updated_at:stamp}))?.[0]||{...employee,active:false,metadata};
  await audit(identity,'employee_deactivated','employee',employeeExternalId,{employeeName:employee.full_name,reason,disabledUsers:(linkedUsers||[]).length});return{employee:updated,disabledUsers:(linkedUsers||[]).length};
}

async function attendanceOverview(){
  const warnings=[],range=riyadhDayRange();
  const [sites,assignments,channels,appUsers,vehicles,employees,attendance,driverEvents,stateRows]=await Promise.all([
    safeSelect('work_sites','work_sites','select=*&order=name.asc&limit=500',warnings),
    safeSelect('employee_assignments','employee_assignments','select=app_user_id,employee_external_id,site_id,vehicle_external_id,job_title,shift_name,active,updated_at&order=updated_at.desc&limit=1000',warnings),
    safeSelect('telegram_users','user_channels','channel=eq.telegram&select=external_id,external_username,active,user_id,last_seen_at&order=last_seen_at.desc&limit=1000',warnings),
    safeSelect('app_users','app_users','select=id,full_name,role,active,employee_external_id&limit=2000',warnings),
    safeSelect('vehicles','vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,driver_external_id,status&order=plate_no.asc&limit=2000',warnings),
    safeSelect('employees','employees','active=eq.true&select=external_id,employee_no,full_name,phone,role,active,metadata&order=full_name.asc&limit=3000',warnings),
    safeSelect('attendance_events','attendance_events',`occurred_at=gte.${encodeURIComponent(range.start)}&occurred_at=lt.${encodeURIComponent(range.end)}&select=id,reference_no,app_user_id,site_id,employee_external_id,event_type,occurred_at,within_geofence,distance_from_site_m,horizontal_accuracy_m,latitude,longitude,note&order=occurred_at.desc&limit=1000`,warnings),
    safeSelect('driver_events','driver_events',`occurred_at=gte.${encodeURIComponent(range.start)}&occurred_at=lt.${encodeURIComponent(range.end)}&select=id,reference_no,app_user_id,event_type,occurred_at,vehicle_external_id,latitude,longitude,odometer,fuel_liters,fuel_amount&order=occurred_at.desc&limit=1000`,warnings),
    safeSelect('app_state_employees','app_state','key=eq.primary&select=payload&limit=1',warnings)
  ]);
  const siteById=mapBy(sites,'id'),userById=mapBy(appUsers,'id'),storedEmployees=stateRows?.[0]?.payload?.legacy?.emp,stored=Array.isArray(storedEmployees)?storedEmployees:[],storedById=new Map(stored.map(row=>[clean(row?.id||row?.external_id),row]));
  const normalizedUsers=(channels||[]).map(row=>{const user=userById.get(clean(row.user_id))||{};return{external_id:row.external_id,external_username:row.external_username,user_id:row.user_id,channel_active:row.active,id:user.id||row.user_id,full_name:user.full_name||'',role:user.role||'pending',active:Boolean(user.active&&row.active),employee_external_id:user.employee_external_id||''};});
  const normalizedEmployees=(employees||[]).map(row=>{const source=storedById.get(clean(row.external_id)),metadata=object(row.metadata);return{...row,attendance_site_id:clean(source?.attendanceSiteId||source?.workSiteId||source?.siteId)||null,work_status:clean(metadata.manualWorkStatus||metadata.workStatus||'working')};});
  return{ok:true,degraded:warnings.length>0,warnings,sites:sites||[],assignments:(assignments||[]).map(row=>({...row,work_sites:siteById.get(clean(row.site_id))||null,app_users:userById.get(clean(row.app_user_id))||null})),users:normalizedUsers,vehicles:vehicles||[],employees:normalizedEmployees,attendance:(attendance||[]).map(row=>({...row,app_users:userById.get(clean(row.app_user_id))||null,work_sites:siteById.get(clean(row.site_id))||null})),driverEvents:(driverEvents||[]).map(row=>({...row,app_users:userById.get(clean(row.app_user_id))||null})),dayRange:range};
}

export default async function handler(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='POST'){
      const input=await body(req),action=clean(input.action);if(action==='webapp_attendance')return json(res,200,await recordWebAppAttendance(input));
      const identity=await requireCapability(req,'attendance.manage');
      if(action==='save_site'){
        const name=clean(input.name),code=clean(input.code)||`SITE-${Date.now()}`,latitude=num(input.latitude),longitude=num(input.longitude);if(!name)throw Object.assign(new Error('اسم موقع العمل مطلوب'),{status:400,code:'ATTENDANCE_SITE_NAME_REQUIRED'});if(latitude==null||longitude==null||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Object.assign(new Error('إحداثيات موقع العمل غير صحيحة'),{status:400,code:'ATTENDANCE_SITE_COORDINATES_INVALID'});
        const values={code,name,address:clean(input.address)||null,latitude,longitude,radius_m:Math.max(25,Math.min(10000,Math.round(num(input.radiusM,250)))),active:input.active!==false,updated_at:new Date().toISOString()},result=clean(input.id)?await patch('work_sites',`id=eq.${encodeURIComponent(clean(input.id))}`,values):await upsert('work_sites',[values],'code');await audit(identity,'attendance_site_saved','work_site',code,{name,latitude,longitude,radiusM:values.radius_m});return json(res,200,{ok:true,site:result?.[0]||values});
      }
      if(action==='seed_default_sites')return json(res,200,{ok:true,...await seedDefaultSites(identity)});
      if(action==='assign_user')return json(res,200,{ok:true,...await saveAssignment(input)});
      if(action==='assign_employee_site'){const result=await setEmployeeSite(input);await audit(identity,'employee_attendance_site_assigned','employee',input.employeeExternalId,{siteId:input.siteId||null,linkedUsers:result.linkedUsers});return json(res,200,{ok:true,...result});}
      if(action==='update_employee_status')return json(res,200,{ok:true,...await updateEmployeeStatus(input,identity)});
      if(action==='deactivate_employee')return json(res,200,{ok:true,...await deactivateEmployee(input,identity)});
      if(action==='toggle_site'){const id=clean(input.id);if(!id)throw Object.assign(new Error('معرف الموقع مطلوب'),{status:400,code:'ATTENDANCE_SITE_ID_REQUIRED'});const result=await patch('work_sites',`id=eq.${encodeURIComponent(id)}`,{active:Boolean(input.active),updated_at:new Date().toISOString()});return json(res,200,{ok:true,site:result?.[0]||null});}
      throw Object.assign(new Error('الإجراء غير معروف'),{status:400,code:'ATTENDANCE_ACTION_UNKNOWN'});
    }
    await requireCapability(req,'attendance.view');return json(res,200,await attendanceOverview());
  }catch(error){errorResponse(res,error);}
}
