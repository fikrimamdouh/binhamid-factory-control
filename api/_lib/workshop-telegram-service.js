import { insert, select, upsert } from './supabase.js';
import {
  addWorkshopDiagnostic,addWorkshopLabor,createWorkshopOrder,getWorkshopOrder,listWorkshopOrders,
  requestWorkshopPart,transitionWorkshopOrder
} from './workshop-service.js';

const clean=(value,max=3000)=>String(value??'').trim().slice(0,max);
const encode=value=>encodeURIComponent(String(value));
const now=()=>new Date().toISOString();
const actor=identity=>clean(identity?.user_id||identity?.appUserId||identity?.external_id,120)||null;
const role=identity=>clean(identity?.role,50)||'pending';
const requestKey=(kind,message,extra='')=>`tg:${kind}:${message?.chat?.id||''}:${message?.message_id||''}:${clean(extra,80)}`.slice(0,180);

export async function searchWorkshopAssets(query='',limit=12){
  const text=clean(query,120).replace(/[,*()]/g,' '),filters=['active=eq.true','select=external_id,asset_type,asset_name,plate_no,asset_no,make,model,operational_status','order=asset_name.asc',`limit=${Math.min(Math.max(Number(limit)||12,1),30)}`];
  if(text){const value=encode(`*${text}*`);filters.push(`or=(external_id.ilike.${value},asset_name.ilike.${value},plate_no.ilike.${value},asset_no.ilike.${value},make.ilike.${value},model.ilike.${value})`);}
  return await select('unified_assets',filters.join('&'))||[];
}

export function assetLabel(asset={}){
  const identity=asset.plate_no||asset.asset_no||asset.external_id||'بدون رقم';
  const name=asset.asset_name||asset.make||asset.asset_type||'أصل';
  return`${identity} — ${name}`.slice(0,60);
}

export async function createTelegramWorkshopDraft({message,identity,assetExternalId,problem,voicePath='',faultCategory=''}){
  return createWorkshopOrder({
    assetExternalId,problem,voicePath,faultCategory,sourceChannel:'telegram',sourceChatId:String(message.chat.id),
    sourceMessageId:String(message.message_id),requestId:requestKey('create',message,assetExternalId),
    priority:/حرج|خطر|فرامل|متوقف|عاجل/.test(String(problem))?'urgent':'normal',
    vehicleStopped:/متوقف|واقفة|واقف|لا تعمل|مش هتشتغل/.test(String(problem)),
    metadata:{voicePath:voicePath||null,telegramUserId:String(message.from?.id||identity?.external_id||''),source:'telegram-workshop'}
  },identity);
}

export async function confirmTelegramWorkshopOrder(message,identity,id){
  return transitionWorkshopOrder({maintenanceId:id,targetStatus:'reported',sourceChannel:'telegram',note:'تم تأكيد فتح أمر الإصلاح من Telegram',reason:'confirmed',requestId:requestKey('confirm',message,id)},identity);
}

export async function cancelTelegramWorkshopOrder(message,identity,id){
  return transitionWorkshopOrder({maintenanceId:id,targetStatus:'cancelled',sourceChannel:'telegram',note:'تم إلغاء المسودة من Telegram',reason:'cancelled',requestId:requestKey('cancel',message,id)},identity);
}

export async function listTelegramWorkshopOrders(identity,{status='',limit=15,mine=false}={}){
  return listWorkshopOrders({status,limit,technicianExternalId:mine?actor(identity):''});
}

export async function addTelegramWorkshopNote({message,identity,maintenanceId,note}){
  const key=requestKey('note',message,maintenanceId),existing=(await select('workshop_command_receipts',`command_key=eq.${encode(key)}&select=result&limit=1`).catch(()=>[]))?.[0];
  if(existing)return{...(existing.result||{}),duplicate:true};
  const order=await getWorkshopOrder(maintenanceId),rows=await insert('maintenance_updates',[{
    maintenance_id:order.id,status:order.status,note:clean(note,4000),created_by:actor(identity),source_channel:'telegram',
    source_chat_id:String(message.chat.id),source_message_id:String(message.message_id)
  }]),update=rows?.[0]||null,result={maintenanceId:order.id,referenceNo:order.reference_no,status:order.status,updateId:update?.id||null,duplicate:false};
  await insert('audit_log',[{actor_type:'telegram',actor_id:actor(identity)||String(message.from?.id||''),action:'maintenance_note_added',entity_type:'maintenance_order',entity_id:order.id,details:{reference_no:order.reference_no,note:clean(note,4000),request_id:key,actor_role:role(identity),chat_id:String(message.chat.id),source_message_id:String(message.message_id)},created_at:now()}]);
  await insert('workshop_command_receipts',[{command_key:key,action:'add_note',maintenance_id:order.id,actor_id:actor(identity),actor_role:role(identity),source_channel:'telegram',source_reference:String(message.message_id),result}]).catch(()=>null);
  return result;
}

export async function addTelegramDiagnostic({message,identity,maintenanceId,text}){
  return addWorkshopDiagnostic({maintenanceId,diagnosis:clean(text,5000),sourceChannel:'telegram',requestId:requestKey('diagnostic',message,maintenanceId)},identity);
}

export async function addTelegramLabor({message,identity,maintenanceId,hours,workType,notes=''}){
  const end=new Date(),start=new Date(end.getTime()-Math.max(Number(hours)||0,0)*3600000);
  return addWorkshopLabor({maintenanceId,hours:Number(hours)||0,workType:clean(workType,200),notes:clean(notes,3000),startedAt:start.toISOString(),endedAt:end.toISOString(),sourceChannel:'telegram',requestId:requestKey('labor',message,maintenanceId)},identity);
}

export async function addTelegramPartRequest({message,identity,maintenanceId,itemName,quantity,unit='',urgency='normal'}){
  return requestWorkshopPart({maintenanceId,itemName:clean(itemName,300),quantity:Number(quantity)||0,unit:clean(unit,50),urgency:clean(urgency,20)||'normal',sourceChannel:'telegram',requestId:requestKey('part',message,maintenanceId)},identity);
}

function section(text,label,nextLabels=[]){
  const source=String(text||''),start=source.search(label);if(start<0)return'';
  const rest=source.slice(start).replace(label,'').replace(/^\s*[:：-]?\s*/,'');let end=rest.length;
  for(const next of nextLabels){const index=rest.search(next);if(index>=0&&index<end)end=index;}
  return rest.slice(0,end).trim();
}
function values(value){return clean(value,5000)?clean(value,5000).split(/\n|،|;/).map(item=>item.trim()).filter(Boolean):[];}

export function parseWorkshopDailyReport(text=''){
  const labels={assets:/السيارات والمعدات(?: التي)? (?:تم )?فحصها|الأصول(?: التي)? تم العمل عليها/i,work:/الأعمال(?: التي)? (?:تم )?تنفيذها/i,hours:/ساعات العمل/i,completed:/الأوامر(?: التي)? اكتملت/i,open:/الأوامر المفتوحة/i,parts:/قطع الغيار المطلوبة/i,preventive:/الأعمال الوقائية|الإجراءات الوقائية المطلوبة/i,safety:/مخاطر السلامة|ملاحظات السلامة أو التوقف/i,next:/خطة الغد|أعمال اليوم التالي/i};
  const ordered=Object.values(labels),get=key=>section(text,labels[key],ordered.filter(item=>item!==labels[key]));
  const hoursText=get('hours'),hours=Number(String(hoursText).match(/[0-9٠-٩]+(?:[.,][0-9٠-٩]+)?/)?.[0]?.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',','.'))||0;
  return{assetsWorked:values(get('assets')),workCompleted:values(get('work'))||[],totalHours:hours,completedOrders:values(get('completed')),openOrders:values(get('open')),partsRequired:values(get('parts')),preventiveWork:values(get('preventive')),safetyRisks:values(get('safety')),nextDayPlan:values(get('next')),rawText:clean(text,10000)};
}

export async function submitTelegramWorkshopDailyReport({message,identity,text}){
  const parsed=parseWorkshopDailyReport(text),reference=`TG-WDR-${String(message.chat.id).replace(/[^0-9-]/g,'')}-${message.message_id}`.slice(0,100),today=new Date().toISOString().slice(0,10);
  const rows=await upsert('workshop_daily_reports',[{
    reference_no:reference,report_date:today,mechanic_external_id:actor(identity)||String(message.from?.id||''),
    assets_worked:parsed.assetsWorked,work_completed:parsed.workCompleted.length?parsed.workCompleted:[{rawText:parsed.rawText}],
    labor_entries:parsed.totalHours?[{hours:parsed.totalHours,source:'telegram_daily_report'}]:[],completed_orders:parsed.completedOrders,
    open_orders:parsed.openOrders,parts_required:parsed.partsRequired,preventive_work:parsed.preventiveWork,safety_risks:parsed.safetyRisks,
    next_day_plan:parsed.nextDayPlan,total_hours:parsed.totalHours,status:'submitted',source_channel:'telegram',
    source_chat_id:String(message.chat.id),source_message_id:String(message.message_id),submitted_by:actor(identity),updated_at:now()
  }],'reference_no');
  return rows?.[0]||null;
}

export async function listTelegramPartRequests(limit=20){
  return await select('maintenance_parts',`status=in.(requested,not_available,quotation,purchasing)&select=id,maintenance_id,item_code,item_name,quantity_requested,unit,urgency,status,created_at&order=created_at.desc&limit=${Math.min(Number(limit)||20,100)}`)||[];
}

export async function telegramWorkshopSummary(){
  const start=new Date();start.setHours(0,0,0,0);const iso=encode(start.toISOString());
  const [reports,orders,parts,aging]=await Promise.all([
    select('workshop_daily_reports',`report_date=eq.${new Date().toISOString().slice(0,10)}&select=id,status,total_hours&limit=500`).catch(()=>[]),
    select('maintenance_orders',`created_at=gte.${iso}&select=id,status,vehicle_stopped,priority&limit=1000`).catch(()=>[]),
    select('maintenance_parts','status=in.(requested,not_available,quotation,purchasing)&select=id&limit=1000').catch(()=>[]),
    select('workshop_order_aging','status=not.in.(closed,cancelled)&select=id,age_hours&limit=1000').catch(()=>[])
  ]);
  return{dailyReports:reports.length,totalHours:reports.reduce((sum,row)=>sum+Number(row.total_hours||0),0),ordersToday:orders.length,stopped:orders.filter(row=>row.vehicle_stopped).length,urgent:orders.filter(row=>['urgent','critical'].includes(row.priority)).length,partsWaiting:parts.length,open:aging.length,stale:aging.filter(row=>Number(row.age_hours||0)>=24).length};
}

export { getWorkshopOrder, transitionWorkshopOrder };
