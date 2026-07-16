import crypto from 'node:crypto';
import { select, rpc } from './supabase.js';
import { getCostReport } from './cost-engine.js';

const num=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
const clean=value=>String(value??'').trim();
const sum=(rows,field)=>rows.reduce((total,row)=>total+num(typeof field==='function'?field(row):row?.[field]),0);
const safeSelect=async(table,query)=>{try{return await select(table,query)||[];}catch{return[];}};
const isoDay=value=>{const text=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return new Date().toISOString().slice(0,10);return text;};
const addDays=(day,amount)=>{const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);};
const monthStart=day=>`${day.slice(0,7)}-01`;
const money=value=>num(value).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2});

function debtorSnapshot(customers,orders,day){
  const customerMap=new Map();
  for(const customer of customers){for(const key of [customer.external_id,customer.customer_code].filter(Boolean))customerMap.set(String(key),customer);}
  const balances=new Map();
  for(const order of orders){
    const code=clean(order.customer_external_id),outstanding=Math.max(0,num(order.total_amount)-num(order.paid_amount));if(!code||outstanding<=0)continue;
    const current=balances.get(code)||{customerCode:code,customerName:order.customer_name||customerMap.get(code)?.customer_name||code,balance:0,oldestDate:null,creditLimit:num(customerMap.get(code)?.credit_limit),paymentDays:num(customerMap.get(code)?.payment_days)};
    current.balance+=outstanding;const date=String(order.delivery_date||order.created_at||'').slice(0,10);if(date&&(!current.oldestDate||date<current.oldestDate))current.oldestDate=date;balances.set(code,current);
  }
  const rows=[...balances.values()].map(row=>{const dueDate=row.oldestDate?addDays(row.oldestDate,row.paymentDays):null;return{...row,balance:Number(row.balance.toFixed(2)),overLimit:row.creditLimit>0&&row.balance>row.creditLimit,utilizationPercent:row.creditLimit>0?Number((row.balance/row.creditLimit*100).toFixed(2)):null,dueDate,overdue:Boolean(dueDate&&dueDate<day)};}).sort((a,b)=>b.balance-a.balance);
  return{top:rows.slice(0,10),overLimit:rows.filter(row=>row.overLimit),overdue:rows.filter(row=>row.overdue),totalOutstanding:Number(sum(rows,'balance').toFixed(2))};
}

function fuelSnapshot(events){
  const byVehicle=new Map(),seen=new Set();let duplicates=0;
  for(const event of events){const vehicle=clean(event.vehicle_external_id)||'unassigned',key=[vehicle,event.occurred_at,event.fuel_liters,event.fuel_amount,event.station_name].join('|');if(seen.has(key))duplicates++;seen.add(key);const current=byVehicle.get(vehicle)||{vehicleExternalId:vehicle,liters:0,amount:0,fills:0,events:[]};current.liters+=num(event.fuel_liters);current.amount+=num(event.fuel_amount);current.fills++;current.events.push(event);byVehicle.set(vehicle,current);}
  const vehicles=[...byVehicle.values()].map(row=>({...row,liters:Number(row.liters.toFixed(3)),amount:Number(row.amount.toFixed(2))})).sort((a,b)=>b.liters-a.liters);
  return{liters:Number(sum(vehicles,'liters').toFixed(3)),amount:Number(sum(vehicles,'amount').toFixed(2)),fills:events.length,duplicates,unassigned:vehicles.filter(row=>row.vehicleExternalId==='unassigned').length,vehicles};
}

export function detectManagerAlerts(snapshot){
  const alerts=[];const push=(type,severity,key,title,message,payload={},entityType=null,entityId=null)=>alerts.push({alertKey:`${type}:${key}`,alertType:type,severity,title,message,payload,entityType,entityId});
  if(!snapshot.previousDayReport)push('daily_report_missing','critical',snapshot.previousDay,'التقرير اليومي متأخر',`لم يتم اعتماد تقرير ${snapshot.previousDay}.`,{day:snapshot.previousDay});
  if(snapshot.imports.failed.length)push('daily_report_failed','critical',snapshot.day,'تقارير يومية بها أخطاء',`${snapshot.imports.failed.length} تقرير في حالة فشل أو رفض.`,{ids:snapshot.imports.failed.map(row=>row.id)});
  if(Math.abs(snapshot.reconciliation.difference)>0.01)push('daily_report_reconciliation','critical',snapshot.day,'فرق في مطابقة التقرير',`فرق المطابقة ${money(snapshot.reconciliation.difference)} ر.س.`,snapshot.reconciliation);
  for(const customer of snapshot.debtors.overLimit.slice(0,20))push('credit_limit','critical',customer.customerCode,'تجاوز حد ائتماني',`${customer.customerName}: الرصيد ${money(customer.balance)} والحد ${money(customer.creditLimit)}.`,customer,'customer',customer.customerCode);
  if(snapshot.collections.unallocated>0)push('unallocated_collection','warning',snapshot.day,'تحصيلات غير موزعة',`يوجد ${money(snapshot.collections.unallocated)} ر.س غير موزع على فواتير.`,snapshot.collections);
  if(snapshot.fuel.duplicates>0)push('fuel_duplicate','warning',snapshot.day,'حركات ديزل محتمل تكرارها',`${snapshot.fuel.duplicates} حركة متطابقة تحتاج مراجعة.`,snapshot.fuel);
  if(snapshot.cost.unclassified.length)push('cost_unclassified','critical',snapshot.cost.periodStart,'تكاليف غير مصنفة',`${snapshot.cost.unclassified.length} حركة تكلفة غير مرتبطة بمركز نهائي.`,{count:snapshot.cost.unclassified.length,period:snapshot.cost.periodStart});
  for(const [center,item] of Object.entries(snapshot.cost.economics||{}))if(item.grossMargin<0)push('negative_margin','critical',`${snapshot.cost.periodStart}:${center}`,'هامش منتج سلبي',`${center==='block'?'البلوك':'الخرسانة'} بهامش ${money(item.grossMargin)} ر.س.`,item,'cost_center',center);
  if(snapshot.sync.staleHours!==null&&snapshot.sync.staleHours>12)push('sync_stale','critical','primary','المزامنة السحابية قديمة',`آخر مزامنة منذ ${snapshot.sync.staleHours.toFixed(1)} ساعة.`,snapshot.sync,'app_state','primary');
  if(!snapshot.backup.lastSuccessful||snapshot.backup.ageHours>36)push('backup_stale','critical','production','النسخة الاحتياطية غير حديثة',snapshot.backup.lastSuccessful?`آخر نسخة منذ ${snapshot.backup.ageHours.toFixed(1)} ساعة.`:'لا توجد نسخة احتياطية ناجحة مسجلة.',snapshot.backup);
  if(snapshot.notifications.failed>0)push('notification_failures','warning',snapshot.day,'رسائل تنبيه فاشلة',`${snapshot.notifications.failed} رسالة فاشلة أو في dead-letter.`,snapshot.notifications);
  return alerts;
}

export async function persistManagerAlerts(alerts){
  const ids=[];
  for(const alert of alerts){
    try{const result=await rpc('upsert_operational_alert',{p_alert_key:alert.alertKey,p_alert_type:alert.alertType,p_severity:alert.severity,p_title:alert.title,p_message:alert.message,p_payload:alert.payload||{},p_entity_type:alert.entityType,p_entity_id:alert.entityId});ids.push(Array.isArray(result)?result[0]:result);}catch{}
  }
  return ids;
}

export async function buildManagerSnapshot(dayValue=new Date().toISOString().slice(0,10),options={}){
  const day=isoDay(dayValue),previousDay=addDays(day,-1),since30=addDays(day,-30),periodStart=monthStart(day);
  const [batches,maintenance,purchases,customers,orders,fuelEvents,state,backups,notifications,existingAlerts,cost]=await Promise.all([
    safeSelect('daily_report_batches',`report_date=gte.${previousDay}&report_date=lte.${day}&select=id,report_date,status,summary,created_at,committed_at&order=report_date.desc&limit=20`),
    safeSelect('maintenance_orders','status=in.(reported,inspection,quotation_required,approval_pending,approved,in_repair,testing)&select=id,reference_no,priority,vehicle_stopped,status,actual_cost,reported_at,vehicle_external_id&order=reported_at.asc&limit=1000'),
    safeSelect('purchase_requests','status=in.(requested,pending,open,under_review,approval_pending)&select=id,reference_no,item_description,quantity,unit,urgency,status,requested_at,updated_at&order=requested_at.asc&limit=1000'),
    safeSelect('customers','active=eq.true&select=external_id,customer_code,customer_name,credit_limit,payment_days&limit=5000'),
    safeSelect('sales_orders','status=not.in.(cancelled,rejected,collected)&select=id,reference_no,customer_external_id,customer_name,total_amount,paid_amount,delivery_date,created_at,status&limit=10000'),
    safeSelect('driver_events',`event_type=eq.fuel_complete&occurred_at=gte.${since30}T00:00:00Z&occurred_at=lte.${day}T23:59:59.999Z&select=id,reference_no,vehicle_external_id,fuel_liters,fuel_amount,station_name,occurred_at,latitude,longitude&order=occurred_at.desc&limit=5000`),
    safeSelect('app_state','key=eq.primary&select=revision,updated_at,updated_by,device_id&limit=1'),
    safeSelect('backup_runs','status=in.(completed,verified)&select=id,backup_name,status,checksum_sha256,size_bytes,completed_at,verified_at,manifest&order=completed_at.desc&limit=10'),
    safeSelect('notification_outbox','status=in.(pending,failed,dead_letter)&select=id,status,attempts,error_text,scheduled_at,created_at&order=created_at.desc&limit=1000'),
    safeSelect('operational_alerts','status=in.(pending,failed,acknowledged)&select=id,alert_key,alert_type,severity,status,title,message,last_detected_at,attempts&order=last_detected_at.desc&limit=500'),
    getCostReport(periodStart).catch(()=>({periodStart,period:null,runs:[],rows:[],economics:{},unclassified:[],complete:false}))
  ]);
  const todayBatch=batches.find(row=>String(row.report_date)===day&&row.status==='approved')||null,previousDayReport=batches.find(row=>String(row.report_date)===previousDay&&row.status==='approved')||null;
  const salesLines=todayBatch?await safeSelect('daily_report_sales_lines',`batch_id=eq.${todayBatch.id}&select=id,sales_type,amount,quantity,customer_code,invoice_no&limit=10000`):[];
  const cash=todayBatch?await safeSelect('daily_report_cash_movements',`batch_id=eq.${todayBatch.id}&select=id,treasury_code,debit,credit,is_customer_collection,account_code&limit=10000`):[];
  const collectionsRows=await safeSelect('collection_events',`occurred_at=gte.${day}T00:00:00Z&occurred_at=lte.${day}T23:59:59.999Z&select=id,amount,allocated_amount,unallocated_amount,payment_method&limit=5000`);
  const sales={total:Number(sum(salesLines,'amount').toFixed(2)),block:Number(sum(salesLines.filter(row=>row.sales_type==='block'),'amount').toFixed(2)),concrete:Number(sum(salesLines.filter(row=>row.sales_type==='concrete'),'amount').toFixed(2)),blockQuantity:Number(sum(salesLines.filter(row=>row.sales_type==='block'),'quantity').toFixed(3)),concreteQuantity:Number(sum(salesLines.filter(row=>row.sales_type==='concrete'),'quantity').toFixed(3)),invoiceCount:salesLines.length};
  const collections={total:Number(sum(collectionsRows,'amount').toFixed(2)),treasury101:Number(sum(cash.filter(row=>row.is_customer_collection&&String(row.treasury_code)==='101'),row=>Math.max(num(row.debit),num(row.credit))).toFixed(2)),treasury104:Number(sum(cash.filter(row=>row.is_customer_collection&&String(row.treasury_code)==='104'),row=>Math.max(num(row.debit),num(row.credit))).toFixed(2)),allocated:Number(sum(collectionsRows,'allocated_amount').toFixed(2)),unallocated:Number(sum(collectionsRows,'unallocated_amount').toFixed(2))};
  const debtors=debtorSnapshot(customers,orders,day),fuel=fuelSnapshot(fuelEvents.filter(row=>String(row.occurred_at).slice(0,10)===day));
  const lastSuccessful=backups?.[0]||null,backupTime=lastSuccessful?.verified_at||lastSuccessful?.completed_at||null,backupAge=backupTime?(Date.now()-new Date(backupTime).getTime())/36e5:null;
  const syncRow=state?.[0]||null,syncAge=syncRow?.updated_at?(Date.now()-new Date(syncRow.updated_at).getTime())/36e5:null;
  const importFailed=batches.filter(row=>['failed','rejected'].includes(row.status));
  const expectedSales=num(todayBatch?.summary?.totalDebt??todayBatch?.summary?.totalSales??sales.total),difference=Number((expectedSales-sales.total).toFixed(2));
  const snapshot={
    generatedAt:new Date().toISOString(),day,previousDay,todayBatch,previousDayReport,
    sales,collections,netNewReceivables:Number((sales.total-collections.total).toFixed(2)),
    reconciliation:{expectedSales,postedSales:sales.total,difference},
    imports:{recent:batches,failed:importFailed,pending:batches.filter(row=>row.status==='processing')},
    maintenance:{open:maintenance,critical:maintenance.filter(row=>row.priority==='urgent'||row.vehicle_stopped)},
    purchases:{pending:purchases},debtors,fuel,cost,
    sync:{revision:num(syncRow?.revision),updatedAt:syncRow?.updated_at||null,staleHours:syncAge,deviceId:syncRow?.device_id||null},
    backup:{lastSuccessful,ageHours:backupAge},
    notifications:{pending:notifications.filter(row=>row.status==='pending').length,failed:notifications.filter(row=>['failed','dead_letter'].includes(row.status)).length,items:notifications},
    existingAlerts
  };
  snapshot.alerts=detectManagerAlerts(snapshot);
  if(options.persistAlerts)await persistManagerAlerts(snapshot.alerts);
  return snapshot;
}

export function formatManagerBrief(snapshot){
  const block=snapshot.cost.economics?.block,concrete=snapshot.cost.economics?.concrete,top=snapshot.alerts.slice().sort((a,b)=>({critical:3,warning:2,info:1}[b.severity]-{critical:3,warning:2,info:1}[a.severity])).slice(0,3);
  return `<b>ملخص مصنع بن حامد — ${snapshot.day}</b>\n\nالمبيعات: <b>${money(snapshot.sales.total)}</b> ر.س\n• بلوك: ${money(snapshot.sales.block)}\n• خرسانة: ${money(snapshot.sales.concrete)}\nالتحصيلات: <b>${money(snapshot.collections.total)}</b> ر.س\n• خزينة 101: ${money(snapshot.collections.treasury101)}\n• خزينة 104: ${money(snapshot.collections.treasury104)}\nصافي المديونية الجديدة: <b>${money(snapshot.netNewReceivables)}</b> ر.س\nأرصدة متجاوزة للحد: <b>${snapshot.debtors.overLimit.length}</b>\nأعطال حرجة: <b>${snapshot.maintenance.critical.length}</b>\nطلبات شراء معلقة: <b>${snapshot.purchases.pending.length}</b>\nديزل اليوم: <b>${snapshot.fuel.liters.toFixed(1)} لتر</b>${block?`\nتكلفة البلوكة: <b>${money(block.unitCost)}</b> — الهامش: ${money(block.marginPerUnit)}`:''}${concrete?`\nتكلفة م³ الخرسانة: <b>${money(concrete.unitCost)}</b> — الهامش: ${money(concrete.marginPerUnit)}`:''}\n\n<b>أهم التنبيهات</b>\n${top.length?top.map((item,index)=>`${index+1}. ${item.title}`).join('\n'):'لا توجد تنبيهات حرجة.'}`;
}

export function stableAlertDigest(alerts){return crypto.createHash('sha256').update(alerts.map(item=>item.alertKey).sort().join('|')).digest('hex');}
