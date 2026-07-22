import { sendMessage } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { requiredSelect } from './required-data.js';
import * as sales from './bot-sales.js';
import * as guided from './bot-sales-guided.js';

const VIEW_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales']);
const CREATE_ROLES=new Set(['admin','block_sales','concrete_sales']);
const UPDATE_ROLES=new Set(['admin','manager','block_sales','concrete_sales']);
const roleType=role=>role==='block_sales'?'block':role==='concrete_sales'?'concrete':'';
const active=identity=>Boolean(identity?.active);
const canView=identity=>active(identity)&&VIEW_ROLES.has(identity.role);
const canCreate=identity=>active(identity)&&CREATE_ROLES.has(identity.role);
const canUpdate=identity=>active(identity)&&UPDATE_ROLES.has(identity.role);
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
async function deny(message,identity,text='ليست لديك صلاحية تنفيذ عملية المبيعات هذه.'){
  try{await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from?.id);}catch(error){console.warn('[sales permission session cleanup]',String(error?.message||error).slice(0,180));}
  return sendMessage(message.chat.id,text);
}
function typeAllowed(identity,type){const own=roleType(identity?.role);return canCreate(identity)&&(!own||own===type);}
async function sessionFor(message,identity){return(await requiredSelect('bot_sessions',`channel=eq.telegram&chat_id=eq.${encodeURIComponent(String(message.chat.id))}&external_user_id=eq.${encodeURIComponent(String(identity.external_id||message.from?.id))}&select=*&limit=1`,'جلسة المبيعات الحالية','SALES_SESSION_READ_FAILED'))[0]||null;}
function sessionType(session){return session?.context?.salesType||session?.context?.draft?.sales_type||'';}

export function isStructuredSalesOrder(identity,text){
  if(!active(identity)||!roleType(identity?.role))return false;
  const raw=String(text||'');
  const customer=/(?:^|\n)\s*(?:العميل|اسم العميل)\s*[:：-]/i.test(raw);
  const item=/(?:^|\n)\s*(?:الصنف|المنتج|نوع البلوك|نوع الخرسانه|نوع الخرسانة)\s*[:：-]/i.test(raw);
  const quantity=/(?:^|\n)\s*(?:الكميه|الكمية)\s*[:：-]/i.test(raw);
  return customer&&item&&quantity;
}
export function isNaturalSalesMessage(identity,text){
  const type=roleType(identity?.role),value=norm(text);
  if(!active(identity)||!type||!value)return false;
  if(/^(سعر|اسعار|أسعار|بحث سعر|قارن اسعار|قارن أسعار)\b/.test(value))return false;
  return /(?:سجل|تسجيل|اعمل|افتح|عايز|اريد|عندي).*(?:امر بيع|طلب بيع|عمليه بيع|عملية بيع|توريد)/.test(value)
    ||/(?:العميل|عميل).*(?:عايز|يريد|طلب|طالب|محتاج).*(?:بلوك|خرسانه|توريد)/.test(value)
    ||/(?:بيع|توريد).*(?:بلوك|خرسانه).*(?:عميل|كميه|كمية)/.test(value);
}
export async function handleStructuredSalesOrder(message,identity,text){
  const type=roleType(identity?.role);
  if(!type||!isStructuredSalesOrder(identity,text))return false;
  await continueSalesSession(message,identity,{state:'sales_new_order',context:{salesType:type,source:'role_structured_message'}},text);
  return true;
}
export async function handleNaturalSalesMessage(message,identity,text){
  const type=roleType(identity?.role);
  if(!type||!isNaturalSalesMessage(identity,text))return false;
  await startGuidedSales(message,identity,type);
  return true;
}

export async function showSalesMenu(message,identity){return canView(identity)?sales.showSalesMenu(message,identity):deny(message,identity,'قائمة المبيعات متاحة لموظفي المبيعات والإدارة والمحاسب.');}
export async function startSalesAction(message,identity,action){
  if(['summary','overdue','open','mine'].includes(action))return canView(identity)?sales.startSalesAction(message,identity,action):deny(message,identity);
  if(action==='update')return canUpdate(identity)?sales.startSalesAction(message,identity,action):deny(message,identity);
  const type=action==='new_block'?'block':action==='new_concrete'?'concrete':'';
  if(type&&!typeAllowed(identity,type))return deny(message,identity,`دورك لا يسمح بتسجيل مبيعات ${type==='block'?'البلوك':'الخرسانة'}.`);
  return sales.startSalesAction(message,identity,action);
}
export async function continueSalesSession(message,identity,session,text){
  const state=String(session?.state||'');
  if(state==='sales_update_order'&&!canUpdate(identity))return deny(message,identity).then(()=>true);
  if(['sales_new_order','sales_confirm_order'].includes(state)&&!typeAllowed(identity,sessionType(session)||roleType(identity?.role)))return deny(message,identity).then(()=>true);
  if(!canView(identity))return deny(message,identity).then(()=>true);
  return sales.continueSalesSession(message,identity,session,text);
}
export async function confirmSalesOrder(message,reference,identity){
  const session=await sessionFor(message,identity),type=sessionType(session);
  if(!typeAllowed(identity,type))return deny(message,identity,'تم رفض التأكيد لأن دورك الحالي لا يطابق قسم أمر البيع.');
  return sales.confirmSalesOrder(message,reference,identity);
}
export async function cancelSalesDraft(message,identity){return active(identity)?sales.cancelSalesDraft(message,identity):deny(message,identity);}
export async function handleSalesTextCommand(message,identity,text){
  if(!canView(identity)){
    const value=String(text||'').toLowerCase();
    if(/مبيعات|امر بيع|أمر بيع|طلبات البيع/.test(value)){await deny(message,identity);return true;}
    return false;
  }
  return sales.handleSalesTextCommand(message,identity,text);
}
export async function startGuidedSales(message,identity,type){return typeAllowed(identity,type)?guided.startGuidedSales(message,identity,type):deny(message,identity,'دورك الحالي لا يسمح بإنشاء أمر البيع في هذا القسم.');}
export async function continueGuidedSales(message,identity,session,text){
  if(!typeAllowed(identity,sessionType(session)))return deny(message,identity).then(()=>true);
  return guided.continueGuidedSales(message,identity,session,text);
}
export async function handleGuidedSalesCallback(message,from,identity,action,value){
  const session=await sessionFor({...message,from},identity);
  if(!typeAllowed(identity,sessionType(session)))return deny({...message,from},identity,'انتهت صلاحية هذه الخطوة أو تغير قسم المبيعات.');
  return guided.handleGuidedSalesCallback(message,from,identity,action,value);
}
export const sendSalesOrdersList=sales.sendSalesOrdersList;
export const sendExecutiveSalesStatus=sales.sendExecutiveSalesStatus;
