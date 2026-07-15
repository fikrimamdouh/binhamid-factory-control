import { select, insert, uploadObject } from './supabase.js';
import { sendMessage, keyboard, downloadTelegramFile } from './telegram.js';
import { sha256 } from './domain.js';
import { displayName } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { getEnterpriseSession, nextEnterpriseReference, numberFrom, setEnterpriseSession, esc } from './bot-enterprise-store.js';

const ATTENDANCE_ROLES=new Set(['admin','manager','hr','driver','employee','mechanic','accountant','block_sales','concrete_sales','collector','warehouse','fuel_operator','procurement','quality']);
const DRIVER_ROLES=new Set(['admin','manager','driver','mechanic','fuel_operator']);
const MANAGER_ROLES=new Set(['admin','manager','hr']);
const EVENT_LABEL={check_in:'حضور',check_out:'انصراف',shift_start:'بدء وردية',shift_end:'إنهاء وردية',trip_start:'بدء رحلة',trip_end:'إنهاء رحلة',location_update:'تحديث موقع',fuel_complete:'تعبئة ديزل'};

function locationReplyMarkup(label='إرسال موقعي الحالي'){
  return{reply_markup:{keyboard:[[{text:label,request_location:true}],[{text:'إلغاء'}]],resize_keyboard:true,one_time_keyboard:true,selective:true}};
}
function privateBotUrl(){return `https://t.me/${String(process.env.TELEGRAM_BOT_USERNAME||'BinHamidFactoryControlBot').replace(/^@/,'')}?start=attendance`;}
function privateOnly(message){
  if(message.chat?.type==='private')return false;
  sendMessage(message.chat.id,'إرسال الموقع يعمل من المحادثة الخاصة مع البوت لحماية بيانات الموظف.',keyboard([[{text:'فتح البوت الخاص',url:privateBotUrl()}]]));
  return true;
}
function haversine(lat1,lon1,lat2,lon2){
  const toRad=value=>Number(value)*Math.PI/180,R=6371000,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
async function assignmentFor(identity){
  if(!identity?.user_id)return null;
  return(await select('employee_assignments',`app_user_id=eq.${identity.user_id}&active=eq.true&select=*,work_sites(id,code,name,address,latitude,longitude,radius_m)&limit=1`))?.[0]||null;
}
function assignedVehicle(assignment){return String(assignment?.vehicle_external_id||'').trim();}
async function saveAttendance(message,identity,eventType,location){
  const assignment=await assignmentFor(identity),site=assignment?.work_sites||null,latitude=Number(location.latitude),longitude=Number(location.longitude),accuracy=Number(location.horizontal_accuracy||0)||null;
  const distance=site?.latitude!=null&&site?.longitude!=null?haversine(latitude,longitude,Number(site.latitude),Number(site.longitude)):null;
  const within=distance==null?null:distance<=Number(site.radius_m||250);
  const reference=await nextEnterpriseReference('ATT');
  await insert('attendance_events',[{reference_no:reference,app_user_id:identity.user_id,employee_external_id:assignment?.employee_external_id||identity.employee_external_id||null,site_id:assignment?.site_id||null,event_type:eventType,latitude,longitude,horizontal_accuracy_m:accuracy,distance_from_site_m:distance==null?null:Number(distance.toFixed(2)),within_geofence:within,note:site?`الموقع المعين: ${site.name}`:'لا يوجد موقع عمل معين',source_chat_id:String(message.chat.id),source_message_id:String(message.message_id),occurred_at:new Date((message.date||Date.now()/1000)*1000).toISOString()}]);
  const place=site?`\nالموقع المعين: <b>${esc(site.name)}</b>`:'\nتنبيه: لا يوجد موقع عمل معين لهذا الحساب.';
  const distanceText=distance==null?'':`\nالمسافة من الموقع: <b>${Math.round(distance)} متر</b>\nالنتيجة: <b>${within?'داخل نطاق العمل':'خارج نطاق العمل'}</b>`;
  return sendMessage(message.chat.id,`تم تسجيل <b>${EVENT_LABEL[eventType]||eventType}</b>.\nالمرجع: <b>${esc(reference)}</b>${place}${distanceText}\nالوقت: <b>${new Date().toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'})}</b>`,{reply_markup:{remove_keyboard:true}});
}
async function saveDriverEvent(message,identity,eventType,values={}){
  const assignment=await assignmentFor(identity),reference=await nextEnterpriseReference('DRV');
  const row={reference_no:reference,app_user_id:identity.user_id,employee_external_id:assignment?.employee_external_id||identity.employee_external_id||null,vehicle_external_id:values.vehicle_external_id||assignedVehicle(assignment)||null,event_type:eventType,latitude:values.latitude??null,longitude:values.longitude??null,horizontal_accuracy_m:values.horizontal_accuracy_m??null,odometer:values.odometer??null,fuel_liters:values.fuel_liters??null,fuel_amount:values.fuel_amount??null,station_name:values.station_name||null,destination:values.destination||null,odometer_photo_path:values.odometer_photo_path||null,receipt_photo_path:values.receipt_photo_path||null,note:values.note||null,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id),occurred_at:new Date((message.date||Date.now()/1000)*1000).toISOString()};
  await insert('driver_events',[row]);
  return{reference,row,assignment};
}
export function attendanceMenu(identity){
  const role=identity?.role||'pending',rows=[];
  if(ATTENDANCE_ROLES.has(role))rows.push([{text:'✅ تسجيل حضور',callback_data:'att:check_in'},{text:'⏹ تسجيل انصراف',callback_data:'att:check_out'}]);
  rows.push([{text:'📋 حضوري اليوم',callback_data:'att:my_attendance'}]);
  if(DRIVER_ROLES.has(role)){
    rows.push([{text:'🚚 بدء الوردية',callback_data:'att:shift_start'},{text:'🏁 إنهاء الوردية',callback_data:'att:shift_end'}]);
    rows.push([{text:'▶️ بدء رحلة',callback_data:'att:trip_start'},{text:'⏹ إنهاء رحلة',callback_data:'att:trip_end'}]);
    rows.push([{text:'⛽ تعبئة ديزل بالعداد',callback_data:'att:fuel'},{text:'📍 إرسال موقعي',callback_data:'att:location_update'}]);
    rows.push([{text:'🛰 مشاركة موقع مباشر',callback_data:'att:live_help'},{text:'📊 تقرير حركتي',callback_data:'att:my_movement'}]);
  }
  if(MANAGER_ROLES.has(role))rows.push([{text:'👥 تقرير الحضور',callback_data:'att:attendance_report'},{text:'🚛 تقرير حركة السائقين',callback_data:'att:movement_report'}]);
  return keyboard(rows);
}
export async function showAttendanceMenu(message,identity){
  if(!ATTENDANCE_ROLES.has(identity?.role||''))return sendMessage(message.chat.id,'دورك الحالي لا يتضمن تسجيل الحضور أو الحركة.');
  return sendMessage(message.chat.id,`<b>الحضور والمواقع والحركة</b>\n${esc(displayName(identity,message.from))}، اختر العملية المطلوبة. تسجيل الحضور يعتمد على حسابك المعتمد والموقع الحالي والوقت، وليس جهاز بصمة.`,attendanceMenu(identity));
}
export async function startAttendanceAction(message,identity,action){
  if(!ATTENDANCE_ROLES.has(identity?.role||''))return sendMessage(message.chat.id,'لا تملك صلاحية تسجيل الحضور أو الحركة.');
  if(privateOnly(message))return;
  if(action==='my_attendance')return sendMyAttendance(message.chat.id,identity);
  if(action==='my_movement')return sendDriverMovementReport(message.chat.id,identity,false);
  if(action==='attendance_report')return sendAttendanceReport(message.chat.id,identity);
  if(action==='movement_report')return sendDriverMovementReport(message.chat.id,identity,true);
  if(action==='live_help')return sendMessage(message.chat.id,'من زر المرفقات في Telegram اختر «الموقع» ثم «مشاركة موقعي المباشر». سيحفظ البوت تحديثات الموقع طوال المدة التي تختارها. أوقف المشاركة من Telegram عند انتهاء الرحلة.');
  const requiresDriver=['shift_start','shift_end','trip_start','trip_end','fuel','location_update'];
  if(requiresDriver.includes(action)&&!DRIVER_ROLES.has(identity.role))return sendMessage(message.chat.id,'هذه العملية مخصصة للسائق أو مسؤول الأسطول والورشة.');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'attendance_location',{action,startedAt:new Date().toISOString()});
  const labels={check_in:'أرسل موقعك الحالي لتسجيل الحضور.',check_out:'أرسل موقعك الحالي لتسجيل الانصراف.',shift_start:'أرسل موقعك الحالي لبدء الوردية.',shift_end:'أرسل موقعك الحالي لإنهاء الوردية.',trip_start:'أرسل موقع بداية الرحلة.',trip_end:'أرسل موقع نهاية الرحلة.',fuel:'أرسل موقع محطة الوقود قبل تصوير العداد.',location_update:'أرسل موقعك الحالي لتحديث الحركة.'};
  return sendMessage(message.chat.id,labels[action]||'أرسل موقعك الحالي.',locationReplyMarkup());
}
export async function handleAttendanceLocation(message,identity,session){
  const location=message.location;if(!location)return false;
  if(message.chat?.type!=='private')return false;
  const live=Boolean(location.live_period||message.edit_date);
  if(live&&DRIVER_ROLES.has(identity?.role||'')){
    const saved=await saveDriverEvent(message,identity,'location_update',{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,note:'تحديث من مشاركة موقع مباشر'});
    if(!message.edit_date)await sendMessage(message.chat.id,`بدأ تسجيل الموقع المباشر. المرجع الأول: <b>${esc(saved.reference)}</b>.`,{reply_markup:{remove_keyboard:true}});
    return true;
  }
  if(session?.state!=='attendance_location')return false;
  const action=session.context?.action;
  if(action==='check_in'||action==='check_out'){
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    await saveAttendance(message,identity,action,location);return true;
  }
  if(['shift_start','shift_end','location_update'].includes(action)){
    const saved=await saveDriverEvent(message,identity,action,{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null});
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    await sendMessage(message.chat.id,`تم تسجيل <b>${EVENT_LABEL[action]}</b>.\nالمرجع: <b>${esc(saved.reference)}</b>\nالمركبة المرتبطة: <b>${esc(assignedVehicle(saved.assignment)||'غير محددة')}</b>`,{reply_markup:{remove_keyboard:true}});return true;
  }
  if(action==='trip_start'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_trip_destination',{location,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,'اكتب الوجهة أو اسم العميل ورقم أمر البيع.',{reply_markup:{remove_keyboard:true}});return true;
  }
  if(action==='trip_end'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_trip_end_odometer',{location,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,'اكتب قراءة العداد عند نهاية الرحلة.',{reply_markup:{remove_keyboard:true}});return true;
  }
  if(action==='fuel'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_odometer',{location,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,'اكتب قراءة العداد الحالية بالأرقام.',{reply_markup:{remove_keyboard:true}});return true;
  }
  return false;
}
export async function continueAttendanceSession(message,identity,session,text){
  const state=String(session?.state||''),value=String(text||'').trim();
  if(!state.startsWith('driver_')&&!state.startsWith('attendance_'))return false;
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء العملية.',{reply_markup:{remove_keyboard:true}});return true;}
  if(state==='driver_trip_destination'){
    const location=session.context?.location||{},saved=await saveDriverEvent(message,identity,'trip_start',{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,destination:value});
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    await sendMessage(message.chat.id,`تم بدء الرحلة.\nالمرجع: <b>${esc(saved.reference)}</b>\nالوجهة: <b>${esc(value)}</b>`);return true;
  }
  if(state==='driver_trip_end_odometer'){
    const odometer=numberFrom(value);if(!odometer)return sendMessage(message.chat.id,'اكتب قراءة عداد صحيحة.').then(()=>true);
    const location=session.context?.location||{},saved=await saveDriverEvent(message,identity,'trip_end',{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,odometer});
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    await sendMessage(message.chat.id,`تم إنهاء الرحلة.\nالمرجع: <b>${esc(saved.reference)}</b>\nقراءة العداد: <b>${odometer}</b>`);return true;
  }
  if(state==='driver_fuel_odometer'){
    const odometer=numberFrom(value);if(!odometer)return sendMessage(message.chat.id,'اكتب قراءة عداد صحيحة.').then(()=>true);
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_photo',{...session.context,odometer});
    await sendMessage(message.chat.id,'صوّر شاشة العداد أو لوحة العدادات الآن وأرسل الصورة.');return true;
  }
  if(state==='driver_fuel_liters'){
    const liters=numberFrom(value);if(!liters)return sendMessage(message.chat.id,'اكتب عدد اللترات بالأرقام.').then(()=>true);
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_amount',{...session.context,liters});
    await sendMessage(message.chat.id,'اكتب قيمة التعبئة الإجمالية بالريال.');return true;
  }
  if(state==='driver_fuel_amount'){
    const amount=numberFrom(value);if(!amount)return sendMessage(message.chat.id,'اكتب قيمة صحيحة.').then(()=>true);
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_station',{...session.context,amount});
    await sendMessage(message.chat.id,'اكتب اسم محطة الوقود.');return true;
  }
  if(state==='driver_fuel_station'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_note',{...session.context,station:value});
    await sendMessage(message.chat.id,'اكتب رقم الفاتورة أو أي ملاحظة، أو اكتب «لا يوجد».');return true;
  }
  if(state==='driver_fuel_note'){
    const reference=await nextEnterpriseReference('FUL'),data={...session.context,note:value,reference};
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_confirm',{data});
    await sendMessage(message.chat.id,`<b>مراجعة تعبئة الديزل</b>\n\nالعداد: <b>${data.odometer}</b>\nاللترات: <b>${data.liters}</b>\nالقيمة: <b>${data.amount} ر.س</b>\nالمحطة: <b>${esc(data.station)}</b>\nالملاحظة: ${esc(data.note)}\n\nالصورة محفوظة.`,keyboard([[{text:'تأكيد التعبئة',callback_data:`fuelconfirm:${reference}`},{text:'إلغاء',callback_data:`fuelcancel:${reference}`}]]));return true;
  }
  return false;
}
export async function handleAttendancePhoto(message,identity,session){
  if(session?.state!=='driver_fuel_photo'||!message.photo?.length)return false;
  const photo=message.photo.at(-1),downloaded=await downloadTelegramFile(photo.file_id),hash=sha256(downloaded.buffer),path=`telegram/fuel/${new Date().toISOString().slice(0,10)}/odometer-${hash.slice(0,20)}.jpg`;
  await uploadObject(path,downloaded.buffer,downloaded.contentType||'image/jpeg');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_liters',{...session.context,odometer_photo_path:path});
  await sendMessage(message.chat.id,'تم حفظ صورة العداد. اكتب كمية الديزل باللتر.');return true;
}
export async function handleAttendanceCallback(message,from,identity,action,value){
  if(action==='att')return startAttendanceAction({...message,from},identity,value);
  if(action==='fuelcancel'){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);return sendMessage(message.chat.id,'تم إلغاء تسجيل التعبئة.');}
  if(action==='fuelconfirm'){
    const session=await getEnterpriseSession(message.chat.id,identity.external_id||from.id),data=session?.context?.data;
    if(session?.state!=='driver_fuel_confirm'||!data||String(data.reference)!==String(value))return sendMessage(message.chat.id,'انتهت جلسة التأكيد. ابدأ تسجيل التعبئة من جديد.');
    const location=data.location||{},assignment=await assignmentFor(identity);
    await insert('driver_events',[{reference_no:data.reference,app_user_id:identity.user_id,employee_external_id:assignment?.employee_external_id||identity.employee_external_id||null,vehicle_external_id:assignedVehicle(assignment)||null,event_type:'fuel_complete',latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,odometer:Number(data.odometer),fuel_liters:Number(data.liters),fuel_amount:Number(data.amount),station_name:data.station,odometer_photo_path:data.odometer_photo_path,note:data.note,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id),occurred_at:new Date().toISOString()}]);
    await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);
    return sendMessage(message.chat.id,`تم تسجيل تعبئة الديزل رسميًا.\nالمرجع: <b>${esc(data.reference)}</b>\nالمركبة: <b>${esc(assignedVehicle(assignment)||'غير مرتبطة بعد')}</b>\nاللترات: <b>${data.liters}</b>\nالقيمة: <b>${data.amount} ر.س</b>.`);
  }
  return false;
}
export async function sendMyAttendance(chatId,identity){
  const today=new Date().toISOString().slice(0,10),rows=await select('attendance_events',`app_user_id=eq.${identity.user_id}&occurred_at=gte.${today}T00:00:00Z&select=reference_no,event_type,occurred_at,distance_from_site_m,within_geofence,work_sites(name)&order=occurred_at.asc&limit=50`);
  if(!rows?.length)return sendMessage(chatId,'لا توجد حركات حضور أو انصراف مسجلة لك اليوم.');
  return sendMessage(chatId,`<b>حضوري اليوم</b>\n\n${rows.map(row=>`• ${EVENT_LABEL[row.event_type]||row.event_type} — ${new Date(row.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})}\n  ${esc(row.work_sites?.name||'بلا موقع معين')}${row.distance_from_site_m!=null?` — ${Math.round(row.distance_from_site_m)}م — ${row.within_geofence?'داخل النطاق':'خارج النطاق'}`:''}`).join('\n\n')}`);
}
export async function sendAttendanceReport(chatId,identity){
  if(!MANAGER_ROLES.has(identity?.role||''))return sendMessage(chatId,'تقرير الحضور متاح للإدارة والموارد البشرية.');
  const today=new Date().toISOString().slice(0,10),rows=await select('attendance_events',`occurred_at=gte.${today}T00:00:00Z&select=reference_no,event_type,occurred_at,within_geofence,distance_from_site_m,app_users(full_name,role),work_sites(name)&order=occurred_at.asc&limit=1000`),byUser=new Map();
  for(const row of rows||[]){const name=row.app_users?.full_name||'موظف',entry=byUser.get(name)||{name,events:[],outside:0};entry.events.push(row);if(row.within_geofence===false)entry.outside++;byUser.set(name,entry);}
  if(!byUser.size)return sendMessage(chatId,'لا توجد تسجيلات حضور اليوم.');
  return sendMessage(chatId,`<b>تقرير الحضور اليوم</b>\n\n${[...byUser.values()].map(entry=>{const first=entry.events.find(row=>row.event_type==='check_in'),last=[...entry.events].reverse().find(row=>row.event_type==='check_out');return `• <b>${esc(entry.name)}</b>\n  حضور: ${first?new Date(first.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'}):'لم يسجل'} — انصراف: ${last?new Date(last.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'}):'لم يسجل'}${entry.outside?`\n  خارج النطاق: ${entry.outside}`:''}`;}).join('\n\n')}`.slice(0,3900));
}
export async function sendDriverMovementReport(chatId,identity,allDrivers=false){
  if(allDrivers&&!MANAGER_ROLES.has(identity?.role||''))return sendMessage(chatId,'تقرير جميع السائقين متاح للإدارة والموارد البشرية.');
  const today=new Date().toISOString().slice(0,10),filter=allDrivers?'':`app_user_id=eq.${identity.user_id}&`,rows=await select('driver_events',`${filter}occurred_at=gte.${today}T00:00:00Z&select=reference_no,event_type,vehicle_external_id,latitude,longitude,odometer,fuel_liters,fuel_amount,station_name,destination,note,occurred_at,app_users(full_name)&order=occurred_at.asc&limit=1500`);
  if(!rows?.length)return sendMessage(chatId,allDrivers?'لا توجد حركة مسجلة للسائقين اليوم.':'لا توجد حركة مسجلة لك اليوم.');
  const groups=new Map();for(const row of rows){const name=allDrivers?(row.app_users?.full_name||'سائق'):'حركتي',entry=groups.get(name)||[];entry.push(row);groups.set(name,entry);}
  let text=`<b>${allDrivers?'تقرير حركة السائقين':'تقرير حركتي اليوم'}</b>`;
  for(const [name,events] of groups){const fuel=events.filter(row=>row.event_type==='fuel_complete'),locations=events.filter(row=>row.latitude!=null),trips=events.filter(row=>row.event_type==='trip_start').length;text+=`\n\n<b>${esc(name)}</b>\nالمركبة: ${esc(events.find(row=>row.vehicle_external_id)?.vehicle_external_id||'غير محددة')}\nالرحلات: ${trips} — تحديثات الموقع: ${locations.length} — تعبئات: ${fuel.length} — ديزل: ${fuel.reduce((sum,row)=>sum+Number(row.fuel_liters||0),0)} لتر\n${events.slice(-6).map(row=>`• ${EVENT_LABEL[row.event_type]||row.event_type} ${new Date(row.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})}${row.destination?` — ${esc(row.destination)}`:''}${row.latitude!=null?`\n  https://maps.google.com/?q=${row.latitude},${row.longitude}`:''}`).join('\n')}`;}
  return sendMessage(chatId,text.slice(0,3900));
}
