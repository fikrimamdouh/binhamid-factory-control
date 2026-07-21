import { sendMessage, keyboard } from './telegram.js';
import {
  handleSalesTextCommand as handleSalesTextCommandBase,
  continueSalesSession as continueSalesSessionBase,
  startSalesAction,
  confirmSalesOrder,
  cancelSalesDraft,
  showSalesMenu
} from './bot-sales.js';

const normalize=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const referenceFrom=text=>String(text||'').match(/BH-(?:BSO|CSO)-\d{4}-\d{5}/i)?.[0]?.toUpperCase()||'';
function requestsFinancialStatus(text=''){
  const value=normalize(text);
  return /تم التحصيل|تحصل|سدد بالكامل|صدر.*فاتور|تمت الفوتر|تم اصدار الفاتور/.test(value);
}
async function rejectUnpostedFinancialStatus(message,text=''){
  const reference=referenceFrom(text);
  return sendMessage(message.chat.id,`<b>لم تتغير حالة أمر البيع${reference?` ${reference}`:''}</b>\n\nالفوترة والتحصيل لا يُثبتان من تحديث نصي أو صوتي. يجب تنفيذهما من التقرير اليومي أو شاشة الاعتماد التي تنشئ المستند والترحيل المحاسبي الرسمي.\n\nالحالة: <b>لا يوجد حفظ مالي ولا قيد ولا تحصيل مسجل من هذا الطلب.</b>`,keyboard([[{text:'فتح أوامر البيع',callback_data:'sales:open'}],[{text:'فتح مركز المحاسبة',callback_data:'ent:accounting_menu'}]]));
}

export async function continueSalesSession(message,identity,session,text){
  if(session?.state==='sales_update_order'&&requestsFinancialStatus(text)){await rejectUnpostedFinancialStatus(message,text);return true;}
  return continueSalesSessionBase(message,identity,session,text);
}

export async function handleSalesTextCommand(message,identity,text){
  if(requestsFinancialStatus(text)&&(/BH-(?:BSO|CSO)-\d{4}-\d{5}/i.test(String(text||''))||/فاتور|تحصيل|سدد/.test(normalize(text)))){await rejectUnpostedFinancialStatus(message,text);return true;}
  return handleSalesTextCommandBase(message,identity,text);
}

export { startSalesAction, confirmSalesOrder, cancelSalesDraft, showSalesMenu };
