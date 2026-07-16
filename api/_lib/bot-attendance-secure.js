import { sendMessage } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import * as attendance from './bot-attendance.js';

const ATTENDANCE_ROLES=new Set(['admin','manager','hr','driver','employee','mechanic','accountant','block_sales','concrete_sales','collector','warehouse','fuel_operator','procurement','quality']);
const DRIVER_ROLES=new Set(['admin','manager','driver','mechanic','fuel_operator']);
const MANAGER_ROLES=new Set(['admin','manager','hr']);
const active=identity=>Boolean(identity?.active);
const canAttend=identity=>active(identity)&&ATTENDANCE_ROLES.has(identity.role);
const canDrive=identity=>active(identity)&&DRIVER_ROLES.has(identity.role);
async function deny(message,identity,text='لا تملك صلاحية تنفيذ هذه الحركة.'){
  await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from?.id).catch(()=>{});
  return sendMessage(message.chat.id,text,{reply_markup:{remove_keyboard:true}});
}
function requiresDriverAction(action){return['shift_start','shift_end','trip_start','trip_end','fuel','location_update','live_help','my_movement'].includes(action);}

export const attendanceMenu=attendance.attendanceMenu;
export async function showAttendanceMenu(message,identity){return canAttend(identity)?attendance.showAttendanceMenu(message,identity):deny(message,identity,'دورك الحالي لا يشمل الحضور أو حركة السائق.');}
export async function startAttendanceAction(message,identity,action){
  if(!canAttend(identity))return deny(message,identity);
  if(requiresDriverAction(action)&&!canDrive(identity))return deny(message,identity,'هذه الحركة متاحة للسائق ومسؤول الديزل والورشة والإدارة.');
  if(['attendance_report','movement_report'].includes(action)&&!MANAGER_ROLES.has(identity.role))return deny(message,identity,'التقرير الكامل متاح للإدارة والموارد البشرية.');
  return attendance.startAttendanceAction(message,identity,action);
}
export async function continueAttendanceSession(message,identity,session,text){
  const state=String(session?.state||'');
  if(state.startsWith('driver_')&&!canDrive(identity))return deny(message,identity,'تم إيقاف الجلسة لأن صلاحية حركة السائق غير متاحة.').then(()=>true);
  if(state.startsWith('attendance_')&&!canAttend(identity))return deny(message,identity).then(()=>true);
  return attendance.continueAttendanceSession(message,identity,session,text);
}
export async function handleAttendanceLocation(message,identity,session){
  const state=String(session?.state||''),live=Boolean(message.location?.live_period||message.edit_date);
  if((live||state.startsWith('driver_')||['shift_start','shift_end','trip_start','trip_end','fuel','location_update'].includes(session?.context?.action))&&!canDrive(identity))return deny(message,identity,'تم رفض الموقع لأن دورك لا يسمح بحركة السائق.').then(()=>true);
  if(state.startsWith('attendance_')&&!canAttend(identity))return deny(message,identity).then(()=>true);
  return attendance.handleAttendanceLocation(message,identity,session);
}
export async function handleAttendancePhoto(message,identity,session){
  if(session?.state==='driver_fuel_photo'&&!canDrive(identity))return deny(message,identity,'تم رفض الصورة لأن صلاحية الديزل غير متاحة.').then(()=>true);
  return attendance.handleAttendancePhoto(message,identity,session);
}
export async function handleAttendanceCallback(message,from,identity,action,value){
  if(action==='att')return startAttendanceAction({...message,from},identity,value);
  if(['fuelconfirm','fuelcancel'].includes(action)&&!canDrive(identity))return deny({...message,from},identity,'تم رفض الإجراء لأن صلاحية الديزل غير متاحة.');
  return attendance.handleAttendanceCallback(message,from,identity,action,value);
}
export async function sendMyAttendance(chatId,identity){return canAttend(identity)?attendance.sendMyAttendance(chatId,identity):sendMessage(chatId,'ليست لديك صلاحية عرض الحضور.');}
export async function sendAttendanceReport(chatId,identity){return MANAGER_ROLES.has(identity?.role)&&active(identity)?attendance.sendAttendanceReport(chatId,identity):sendMessage(chatId,'التقرير متاح للإدارة والموارد البشرية.');}
export async function sendDriverMovementReport(chatId,identity,allDrivers=false){
  if(allDrivers)return MANAGER_ROLES.has(identity?.role)&&active(identity)?attendance.sendDriverMovementReport(chatId,identity,true):sendMessage(chatId,'تقرير جميع السائقين متاح للإدارة والموارد البشرية.');
  return canDrive(identity)?attendance.sendDriverMovementReport(chatId,identity,false):sendMessage(chatId,'ليست لديك صلاحية عرض حركة السائق.');
}
