import { select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { reportSummary } from './domain.js';
export function reportKeyboard(){return keyboard([[{text:'ملخص اليوم',callback_data:'report:daily'},{text:'الديزل',callback_data:'report:fuel'}],[{text:'الورشة',callback_data:'report:workshop'},{text:'المبيعات والتحصيل',callback_data:'report:sales'}],[{text:'الفروقات المفتوحة',callback_data:'report:discrepancies'}]]);}
export async function sendReport(chatId,kind){
  const row=(await select('app_state','key=eq.primary&select=payload,revision,updated_at&limit=1'))?.[0];
  if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية معتمدة من البرنامج حتى الآن. افتح البرنامج واضغط <b>مزامنة الآن</b>.');
  const s=reportSummary(row.payload);let text='';
  if(kind==='fuel')text=`<b>تقرير الديزل — اليوم</b>\n\nاللترات: <b>${s.fuelLitersToday.toLocaleString('en-US')}</b>\nالقيمة: <b>${s.fuelCostToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>`;
  else if(kind==='workshop')text=`<b>تقرير الورشة</b>\n\nأوامر الإصلاح المفتوحة: <b>${s.openMaintenance}</b>\nالمركبات المتوقفة: <b>${s.stoppedVehicles}</b>\nإجمالي المركبات المسجلة: <b>${s.vehicles}</b>`;
  else if(kind==='sales')text=`<b>المبيعات والتحصيل — اليوم</b>\n\nالمبيعات: <b>${s.salesToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالتحصيل: <b>${s.collectionsToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالفرق: <b>${(s.salesToday-s.collectionsToday).toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>`;
  else if(kind==='discrepancies'){const rows=await select('discrepancies','status=in.(open,under_review)&select=severity,status&limit=1000'),critical=(rows||[]).filter(x=>x.severity==='critical').length;text=`<b>الفروقات الرقابية المفتوحة</b>\n\nالإجمالي: <b>${rows?.length||0}</b>\nحرجة: <b>${critical}</b>\nتحتاج مراجعة: <b>${(rows?.length||0)-critical}</b>`;}
  else text=`<b>ملخص مصنع بن حامد — اليوم</b>\n\nالموظفون: <b>${s.employees}</b>\nالمركبات: <b>${s.vehicles}</b>\nالعملاء: <b>${s.clients}</b>\nالمبيعات: <b>${s.salesToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالتحصيل: <b>${s.collectionsToday.toLocaleString('en-US',{maximumFractionDigits:2})} ر.س</b>\nالديزل: <b>${s.fuelLitersToday.toLocaleString('en-US')} لتر</b>\nأوامر الورشة المفتوحة: <b>${s.openMaintenance}</b>`;
  return sendMessage(chatId,text);
}
