import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { esc, formatAmount, norm } from './bot-enterprise-store.js';

const FUEL_ROLES=new Set(['admin','manager','accountant','fuel_operator','mechanic']);
const VEHICLE_HISTORY_ROLES=new Set(['admin','manager','accountant','mechanic','fuel_operator','quality']);
const number=value=>Number(value||0)||0;
const dateOf=value=>String(value||'').slice(0,10);
function arrays(payload){const legacy=payload?.legacy||{},ops=payload?.ops||{};return{vehicles:legacy.veh||[],fuel:ops.fuel||[],maintenance:ops.maintenance||[],deliveries:ops.deliveries||[]};}
async function state(){return(await select('app_state','key=eq.primary&select=payload,updated_at,revision&limit=1'))?.[0]||null;}
function plateOf(row){return String(row.plate||row.plateNo||row.plate_no||row.assetNo||row.asset_no||row.vehicle||row.car||row.vehicle_external_id||'').trim();}
async function safeSelect(table,query){try{return await select(table,query)||[];}catch{return[];}}
export async function sendVehicleHistory(chatId,query,identity){
  if(identity&&!identity.active||identity&&!VEHICLE_HISTORY_ROLES.has(identity.role))return sendMessage(chatId,'ليست لديك صلاحية عرض سجل الأسطول الكامل.');
  const plate=String(query||'').trim(),since=new Date(Date.now()-90*86400000).toISOString();
  const [driverEvents,central]=await Promise.all([
    safeSelect('driver_events',`vehicle_external_id=ilike.*${encodeURIComponent(plate)}*&occurred_at=gte.${encodeURIComponent(since)}&select=reference_no,event_type,vehicle_external_id,odometer,fuel_liters,fuel_amount,destination,note,occurred_at&order=occurred_at.desc&limit=500`),
    safeSelect('maintenance_orders',`or=(plate_snapshot.ilike.*${encodeURIComponent(plate)}*,problem.ilike.*${encodeURIComponent(plate)}*)&select=reference_no,problem,status,priority,actual_cost,reported_at&order=reported_at.desc&limit=100`)
  ]);
  let fuel=driverEvents.filter(item=>item.event_type==='fuel_complete'),deliveries=driverEvents.filter(item=>item.event_type==='delivered'),maintenanceFallback=[];
  if(!driverEvents.length){
    const row=await state();if(row?.payload){const data=arrays(row.payload),match=item=>norm(JSON.stringify(item)).includes(norm(plate)),recent=item=>{const value=item.date||item.createdAt||item.reportedAt||item.outAt||item.timestamp;return !value||new Date(value).getTime()>=Date.now()-90*86400000;};fuel=data.fuel.filter(item=>match(item)&&recent(item));deliveries=data.deliveries.filter(item=>match(item)&&recent(item));maintenanceFallback=data.maintenance.filter(item=>match(item)&&recent(item));}
  }
  const liters=fuel.reduce((sum,item)=>sum+number(item.fuel_liters??item.liters??item.quantity),0),fuelCost=fuel.reduce((sum,item)=>sum+number(item.fuel_amount??item.totalCost??item.amount),0),maintenanceCost=central.reduce((sum,item)=>sum+number(item.actual_cost),0),odometers=driverEvents.map(item=>number(item.odometer)).filter(Boolean),distance=odometers.length?Math.max(...odometers)-Math.min(...odometers):0;
  let text=`<b>سجل المركبة أو الأصل خلال 90 يومًا</b>\n\nالمرجع: <b>${esc(plate)}</b>\nتعبئات الديزل: <b>${fuel.length}</b>\nإجمالي اللترات: <b>${liters.toLocaleString('en-US')}</b>\nتكلفة الديزل: <b>${formatAmount(fuelCost)} ر.س</b>\nالمسافة المسجلة: <b>${distance.toFixed(1)} كم</b>\nحركات التسليم: <b>${deliveries.length}</b>\nأوامر الصيانة: <b>${central.length+maintenanceFallback.length}</b>\nتكلفة الصيانة المسجلة: <b>${formatAmount(maintenanceCost)} ر.س</b>`;
  if(central.length)text+=`\n\n<b>آخر أوامر الإصلاح</b>\n${central.slice(0,8).map(item=>`• ${esc(item.reference_no)} — ${esc(item.status)}\n  ${esc(String(item.problem||'').slice(0,140))}`).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900));
}
export async function sendFuelAnomalies(chatId,identity){
  if(!identity?.active||!FUEL_ROLES.has(identity.role))return sendMessage(chatId,'ليست لديك صلاحية عرض تحليل الديزل.');
  const since=new Date(Date.now()-60*86400000).toISOString();
  const direct=await safeSelect('driver_events',`event_type=eq.fuel_complete&occurred_at=gte.${encodeURIComponent(since)}&select=vehicle_external_id,fuel_liters,occurred_at&order=occurred_at.asc&limit=5000`);
  let fuel=direct.map(item=>({plate:item.vehicle_external_id,liters:item.fuel_liters,date:item.occurred_at}));
  if(!fuel.length){const row=await state();if(!row?.payload)return sendMessage(chatId,'لا توجد بيانات ديزل مركزية للتحليل.');fuel=arrays(row.payload).fuel;}
  const groups=new Map();
  for(const item of fuel){const plate=plateOf(item)||'غير محدد',date=dateOf(item.date||item.occurred_at||item.createdAt||item.timestamp);if(!date)continue;const key=`${plate}|${date}`,entry=groups.get(key)||{plate,date,liters:0};entry.liters+=number(item.fuel_liters??item.liters??item.quantity);groups.set(key,entry);}
  const byPlate=new Map();for(const entry of groups.values()){const list=byPlate.get(entry.plate)||[];list.push(entry);byPlate.set(entry.plate,list);}
  const alerts=[];
  for(const [plate,list] of byPlate){list.sort((a,b)=>a.date.localeCompare(b.date));const avg=list.reduce((sum,item)=>sum+item.liters,0)/Math.max(list.length,1),latest=list.at(-1);if(latest&&list.length>=3&&latest.liters>avg*1.5)alerts.push(`${plate}: آخر يوم ${latest.liters.toFixed(1)} لتر مقابل متوسط ${avg.toFixed(1)}`);for(let index=1;index<list.length;index++){const diff=(new Date(list[index].date)-new Date(list[index-1].date))/86400000;if(diff===1&&list[index].liters>0&&list[index-1].liters>0){alerts.push(`${plate}: تعبئة في يومين متتاليين ${list[index-1].date} و${list[index].date}`);break;}}}
  if(!alerts.length)return sendMessage(chatId,'لم تظهر حالات ديزل غير معتادة وفق القواعد الحسابية الحالية.');
  return sendMessage(chatId,`<b>مؤشرات ديزل تحتاج مراجعة</b>\n\n${alerts.slice(0,25).map(item=>`• ${esc(item)}`).join('\n')}\n\nهذه مؤشرات حسابية وليست إثباتًا؛ راجع المسافة والعداد وطبيعة التشغيل.`);
}
