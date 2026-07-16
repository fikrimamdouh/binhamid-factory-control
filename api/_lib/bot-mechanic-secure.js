import { sendMessage } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import * as mechanic from './bot-mechanic.js';

const VIEW_ROLES=new Set(['admin','manager','mechanic','accountant']);
const OPERATOR_ROLES=new Set(['admin','mechanic']);
const active=identity=>Boolean(identity?.active);
const canView=identity=>active(identity)&&VIEW_ROLES.has(identity.role);
const canOperate=identity=>active(identity)&&OPERATOR_ROLES.has(identity.role);
async function deny(message,identity,text='تسجيل أعمال الورشة متاح لمسؤول الورشة ومدير النظام فقط.'){
  await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from?.id).catch(()=>{});
  return sendMessage(message.chat.id,text);
}

export const mechanicMenu=mechanic.mechanicMenu;
export async function showMechanicMenu(message,identity){return canView(identity)?mechanic.showMechanicMenu(message,identity):deny(message,identity,'قائمة الورشة متاحة لمسؤول الورشة والإدارة والمحاسب.');}
export async function startMechanicAction(message,identity,action){
  if(['tasks','summary','price_requests'].includes(action))return canView(identity)?mechanic.startMechanicAction(message,identity,action):deny(message,identity,'ليست لديك صلاحية عرض سجل الورشة.');
  return canOperate(identity)?mechanic.startMechanicAction(message,identity,action):deny(message,identity);
}
export async function continueMechanicSession(message,identity,session,text){
  if(!canOperate(identity))return deny(message,identity).then(()=>true);
  return mechanic.continueMechanicSession(message,identity,session,text);
}
export async function handleMechanicTextCommand(message,identity,text){
  const value=String(text||'').toLowerCase();
  const view=/سجل الورشه|سجل الورشة|مهام الورشه|مهام الورشة|طلبات التسعير/.test(value);
  if(view&&!canView(identity)){await deny(message,identity,'ليست لديك صلاحية عرض سجل الورشة.');return true;}
  const operation=/تقرير يومي للورشه|تقرير يومي للورشة|فحص معده|فحص معدات|طلب قطع غيار|اصل بدون لوحه|أصل بدون لوحة|تحديث امر اصلاح|تحديث أمر إصلاح/.test(value);
  if(operation&&!canOperate(identity)){await deny(message,identity);return true;}
  return mechanic.handleMechanicTextCommand(message,identity,text);
}
export async function confirmSparePartsRequest(message,reference,identity,role){
  if(!canOperate(identity)||role!==identity.role)return deny(message,identity,'تم رفض التأكيد لأن صلاحية الورشة تغيرت.');
  return mechanic.confirmSparePartsRequest(message,reference,identity,role);
}
export const sendOpenWorkshopTasks=mechanic.sendOpenWorkshopTasks;
export const sendWorkshopSummary=mechanic.sendWorkshopSummary;
export const sendPriceRequests=mechanic.sendPriceRequests;
