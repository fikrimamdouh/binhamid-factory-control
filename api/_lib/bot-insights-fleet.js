import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { esc, formatAmount, norm } from './bot-enterprise-store.js';
const number=value=>Number(value||0)||0;
const dateOf=value=>String(value||'').slice(0,10);
function arrays(payload){const legacy=payload?.legacy||{},ops=payload?.ops||{};return{vehicles:legacy.veh||[],fuel:ops.fuel||[],maintenance:ops.maintenance||[],deliveries:ops.deliveries||[]};}
async function state(){return(await select('app_state','key=eq.primary&select=payload,updated_at,revision&limit=1'))?.[0]||null;}
function plateOf(row){return String(row.plate||row.plateNo||row.plate_no||row.assetNo||row.asset_no||row.vehicle||row.car||'').trim();}
export async function sendVehicleHistory(chatId,query){
  const key=norm(query),row=await state();if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية متاحة للبحث.');
  const data=arrays(row.payload),vehicles=data.vehicles.filter(item=>norm(JSON.stringify(item)).includes(key)),plate=plateOf(vehicles[0])||query,since=Date.now()-90*86400000;
  const match=item=>norm(JSON.stringify(item)).includes(norm(plate)),recent=item=>{const value=item.date||item.createdAt||item.reportedAt||item.outAt||item.timestamp;return !value||new Date(value).getTime()>=since;};
  const fuel=data.fuel.filter(item=>match(item)&&recent(item)),maintenance=data.maintenance.filter(item=>match(item)&&recent(item)),deliveries=data.deliveries.filter(item=>match(item)&&recent(item));
  const central=await select('maintenance_orders',`or=(plate_snapshot.ilike.*${encodeURIComponent(plate)}*,problem.ilike.*${encodeURIComponent(plate)}*)&select=reference_no,problem,status,priority,actual_cost,reported_at&order=reported_at.desc&limit=50`);
  const liters=fuel.reduce((sum,item)=>sum+number(item.liters??item.quantity),0),fuelCost=fuel.reduce((sum,item)=>sum+number(item.totalCost??item.amount),0),maintenanceCost=(central||[]).reduce((sum,item)=>sum+number(item.actual_cost),0);
  let text=`<b>سجل المركبة أو الأصل خلال 90 يومًا</b>\n\nالمرجع: <b>${esc(plate)}</b>\nتعبئات الديزل: <b>${fuel.length}</b>\nإجمالي اللترات: <b>${liters.toLocaleString('en-US')}</b>\nتكلفة الديزل: <b>${formatAmount(fuelCost)} ر.س</b>\nحركات التوريد: <b>${deliveries.length}</b>\nأوامر الصيانة: <b>${(central?.length||0)+maintenance.length}</b>\nتكلفة الصيانة المسجلة: <b>${formatAmount(maintenanceCost)} ر.س</b>`;
  if(central?.length)text+=`\n\n<b>آخر أوامر الإصلاح</b>\n${central.slice(0,8).map(item=>`• ${esc(item.reference_no)} — ${esc(item.status)}\n  ${esc(String(item.problem||'').slice(0,140))}`).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900));
}
export async function sendFuelAnomalies(chatId){
  const row=await state();if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية لتحليل الديزل.');
  const fuel=arrays(row.payload).fuel,groups=new Map();
  for(const item of fuel){const plate=plateOf(item)||'غير محدد',date=dateOf(item.date||item.createdAt||item.timestamp);if(!date)continue;const key=`${plate}|${date}`,entry=groups.get(key)||{plate,date,liters:0};entry.liters+=number(item.liters??item.quantity);groups.set(key,entry);}
  const byPlate=new Map();for(const entry of groups.values()){const list=byPlate.get(entry.plate)||[];list.push(entry);byPlate.set(entry.plate,list);}
  const alerts=[];
  for(const [plate,list] of byPlate){list.sort((a,b)=>a.date.localeCompare(b.date));const avg=list.reduce((sum,item)=>sum+item.liters,0)/Math.max(list.length,1),latest=list.at(-1);if(latest&&list.length>=3&&latest.liters>avg*1.5)alerts.push(`${plate}: آخر يوم ${latest.liters.toFixed(1)} لتر مقابل متوسط ${avg.toFixed(1)}`);for(let index=1;index<list.length;index++){const diff=(new Date(list[index].date)-new Date(list[index-1].date))/86400000;if(diff===1&&list[index].liters>0&&list[index-1].liters>0){alerts.push(`${plate}: تعبئة في يومين متتاليين ${list[index-1].date} و${list[index].date}`);break;}}}
  if(!alerts.length)return sendMessage(chatId,'لم تظهر حالات ديزل غير معتادة وفق القواعد الحسابية الحالية.');
  return sendMessage(chatId,`<b>مؤشرات ديزل تحتاج مراجعة</b>\n\n${alerts.slice(0,25).map(item=>`• ${esc(item)}`).join('\n')}\n\nهذه مؤشرات حسابية وليست إثباتًا؛ راجع المسافة والعداد وطبيعة التشغيل.`);
}
