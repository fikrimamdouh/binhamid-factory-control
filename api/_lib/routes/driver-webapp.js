import crypto from 'node:crypto';
import { body, errorResponse, json, method } from '../http.js';
import { validateTelegramWebApp } from '../telegram-webapp.js';
import { insert, rpc, select, uploadObject } from '../supabase.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const number=(value,{min=-Infinity,max=Infinity,required=false}={})=>{const parsed=Number(value);if(!Number.isFinite(parsed)){if(required)throw Object.assign(new Error('قيمة رقمية مطلوبة'),{status:400});return null;}if(parsed<min||parsed>max)throw Object.assign(new Error('القيمة الرقمية خارج النطاق المسموح'),{status:422});return parsed;};
const DRIVER_ROLES=new Set(['driver','admin','manager']);
const ALLOWED_IMAGES=new Set(['image/jpeg','image/png','image/webp']);

async function identityFor(initData){
  const verified=validateTelegramWebApp(initData),rows=await select('user_channels',`channel=eq.telegram&external_id=eq.${encodeURIComponent(String(verified.user.id))}&active=eq.true&select=user_id,app_users(id,full_name,role,active,employee_external_id)&limit=1`),row=rows?.[0],user=row?.app_users;
  if(!user?.active||!DRIVER_ROLES.has(user.role))throw Object.assign(new Error('حساب السائق غير معتمد أو لا يملك الصلاحية'),{status:403});
  const assignment=(await select('employee_assignments',`app_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=id,employee_external_id,vehicle_external_id,job_title,shift_name,work_sites(id,code,name,address)&limit=1`))?.[0]||null;
  if(user.role==='driver'&&!assignment?.vehicle_external_id)throw Object.assign(new Error('لا توجد مركبة مسندة إلى حسابك'),{status:409});
  return{verified,user,assignment};
}

function vehicleFor(identity,input){
  const requested=clean(input.vehicleExternalId,120),assigned=clean(identity.assignment?.vehicle_external_id,120);
  if(identity.user.role==='driver'){if(requested&&requested!==assigned)throw Object.assign(new Error('المركبة المطلوبة ليست مسندة إلى حسابك'),{status:403});return assigned;}
  return requested||assigned;
}

async function existingEvent(identity,clientEventId){
  if(!clientEventId)return null;
  return(await select('driver_events',`app_user_id=eq.${encodeURIComponent(identity.user.id)}&client_event_id=eq.${encodeURIComponent(clientEventId)}&select=id,reference_no,event_type,occurred_at&limit=1`))?.[0]||null;
}
async function reference(prefix){const result=await rpc('next_document_no',{p_prefix:prefix});return String(Array.isArray(result)?result[0]?.next_document_no||result[0]||'':result||'');}

async function storeReceipt(identity,input,clientEventId){
  const dataUrl=clean(input.receiptDataUrl,4_000_000);if(!dataUrl)return null;
  const match=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);if(!match||!ALLOWED_IMAGES.has(match[1]))throw Object.assign(new Error('صورة الإيصال يجب أن تكون JPG أو PNG أو WebP'),{status:415});
  const buffer=Buffer.from(match[2],'base64');if(!buffer.length||buffer.length>3*1024*1024)throw Object.assign(new Error('حجم صورة الإيصال يتجاوز 3 ميجابايت'),{status:413});
  const extension=match[1]==='image/png'?'png':match[1]==='image/webp'?'webp':'jpg',digest=crypto.createHash('sha256').update(buffer).digest('hex').slice(0,24),safeEvent=clientEventId.replace(/[^A-Za-z0-9_-]/g,'').slice(0,80)||digest;
  const path=`telegram-webapp/driver/${identity.user.id}/${new Date().toISOString().slice(0,10)}/${safeEvent}-${digest}.${extension}`;
  await uploadObject(path,buffer,match[1]);return path;
}

async function profile(identity){
  const vehicleId=clean(identity.assignment?.vehicle_external_id,120),vehicle=vehicleId?(await select('vehicles',`external_id=eq.${encodeURIComponent(vehicleId)}&select=external_id,plate_no,asset_no,vehicle_type,make,model,status&limit=1`))?.[0]||null:null;
  const tasks=await select('operational_tasks',`assigned_to=eq.${encodeURIComponent(identity.user.id)}&status=not.in.(completed,closed,cancelled)&select=id,reference_no,title,description,priority,status,due_at,related_entity_type,related_entity_id&order=due_at.asc.nullslast&limit=100`).catch(()=>[]);
  return{user:{id:identity.user.id,name:identity.user.full_name,role:identity.user.role},assignment:{jobTitle:identity.assignment?.job_title||null,shiftName:identity.assignment?.shift_name||null,site:identity.assignment?.work_sites||null},vehicle,tasks:tasks||[]};
}

async function recordDriverEvent(identity,input,eventType,values={}){
  const clientEventId=clean(input.clientEventId,120);if(!clientEventId)throw Object.assign(new Error('معرف العملية مطلوب لمنع التكرار'),{status:400});
  const duplicate=await existingEvent(identity,clientEventId);if(duplicate)return{duplicate:true,event:duplicate};
  const vehicleExternalId=vehicleFor(identity,input);if(!vehicleExternalId)throw Object.assign(new Error('المركبة مطلوبة'),{status:400});
  const ref=await reference('DRV'),occurredAt=new Date().toISOString(),row={reference_no:ref,app_user_id:identity.user.id,employee_external_id:identity.assignment?.employee_external_id||identity.user.employee_external_id||null,vehicle_external_id:vehicleExternalId,event_type:eventType,client_event_id:clientEventId,source_chat_id:`webapp:${identity.verified.user.id}`,source_message_id:identity.verified.queryId||null,occurred_at:occurredAt,...values};
  const result=await insert('driver_events',[row]);
  await insert('audit_log',[{actor_type:'telegram_webapp',actor_id:String(identity.verified.user.id),action:`driver_${eventType}`,entity_type:'driver_event',entity_id:ref,details:{client_event_id:clientEventId,vehicle_external_id:vehicleExternalId,event_type:eventType,app_user_id:identity.user.id}}],{prefer:'return=minimal'}).catch(()=>{});
  return{duplicate:false,event:result?.[0]||{reference_no:ref,event_type:eventType,occurred_at:occurredAt}};
}

async function odometer(identity,input){
  const vehicle=vehicleFor(identity,input),reading=number(input.odometer,{min:0,max:99_999_999,required:true}),latest=(await select('driver_events',`vehicle_external_id=eq.${encodeURIComponent(vehicle)}&odometer=not.is.null&select=odometer,occurred_at&order=occurred_at.desc&limit=1`))?.[0];
  if(latest&&reading<Number(latest.odometer))throw Object.assign(new Error(`قراءة العداد أقل من آخر قراءة مسجلة (${latest.odometer})`),{status:409});
  return recordDriverEvent(identity,input,'odometer_reading',{odometer:reading,note:clean(input.note,500)||null});
}

async function fuel(identity,input){
  const liters=number(input.liters,{min:0.001,max:2000,required:true}),amount=number(input.amount,{min:0,max:1_000_000})||0,odometerReading=number(input.odometer,{min:0,max:99_999_999}),clientEventId=clean(input.clientEventId,120);
  if(!clientEventId)throw Object.assign(new Error('معرف العملية مطلوب لمنع التكرار'),{status:400});
  const duplicate=await existingEvent(identity,clientEventId);if(duplicate)return{duplicate:true,event:duplicate};
  const receiptPhotoPath=await storeReceipt(identity,input,clientEventId);
  return recordDriverEvent(identity,input,'fuel_complete',{fuel_liters:liters,fuel_amount:amount,odometer:odometerReading,station_name:clean(input.stationName,200)||null,receipt_photo_path:receiptPhotoPath,note:clean(input.note,500)||null,latitude:number(input.latitude,{min:-90,max:90}),longitude:number(input.longitude,{min:-180,max:180})});
}

async function location(identity,input){
  return recordDriverEvent(identity,input,'location_update',{latitude:number(input.latitude,{min:-90,max:90,required:true}),longitude:number(input.longitude,{min:-180,max:180,required:true}),horizontal_accuracy_m:number(input.accuracy,{min:0,max:500}),note:clean(input.note,300)||null});
}

async function fault(identity,input){
  const clientEventId=clean(input.clientEventId,120),vehicleExternalId=vehicleFor(identity,input),problem=clean(input.problem,2000);if(!clientEventId||!problem)throw Object.assign(new Error('وصف العطل ومعرف العملية مطلوبان'),{status:400});
  const existing=(await select('audit_log',`action=eq.driver_fault_reported&details->>client_event_id=eq.${encodeURIComponent(clientEventId)}&select=entity_id,created_at&limit=1`))?.[0];if(existing)return{duplicate:true,reference:existing.entity_id};
  const ref=await reference('MNT'),priority=['normal','urgent','critical'].includes(clean(input.priority,20))?clean(input.priority,20):'normal';
  const result=await insert('maintenance_orders',[{reference_no:ref,vehicle_external_id:vehicleExternalId,plate_snapshot:clean(input.plateNo,120)||null,problem,priority:priority==='critical'?'urgent':priority,vehicle_stopped:Boolean(input.vehicleStopped),status:'reported',reported_by:identity.user.id,confirmed_by:identity.user.id,source_channel:'telegram_webapp',source_chat_id:`webapp:${identity.verified.user.id}`,source_message_id:identity.verified.queryId||null,confirmed_at:new Date().toISOString()}]);
  await insert('audit_log',[{actor_type:'telegram_webapp',actor_id:String(identity.verified.user.id),action:'driver_fault_reported',entity_type:'maintenance_order',entity_id:ref,details:{client_event_id:clientEventId,vehicle_external_id:vehicleExternalId,problem,priority,app_user_id:identity.user.id}}],{prefer:'return=minimal'});
  return{duplicate:false,reference:ref,status:result?.[0]?.status||'reported'};
}

export async function driverWebApp(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const input=await body(req),identity=await identityFor(input.initData),action=clean(input.action,40);
    if(action==='profile'||action==='tasks')return json(res,200,{ok:true,...await profile(identity)});
    if(action==='odometer')return json(res,200,{ok:true,...await odometer(identity,input)});
    if(action==='fuel')return json(res,200,{ok:true,...await fuel(identity,input)});
    if(action==='location')return json(res,200,{ok:true,...await location(identity,input)});
    if(action==='fault')return json(res,200,{ok:true,...await fault(identity,input)});
    throw Object.assign(new Error('إجراء السائق غير معروف'),{status:400});
  }catch(error){errorResponse(res,error);}
}
