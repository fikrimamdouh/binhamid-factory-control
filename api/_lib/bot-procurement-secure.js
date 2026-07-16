import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import * as legacy from './bot-procurement.js';

const USE_ROLES=new Set(['admin','manager','accountant','mechanic','procurement','warehouse']);
const CREATE_ROLES=new Set(['admin','manager','mechanic','procurement','warehouse']);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const urgencyLabel=value=>({normal:'عادي',urgent:'عاجل',critical:'حرج'}[value]||value||'عادي');
const canUse=identity=>Boolean(identity?.active&&USE_ROLES.has(identity.role));
const canCreate=identity=>Boolean(identity?.active&&CREATE_ROLES.has(identity.role));
async function deny(message,identity,create=false){
  await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from?.id).catch(()=>{});
  return sendMessage(message.chat.id,create?'إنشاء البحث وطلبات عرض السعر متاح للمشتريات والمخزن والورشة والإدارة.':'عرض الموردين وطلبات الأسعار متاح للمشتريات والمخزن والورشة والإدارة والمحاسب.');
}

export const procurementMenu=legacy.procurementMenu;
export async function showProcurementMenu(message,identity){
  if(!canUse(identity))return deny(message,identity,false);
  return legacy.showProcurementMenu(message,identity);
}
export async function startProcurementAction(message,identity,action){
  if(action==='open')return canUse(identity)?sendOpenQuoteRequests(message.chat.id,identity):deny(message,identity,false);
  if(!canCreate(identity))return deny(message,identity,true);
  return legacy.startProcurementAction(message,identity,action);
}
export async function continueProcurementSession(message,identity,session,text){
  if(!canCreate(identity))return deny(message,identity,true).then(()=>true);
  return legacy.continueProcurementSession(message,identity,session,text);
}
export async function handleProcurementCallback(message,from,identity,action,value){
  const callbackMessage={...message,from};
  if(action==='proc'&&value==='open')return canUse(identity)?sendOpenQuoteRequests(message.chat.id,identity):deny(callbackMessage,identity,false);
  if(!canCreate(identity))return deny(callbackMessage,identity,true);
  return legacy.handleProcurementCallback(message,from,identity,action,value);
}
export async function sendOpenQuoteRequests(chatId,identity){
  if(!canUse(identity))return sendMessage(chatId,'ليست لديك صلاحية عرض طلبات الأسعار.');
  let rows=[];
  try{
    rows=await select('purchase_requests','request_type=eq.rfq&status=not.in.(closed,cancelled,rejected)&select=reference_no,item_description,quantity,unit,urgency,status,requested_at&order=requested_at.desc&limit=50')||[];
  }catch{}
  if(rows.length){
    const body=rows.slice(0,15).map((row,index)=>`${index+1}. <b>${esc(row.reference_no)}</b> — ${esc(row.item_description)}\nالكمية: ${esc(row.quantity||1)} ${esc(row.unit||'')} | الاستعجال: ${esc(urgencyLabel(row.urgency))}\nالحالة: ${esc(row.status)}`).join('\n\n');
    return sendMessage(chatId,`<b>طلبات عروض الأسعار المفتوحة</b>\n\n${body}`.slice(0,3900));
  }
  return legacy.sendOpenQuoteRequests(chatId,identity);
}
export async function handleProcurementTextCommand(message,identity,text){
  const normalized=String(text||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
  const isOpen=/^(طلبات الاسعار المفتوحه|طلبات الأسعار المفتوحة)$/.test(normalized);
  const isCreate=/^(بحث مورد|بحث عن مورد|بحث عن قطعه|بحث عن قطعة|ابحث عن قطعه|ابحث عن قطعة|قائمه الموردين|قائمة الموردين|طلب عرض سعر|طلب اسعار|طلب أسعار)$/.test(normalized);
  if(isOpen){await sendOpenQuoteRequests(message.chat.id,identity);return true;}
  if(isCreate&&!canCreate(identity)){await deny(message,identity,true);return true;}
  return legacy.handleProcurementTextCommand(message,identity,text);
}
