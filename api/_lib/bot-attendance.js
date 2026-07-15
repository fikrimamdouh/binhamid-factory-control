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
const I18N={
  ar:{title:'الحضور والمواقع والحركة',intro:'اختر العملية المطلوبة. الحضور والانصراف يقرآن GPS الحالي مباشرة دون خريطة أو اختيار موقع.',checkIn:'تسجيل حضور',checkOut:'تسجيل انصراف',my:'حضوري اليوم',openIn:'فتح شاشة الحضور',openOut:'فتح شاشة الانصراف',private:'افتح الحضور من المحادثة الخاصة لحماية بيانات الموقع.',driver:'حركة السائق',attendance:'الحضور'},
  en:{title:'Attendance, Location & Movement',intro:'Choose an action. Check-in and check-out read the current GPS directly, with no map or manual location selection.',checkIn:'Check In',checkOut:'Check Out',my:'My attendance today',openIn:'Open check-in screen',openOut:'Open check-out screen',private:'Open attendance in the private bot chat to protect location data.',driver:'Driver movement',attendance:'Attendance'},
  hi:{title:'उपस्थिति, स्थान और वाहन गतिविधि',intro:'कार्य चुनें। उपस्थिति और प्रस्थान वर्तमान GPS को सीधे पढ़ते हैं; नक्शा या मैनुअल स्थान चयन नहीं है।',checkIn:'उपस्थिति',checkOut:'प्रस्थान',my:'आज की उपस्थिति',openIn:'उपस्थिति स्क्रीन खोलें',openOut:'प्रस्थान स्क्रीन खोलें',private:'स्थान की सुरक्षा के लिए निजी बॉट चैट में उपस्थिति खोलें।',driver:'ड्राइवर गतिविधि',attendance:'उपस्थिति'},
  bn:{title:'উপস্থিতি, অবস্থান ও যানবাহন চলাচল',intro:'একটি কাজ নির্বাচন করুন। উপস্থিতি ও প্রস্থান সরাসরি বর্তমান GPS পড়ে; কোনো মানচিত্র বা হাতে স্থান নির্বাচন নেই।',checkIn:'উপস্থিতি',checkOut:'প্রস্থান',my:'আজকের উপস্থিতি',openIn:'উপস্থিতি স্ক্রিন খুলুন',openOut:'প্রস্থান স্ক্রিন খুলুন',private:'অবস্থানের নিরাপত্তার জন্য ব্যক্তিগত বট চ্যাটে উপস্থিতি খুলুন।',driver:'চালকের চলাচল',attendance:'উপস্থিতি'},
  ur:{title:'حاضری، مقام اور گاڑی کی حرکت',intro:'عمل منتخب کریں۔ حاضری اور روانگی موجودہ GPS کو براہ راست پڑھتی ہیں؛ نقشہ یا دستی مقام انتخاب نہیں۔',checkIn:'حاضری',checkOut:'روانگی',my:'آج کی حاضری',openIn:'حاضری اسکرین کھولیں',openOut:'روانگی اسکرین کھولیں',private:'مقام کی حفاظت کے لیے نجی بوٹ چیٹ میں حاضری کھولیں۔',driver:'ڈرائیور کی حرکت',attendance:'حاضری'}
};
function languageOf(from){const code=String(from?.language_code||'').slice(0,2).toLowerCase();return I18N[code]?code:'en';}
function tr(from){return I18N[languageOf(from)];}
function locationReplyMarkup(label='إرسال موقعي الحالي'){
  return{reply_markup:{keyboard:[[{text:label,request_location:true}],[{text:'إلغاء'}]],resize_keyboard:true,one_time_keyboard:true,selective:true}};
}
function baseUrl(){
  let value=String(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL||'https://binhamid-factory-control.vercel.app').trim().replace(/\/$/,'');
  if(!/^https?:\/\//i.test(value))value=`https://${value}`;
  return value;
}
function attendancePage(eventType){return `${baseUrl()}/attendance.html?event=${encodeURIComponent(eventType)}`;}
function privateBotUrl(){return `https://t.me/${String(process.env.TELEGRAM_BOT_USERNAME||'BinHamidFactoryControlBot').replace(/^@/,'')}?start=attendance`;}
function privateOnly(message){
  if(message.chat?.type==='private')return false;
  const x=tr(message.from);
  sendMessage(message.chat.id,x.private,keyboard([[{text:x.attendance,url:privateBotUrl()}]]));
  return true;
}
async function assignmentFor(identity){
  if(!identity?.user_id)return null;
  return(await select('employee_assignments',`app_user_id=eq.${identity.user_id}&active=eq.true&select=*,work_sites(id,code,name,address,latitude,longitude,radius_m)&limit=1`))?.[0]||null;
}
function assignedVehicle(assignment){return String(assignment?.vehicle_external_id||'').trim();}
async function saveDriverEvent(message,identity,eventType,values={}){
  const assignment=await assignmentFor(identity),reference=await nextEnterpriseReference('DRV');
  const row={reference_no:reference,app_user_id:identity.user_id,employee_external_id:assignment?.employee_external_id||identity.employee_external_id||null,vehicle_external_id:values.vehicle_external_id||assignedVehicle(assignment)||null,event_type:eventType,latitude:values.latitude??null,longitude:values.longitude??null,horizontal_accuracy_m:values.horizontal_accuracy_m??null,odometer:values.odometer??null,fuel_liters:values.fuel_liters??null,fuel_amount:values.fuel_amount??null,station_name:values.station_name||null,destination:values.destination||null,odometer_photo_path:values.odometer_photo_path||null,receipt_photo_path:values.receipt_photo_path||null,note:values.note||null,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id),occurred_at:new Date((message.date||Date.now()/1000)*1000).toISOString()};
  await insert('driver_events',[row]);
  return{reference,row,assignment};
}
export function attendanceMenu(identity,from={}){
  const role=identity?.role||'pending',x=tr(from),rows=[];
  if(ATTENDANCE_ROLES.has(role))rows.push([{text:`✅ ${x.checkIn}`,callback_data:'att:check_in'},{text:`⏹ ${x.checkOut}`,callback_data:'att:check_out'}]);
  rows.push([{text:`📋 ${x.my}`,callback_data:'att:my_attendance'}]);
  if(DRIVER_ROLES.has(role)){
    rows.push([{text:'🚚 بدء الوردية / Start shift',callback_data:'att:shift_start'},{text:'🏁 إنهاء الوردية / End shift',callback_data:'att:shift_end'}]);
    rows.push([{text:'▶️ بدء رحلة / Start trip',callback_data:'att:trip_start'},{text:'⏹ إنهاء رحلة / End trip',callback_data:'att:trip_end'}]);
    rows.push([{text:'⛽ ديزل + عداد / Fuel',callback_data:'att:fuel'},{text:'📍 موقعي / My location',callback_data:'att:location_update'}]);
    rows.push([{text:'🛰 موقع مباشر / Live location',callback_data:'att:live_help'},{text:'📊 حركتي / Movement',callback_data:'att:my_movement'}]);
  }
  if(MANAGER_ROLES.has(role))rows.push([{text:'👥 تقرير الحضور',callback_data:'att:attendance_report'},{text:'🚛 تقرير حركة السائقين',callback_data:'att:movement_report'}]);
  return keyboard(rows);
}
export async function showAttendanceMenu(message,identity){
  if(!ATTENDANCE_ROLES.has(identity?.role||''))return sendMessage(message.chat.id,'Your role does not include attendance or movement tracking.');
  const x=tr(message.from);
  return sendMessage(message.chat.id,`<b>${x.title}</b>\n${esc(displayName(identity,message.from))} — ${x.intro}`,attendanceMenu(identity,message.from));
}
export async function startAttendanceAction(message,identity,action){
  if(!ATTENDANCE_ROLES.has(identity?.role||''))return sendMessage(message.chat.id,'You do not have permission for attendance or movement.');
  if(privateOnly(message))return;
  const x=tr(message.from);
  if(action==='check_in'||action==='check_out'){
    const label=action==='check_in'?x.openIn:x.openOut;
    return sendMessage(message.chat.id,`${label}. GPS will be read automatically. No map or manual location selection is available.`,{reply_markup:{inline_keyboard:[[{text:label,web_app:{url:attendancePage(action)}}]]}});
  }
  if(action==='my_attendance')return sendMyAttendance(message.chat.id,identity);
  if(action==='my_movement')return sendDriverMovementReport(message.chat.id,identity,false);
  if(action==='attendance_report')return sendAttendanceReport(message.chat.id,identity);
  if(action==='movement_report')return sendDriverMovementReport(message.chat.id,identity,true);
  if(action==='live_help')return sendMessage(message.chat.id,'From Telegram attachments choose Location, then Share Live Location. The bot will save movement updates until you stop sharing.');
  const requiresDriver=['shift_start','shift_end','trip_start','trip_end','fuel','location_update'];
  if(requiresDriver.includes(action)&&!DRIVER_ROLES.has(identity.role))return sendMessage(message.chat.id,'This action is for drivers and fleet/workshop operators.');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'attendance_location',{action,startedAt:new Date().toISOString()});
  const labels={shift_start:'Send current location to start the shift.',shift_end:'Send current location to end the shift.',trip_start:'Send the trip start location.',trip_end:'Send the trip end location.',fuel:'Send the fuel-station location before the odometer photo.',location_update:'Send your current location.'};
  return sendMessage(message.chat.id,labels[action]||'Send your current location.',locationReplyMarkup('📍 Send current location'));
}
export async function handleAttendanceLocation(message,identity,session){
  const location=message.location;if(!location)return false;
  if(message.chat?.type!=='private')return false;
  const live=Boolean(location.live_period||message.edit_date);
  if(live&&DRIVER_ROLES.has(identity?.role||'')){
    const saved=await saveDriverEvent(message,identity,'location_update',{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,note:'Live-location update'});
    if(!message.edit_date)await sendMessage(message.chat.id,`Live location tracking started. First reference: <b>${esc(saved.reference)}</b>.`,{reply_markup:{remove_keyboard:true}});
    return true;
  }
  if(session?.state!=='attendance_location')return false;
  const action=session.context?.action;
  if(action==='check_in'||action==='check_out'){
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    const x=tr(message.from),label=action==='check_in'?x.openIn:x.openOut;
    await sendMessage(message.chat.id,'Manual Telegram locations are not accepted for attendance. Use the secure GPS screen.',{reply_markup:{inline_keyboard:[[{text:label,web_app:{url:attendancePage(action)}}]]}});return true;
  }
  if(['shift_start','shift_end','location_update'].includes(action)){
    const saved=await saveDriverEvent(message,identity,action,{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null});
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    await sendMessage(message.chat.id,`Recorded: <b>${EVENT_LABEL[action]}</b>.\nReference: <b>${esc(saved.reference)}</b>\nAssigned vehicle: <b>${esc(assignedVehicle(saved.assignment)||'Not assigned')}</b>`,{reply_markup:{remove_keyboard:true}});return true;
  }
  if(action==='trip_start'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_trip_destination',{location,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,'Enter destination, customer, or sales-order number.',{reply_markup:{remove_keyboard:true}});return true;
  }
  if(action==='trip_end'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_trip_end_odometer',{location,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,'Enter the odometer reading at trip end.',{reply_markup:{remove_keyboard:true}});return true;
  }
  if(action==='fuel'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_odometer',{location,startedAt:new Date().toISOString()});
    await sendMessage(message.chat.id,'Enter the current odometer reading.',{reply_markup:{remove_keyboard:true}});return true;
  }
  return false;
}
export async function continueAttendanceSession(message,identity,session,text){
  const state=String(session?.state||''),value=String(text||'').trim();
  if(!state.startsWith('driver_')&&!state.startsWith('attendance_'))return false;
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'Operation cancelled.',{reply_markup:{remove_keyboard:true}});return true;}
  if(state==='driver_trip_destination'){
    const location=session.context?.location||{},saved=await saveDriverEvent(message,identity,'trip_start',{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,destination:value});
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    await sendMessage(message.chat.id,`Trip started.\nReference: <b>${esc(saved.reference)}</b>\nDestination: <b>${esc(value)}</b>`);return true;
  }
  if(state==='driver_trip_end_odometer'){
    const odometer=numberFrom(value);if(!odometer)return sendMessage(message.chat.id,'Enter a valid odometer reading.').then(()=>true);
    const location=session.context?.location||{},saved=await saveDriverEvent(message,identity,'trip_end',{latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,odometer});
    await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
    await sendMessage(message.chat.id,`Trip ended.\nReference: <b>${esc(saved.reference)}</b>\nOdometer: <b>${odometer}</b>`);return true;
  }
  if(state==='driver_fuel_odometer'){
    const odometer=numberFrom(value);if(!odometer)return sendMessage(message.chat.id,'Enter a valid odometer reading.').then(()=>true);
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_photo',{...session.context,odometer});
    await sendMessage(message.chat.id,'Take a photo of the odometer/dashboard now and send it.');return true;
  }
  if(state==='driver_fuel_liters'){
    const liters=numberFrom(value);if(!liters)return sendMessage(message.chat.id,'Enter fuel litres as a number.').then(()=>true);
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_amount',{...session.context,liters});
    await sendMessage(message.chat.id,'Enter the total fuel amount in SAR.');return true;
  }
  if(state==='driver_fuel_amount'){
    const amount=numberFrom(value);if(!amount)return sendMessage(message.chat.id,'Enter a valid amount.').then(()=>true);
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_station',{...session.context,amount});
    await sendMessage(message.chat.id,'Enter the fuel-station name.');return true;
  }
  if(state==='driver_fuel_station'){
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_note',{...session.context,station:value});
    await sendMessage(message.chat.id,'Enter invoice number or a note, or write none.');return true;
  }
  if(state==='driver_fuel_note'){
    const reference=await nextEnterpriseReference('FUL'),data={...session.context,note:value,reference};
    await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_confirm',{data});
    await sendMessage(message.chat.id,`<b>Fuel entry review</b>\n\nOdometer: <b>${data.odometer}</b>\nLitres: <b>${data.liters}</b>\nAmount: <b>${data.amount} SAR</b>\nStation: <b>${esc(data.station)}</b>\nNote: ${esc(data.note)}\n\nOdometer photo saved.`,keyboard([[{text:'Confirm fuel entry',callback_data:`fuelconfirm:${reference}`},{text:'Cancel',callback_data:`fuelcancel:${reference}`}]]));return true;
  }
  return false;
}
export async function handleAttendancePhoto(message,identity,session){
  if(session?.state!=='driver_fuel_photo'||!message.photo?.length)return false;
  const photo=message.photo.at(-1),downloaded=await downloadTelegramFile(photo.file_id),hash=sha256(downloaded.buffer),path=`telegram/fuel/${new Date().toISOString().slice(0,10)}/odometer-${hash.slice(0,20)}.jpg`;
  await uploadObject(path,downloaded.buffer,downloaded.contentType||'image/jpeg');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'driver_fuel_liters',{...session.context,odometer_photo_path:path});
  await sendMessage(message.chat.id,'Odometer photo saved. Enter fuel litres.');return true;
}
export async function handleAttendanceCallback(message,from,identity,action,value){
  if(action==='att')return startAttendanceAction({...message,from},identity,value);
  if(action==='fuelcancel'){await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);return sendMessage(message.chat.id,'Fuel entry cancelled.');}
  if(action==='fuelconfirm'){
    const session=await getEnterpriseSession(message.chat.id,identity.external_id||from.id),data=session?.context?.data;
    if(session?.state!=='driver_fuel_confirm'||!data||String(data.reference)!==String(value))return sendMessage(message.chat.id,'Confirmation session expired. Start fuel entry again.');
    const location=data.location||{},assignment=await assignmentFor(identity);
    await insert('driver_events',[{reference_no:data.reference,app_user_id:identity.user_id,employee_external_id:assignment?.employee_external_id||identity.employee_external_id||null,vehicle_external_id:assignedVehicle(assignment)||null,event_type:'fuel_complete',latitude:Number(location.latitude),longitude:Number(location.longitude),horizontal_accuracy_m:Number(location.horizontal_accuracy||0)||null,odometer:Number(data.odometer),fuel_liters:Number(data.liters),fuel_amount:Number(data.amount),station_name:data.station,odometer_photo_path:data.odometer_photo_path,note:data.note,source_chat_id:String(message.chat.id),source_message_id:String(message.message_id),occurred_at:new Date().toISOString()}]);
    await clearMaintenanceSession(message.chat.id,identity.external_id||from.id);
    return sendMessage(message.chat.id,`Fuel entry recorded.\nReference: <b>${esc(data.reference)}</b>\nVehicle: <b>${esc(assignedVehicle(assignment)||'Not assigned')}</b>\nLitres: <b>${data.liters}</b>\nAmount: <b>${data.amount} SAR</b>.`);
  }
  return false;
}
export async function sendMyAttendance(chatId,identity){
  const today=new Date().toISOString().slice(0,10),rows=await select('attendance_events',`app_user_id=eq.${identity.user_id}&occurred_at=gte.${today}T00:00:00Z&select=reference_no,event_type,occurred_at,distance_from_site_m,within_geofence,work_sites(name)&order=occurred_at.asc&limit=50`);
  if(!rows?.length)return sendMessage(chatId,'No attendance events recorded today.');
  return sendMessage(chatId,`<b>Attendance today</b>\n\n${rows.map(row=>`• ${EVENT_LABEL[row.event_type]||row.event_type} — ${new Date(row.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})}\n  ${esc(row.work_sites?.name||'No assigned site')} — ${row.within_geofence?'Accepted':'Outside range / not accepted'}${row.distance_from_site_m!=null?` — ${Math.round(row.distance_from_site_m)}m`:''}`).join('\n\n')}`);
}
export async function sendAttendanceReport(chatId,identity){
  if(!MANAGER_ROLES.has(identity?.role||''))return sendMessage(chatId,'Attendance report is available to management and HR.');
  const today=new Date().toISOString().slice(0,10),rows=await select('attendance_events',`occurred_at=gte.${today}T00:00:00Z&select=reference_no,event_type,occurred_at,within_geofence,distance_from_site_m,app_users(full_name,role),work_sites(name)&order=occurred_at.asc&limit=1000`),byUser=new Map();
  for(const row of rows||[]){const name=row.app_users?.full_name||'Employee',entry=byUser.get(name)||{name,events:[],outside:0};entry.events.push(row);if(row.within_geofence===false)entry.outside++;byUser.set(name,entry);}
  if(!byUser.size)return sendMessage(chatId,'No attendance events today.');
  return sendMessage(chatId,`<b>Attendance report today</b>\n\n${[...byUser.values()].map(entry=>{const accepted=entry.events.filter(row=>row.within_geofence===true),first=accepted.find(row=>row.event_type==='check_in'),last=[...accepted].reverse().find(row=>row.event_type==='check_out');return `• <b>${esc(entry.name)}</b>\n  Check-in: ${first?new Date(first.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'}):'Not recorded'} — Check-out: ${last?new Date(last.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'}):'Not recorded'}${entry.outside?`\n  Outside-range attempts: ${entry.outside}`:''}`;}).join('\n\n')}`.slice(0,3900));
}
export async function sendDriverMovementReport(chatId,identity,allDrivers=false){
  if(allDrivers&&!MANAGER_ROLES.has(identity?.role||''))return sendMessage(chatId,'All-driver movement report is available to management and HR.');
  const today=new Date().toISOString().slice(0,10),filter=allDrivers?'':`app_user_id=eq.${identity.user_id}&`,rows=await select('driver_events',`${filter}occurred_at=gte.${today}T00:00:00Z&select=reference_no,event_type,vehicle_external_id,latitude,longitude,odometer,fuel_liters,fuel_amount,station_name,destination,note,occurred_at,app_users(full_name)&order=occurred_at.asc&limit=1500`);
  if(!rows?.length)return sendMessage(chatId,allDrivers?'No driver movement recorded today.':'No movement recorded for you today.');
  const groups=new Map();for(const row of rows){const name=allDrivers?(row.app_users?.full_name||'Driver'):'My movement',entry=groups.get(name)||[];entry.push(row);groups.set(name,entry);}
  let text=`<b>${allDrivers?'Driver movement report':'My movement today'}</b>`;
  for(const [name,events] of groups){const fuel=events.filter(row=>row.event_type==='fuel_complete'),locations=events.filter(row=>row.latitude!=null),trips=events.filter(row=>row.event_type==='trip_start').length;text+=`\n\n<b>${esc(name)}</b>\nVehicle: ${esc(events.find(row=>row.vehicle_external_id)?.vehicle_external_id||'Not assigned')}\nTrips: ${trips} — Location updates: ${locations.length} — Fuel entries: ${fuel.length} — Diesel: ${fuel.reduce((sum,row)=>sum+Number(row.fuel_liters||0),0)} L\n${events.slice(-6).map(row=>`• ${EVENT_LABEL[row.event_type]||row.event_type} ${new Date(row.occurred_at).toLocaleTimeString('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit'})}${row.destination?` — ${esc(row.destination)}`:''}${row.latitude!=null?`\n  https://maps.google.com/?q=${row.latitude},${row.longitude}`:''}`).join('\n')}`;}
  return sendMessage(chatId,text.slice(0,3900));
}
