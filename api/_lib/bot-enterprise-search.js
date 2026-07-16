import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { enterpriseEvents, esc, norm, operationLine, reduceEnterpriseOperations, setEnterpriseSession } from './bot-enterprise-store.js';

const CUSTOMER_ROLES=new Set(['admin','manager','accountant','block_sales','concrete_sales','collector']);
const VEHICLE_ROLES=new Set(['admin','manager','accountant','mechanic','driver','fuel_operator','quality']);
const MAINTENANCE_ROLES=new Set(['admin','manager','accountant','mechanic','quality']);
const INVENTORY_ROLES=new Set(['admin','manager','accountant','mechanic','warehouse','procurement','fuel_operator']);
const CATEGORY_SCOPE={
  admin:null,manager:null,accountant:null,
  mechanic:new Set(['task','inventory','purchase','fuel','trip','quality','incident','maintenance_order']),
  block_sales:new Set(['task','collection','trip','customer','incident','block_sales_order']),
  concrete_sales:new Set(['task','collection','trip','customer','incident','concrete_sales_order']),
  collector:new Set(['task','collection','trip','customer','incident']),
  driver:new Set(['task','fuel','trip','incident']),
  employee:new Set(['task','hr','incident']),
  warehouse:new Set(['task','inventory','purchase','incident']),
  fuel_operator:new Set(['task','fuel','trip','inventory','purchase','incident']),
  hr:new Set(['task','hr','incident']),
  procurement:new Set(['task','inventory','purchase','incident']),
  quality:new Set(['task','quality','purchase','incident'])
};

async function safeSelect(table,query){try{return await select(table,query)||[];}catch{return[];}}
function operationAllowed(identity,item){
  const scope=CATEGORY_SCOPE[identity.role];
  if(scope===null)return true;
  if(!scope)return false;
  const category=String(item.category||item.entity_type||'');
  if(!scope.has(category))return false;
  if(['driver','employee'].includes(identity.role)){
    const own=String(item.created_by_user_id||'')===String(identity.user_id||'');
    const assigned=norm(item.assigned_to||'')===norm(identity.full_name||'');
    return own||assigned;
  }
  return true;
}
export async function startEnterpriseSearch(message,identity){
  if(!identity?.active)return sendMessage(message.chat.id,'حسابك غير معتمد أو غير نشط.');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_search',{startedAt:new Date().toISOString(),roleAtStart:identity.role});
  return sendMessage(message.chat.id,'اكتب رقم مرجع، لوحة، عميل، صنف، أو كلمة من وصف العملية. النتائج تتبع صلاحيات دورك.');
}
export async function executeEnterpriseSearch(message,identity,query){
  if(!identity?.active){await clearMaintenanceSession(message.chat.id,identity?.external_id||message.from.id);return sendMessage(message.chat.id,'حسابك غير معتمد أو غير نشط.');}
  const searchText=norm(query);if(searchText.length<2)return sendMessage(message.chat.id,'اكتب عبارة بحث أوضح.');
  const [events,vehicles,customers,maintenance,inventory]=await Promise.all([
    enterpriseEvents(1500),
    VEHICLE_ROLES.has(identity.role)?safeSelect('vehicles','active=eq.true&select=external_id,plate_no,asset_no,vehicle_type,make,model,status&limit=1500'):[],
    CUSTOMER_ROLES.has(identity.role)?safeSelect('customers','active=eq.true&select=external_id,customer_code,customer_name,phone,segment&limit=1500'):[],
    MAINTENANCE_ROLES.has(identity.role)?safeSelect('maintenance_orders','select=reference_no,plate_snapshot,problem,status,priority,reported_at&order=reported_at.desc&limit=800'):[],
    INVENTORY_ROLES.has(identity.role)?safeSelect('inventory_items','active=eq.true&select=external_id,sku,item_name,category,unit,quantity_on_hand,minimum_quantity&limit=2000'):[]
  ]);
  const operations=reduceEnterpriseOperations(events).filter(item=>operationAllowed(identity,item)&&norm(JSON.stringify(item)).includes(searchText)).slice(0,12);
  const vehiclesFound=vehicles.filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,6);
  const customersFound=customers.filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,6);
  const maintenanceFound=maintenance.filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,8);
  const inventoryFound=inventory.filter(item=>norm(JSON.stringify(item)).includes(searchText)).slice(0,8);
  let text=`<b>نتائج البحث: ${esc(query)}</b>`;
  if(customersFound.length)text+=`\n\n<b>العملاء</b>\n${customersFound.map(item=>`• ${esc(item.customer_name)}${item.phone?` — ${esc(item.phone)}`:''}`).join('\n')}`;
  if(vehiclesFound.length)text+=`\n\n<b>المركبات والأصول</b>\n${vehiclesFound.map(item=>`• ${esc(item.plate_no||item.asset_no)} — ${esc([item.make,item.model,item.vehicle_type].filter(Boolean).join(' '))}`).join('\n')}`;
  if(maintenanceFound.length)text+=`\n\n<b>أوامر الإصلاح</b>\n${maintenanceFound.map(item=>`• ${esc(item.reference_no)} — ${esc(item.plate_snapshot||'أصل عام')} — ${esc(item.status)}\n  ${esc(String(item.problem||'').slice(0,120))}`).join('\n')}`;
  if(inventoryFound.length)text+=`\n\n<b>المخزون</b>\n${inventoryFound.map(item=>`• ${esc(item.item_name)}${item.sku?` — ${esc(item.sku)}`:''}\n  الرصيد: ${esc(item.quantity_on_hand)} ${esc(item.unit||'')} — الحد الأدنى: ${esc(item.minimum_quantity)}`).join('\n')}`;
  if(operations.length)text+=`\n\n<b>العمليات المسموحة لدورك</b>\n${operations.map(operationLine).join('\n\n')}`;
  if(!customersFound.length&&!vehiclesFound.length&&!maintenanceFound.length&&!inventoryFound.length&&!operations.length)text+='\n\nلا توجد نتائج مطابقة ضمن صلاحيات دورك.';
  await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);
  return sendMessage(message.chat.id,text.slice(0,3900));
}
