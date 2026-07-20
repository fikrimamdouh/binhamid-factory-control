import { sendMessage, keyboard } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { displayName } from './bot-profile.js';
import * as mechanic from './bot-mechanic.js';

const VIEW_ROLES=new Set(['admin','manager','mechanic','accountant']);
const OPERATOR_ROLES=new Set(['admin','mechanic']);
const active=identity=>Boolean(identity?.active);
const canView=identity=>active(identity)&&VIEW_ROLES.has(identity.role);
const canOperate=identity=>active(identity)&&OPERATOR_ROLES.has(identity.role);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function deny(message,identity,text='تسجيل أعمال الورشة متاح لمسؤول الورشة ومدير النظام فقط.'){
  await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from?.id).catch(()=>{});
  return sendMessage(message.chat.id,text);
}

export function mechanicMenu(){return keyboard([
  [{text:'📝 التقرير اليومي',callback_data:'mech:daily'},{text:'🔍 فحص معدة أو أصل',callback_data:'mech:inspection'}],
  [{text:'🧰 طلب قطع غيار',callback_data:'mech:parts'},{text:'🔧 بلاغ أصل بدون لوحة',callback_data:'mech:general_fault'}],
  [{text:'📌 تحديث أمر إصلاح',callback_data:'mech:update'},{text:'📋 المهام المفتوحة',callback_data:'mech:tasks'}],
  [{text:'🔎 بحث سعر قطعة',callback_data:'proc:product'},{text:'📷 بحث بصورة القطعة',callback_data:'proc:product_image'}],
  [{text:'🏪 بحث عن قطعة أو مورد',callback_data:'proc:search'},{text:'🧾 طلب عرض سعر',callback_data:'proc:rfq'}],
  [{text:'📋 عروض الأسعار المفتوحة',callback_data:'proc:open'},{text:'💰 طلبات تسعير الورشة',callback_data:'mech:price_requests'}],
  [{text:'📊 سجل الورشة اليوم',callback_data:'mech:summary'}]
]);}
export async function showMechanicMenu(message,identity){
  if(!canView(identity))return deny(message,identity,'قائمة الورشة متاحة لمسؤول الورشة والإدارة والمحاسب.');
  const name=displayName(identity,message.from);
  return sendMessage(message.chat.id,`مرحبًا ${esc(name)}. أعمال الورشة وقطع الغيار والمنتجات والأسعار أصبحت في قائمة واحدة. اختر العملية المطلوبة:`,mechanicMenu());
}
export async function startMechanicAction(message,identity,action){
  if(['tasks','summary','price_requests'].includes(action))return canView(identity)?mechanic.startMechanicAction(message,identity,action):deny(message,identity,'ليست لديك صلاحية عرض سجل الورشة.');
  return canOperate(identity)?mechanic.startMechanicAction(message,identity,action):deny(message,identity);
}
export async function continueMechanicSession(message,identity,session,text){
  if(!canOperate(identity))return deny(message,identity).then(()=>true);
  return mechanic.continueMechanicSession(message,identity,session,text);
}
export async function handleMechanicTextCommand(message,identity,text){
  const value=String(text||'').toLowerCase().trim();
  if(/^\/?(?:workshop)?$/i.test(value)||/^(قائمه الورشه|قائمة الورشة|موظف الورشه|موظف الورشة|مهام الميكانيكي|الورشه|الورشة)$/.test(value)){await showMechanicMenu(message,identity);return true;}
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
