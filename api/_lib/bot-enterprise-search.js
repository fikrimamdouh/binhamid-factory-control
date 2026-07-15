import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { enterpriseEvents, esc, norm, operationLine, reduceEnterpriseOperations, setEnterpriseSession } from './bot-enterprise-store.js';

export async function startEnterpriseSearch(message,identity){
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_search',{startedAt:new Date().toISOString()});
  return sendMessage(message.chat.id,'اكتب اسم عميل، رقم لوحة، رقم مرجع، اسم صنف، أو كلمة من وصف العملية.');
}
export async function executeEnterpriseSearch(message,identity,query){
  const searchText=norm(query);if(searchText.length<2)return sendMessage(message.chat.id,'اكتب عبارة بحث أوضح.');
  const [events,vehicles,customers,maintenance]=await Promise.all([
    enterpriseEvents(1000),
    select('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,status&limit=1000'),
    select('customers','active=eq.true&select=external_id,customer_code,customer_name,phone,segment,credit_limit,payment_days&limit=1000'),
    select('maintenance_orders','select=reference_no,plate_snapshot,problem,status,priority,reported_at&order=reported_at.desc&limit=500')
  ]);
  const operations=reduceEnterpriseOperations(events).filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,12);
  const vehiclesFound=(vehicles||[]).filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,6);
  const customersFound=(customers||[]).filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,6);
  const maintenanceFound=(maintenance||[]).filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,8);
  let text=`<b>نتائج البحث: ${esc(query)}</b>`;
  if(customersFound.length)text+=`\n\n<b>العملاء</b>\n${customersFound.map(item=>`• ${esc(item.customer_name)}${item.phone?` — ${esc(item.phone)}`:''}`).join('\n')}`;
  if(vehiclesFound.length)text+=`\n\n<b>المركبات والأصول</b>\n${vehiclesFound.map(item=>`• ${esc(item.plate_no||item.asset_no)} — ${esc([item.make,item.model,item.vehicle_type].filter(Boolean).join(' '))}`).join('\n')}`;
  if(maintenanceFound.length)text+=`\n\n<b>أوامر الإصلاح</b>\n${maintenanceFound.map(item=>`• ${esc(item.reference_no)} — ${esc(item.plate_snapshot||'أصل عام')} — ${esc(item.status)}\n  ${esc(String(item.problem||'').slice(0,120))}`).join('\n')}`;
  if(operations.length)text+=`\n\n<b>العمليات</b>\n${operations.map(operationLine).join('\n\n')}`;
  if(!customersFound.length&&!vehiclesFound.length&&!maintenanceFound.length&&!operations.length)text+='\n\nلا توجد نتائج مطابقة في البيانات المركزية.';
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return sendMessage(message.chat.id,text.slice(0,3900));
}
