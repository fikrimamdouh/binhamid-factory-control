import { norm } from './bot-enterprise-store.js';
import { sendVehicleHistory, sendFuelAnomalies } from './bot-insights-fleet.js';
import { sendInventoryRisks, sendDebtAnalysis, sendConcreteCapacity } from './bot-insights-ops.js';

export async function handleInsightCommand(message,identity,text){
  const value=norm(text),role=identity?.role||'';
  if(!['admin','manager','accountant','mechanic'].includes(role))return false;

  const vehicleMatch=String(text||'').match(/(?:السياره|السيارة|المركبه|المركبة|الاصل|الأصل)\s+([\w\u0600-\u06FF -]{2,20}).*(?:90|تسعين)/i);
  if(vehicleMatch){await sendVehicleHistory(message.chat.id,vehicleMatch[1].trim());return true;}

  if(/^(حلل الديزل|حالات الديزل غير المعتاده|حالات الديزل غير المعتادة|مخالفات الديزل|السيارات التي تعبي ديزل بشكل غير طبيعي)$/.test(value)){
    await sendFuelAnomalies(message.chat.id);return true;
  }
  if(/^(المخزون الحرج|حلل المخزون|اصناف تحت الحد|الأصناف تحت الحد|حاله المخزون الحرج)$/.test(value)){
    await sendInventoryRisks(message.chat.id);return true;
  }
  if(/^(حلل مديونيه العملاء|تحليل المديونيه|تحليل مديونية العملاء|اخطر العملاء|أخطر العملاء)$/.test(value)){
    await sendDebtAnalysis(message.chat.id);return true;
  }
  if(/^(تعارضات الخرسانه|طاقه الخرسانه|طاقة الخرسانة|طلبات الخرسانه غدا|طلبات الخرسانة غدا)$/.test(value)){
    await sendConcreteCapacity(message.chat.id);return true;
  }
  return false;
}
