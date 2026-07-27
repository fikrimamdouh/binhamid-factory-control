from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

# ── Analytics: enrich the query and calculations used by both site-equivalent reports and Telegram.
path=Path('api/_lib/fuel-analytics.js')
text=path.read_text()
text=replace_once(
    text,
    "const query=`transaction_date=gte.${from}&transaction_date=lte.${to}&select=transaction_date,plate_key,vehicle_name,vehicle_external_id,driver_name,station,fuel_type,liters,amount,curr_odometer,prev_odometer&order=transaction_date.desc&limit=5000`;",
    "const query=`transaction_date=gte.${from}&transaction_date=lte.${to}&select=transaction_date,plate_key,vehicle_name,vehicle_external_id,driver_name,station,fuel_type,receipt_no,liters,unit_price,amount,curr_odometer,prev_odometer,service_km,source_file,imported_at&order=transaction_date.desc&limit=5000`;",
    'fuel fetch fields'
)
start=text.index('function summarize(rows=[]){')
end=text.index('// تعبئة مشبوهة:',start)
summary_block=r'''const median=values=>{const list=(values||[]).map(num).filter(value=>value>0).sort((a,b)=>a-b);if(!list.length)return 0;const middle=Math.floor(list.length/2);return list.length%2?list[middle]:(list[middle-1]+list[middle])/2;};
const rowUnitPrice=row=>num(row?.unit_price)||(num(row?.liters)>0?num(row?.amount)/num(row?.liters):0);
const rowDistance=row=>{const prev=num(row?.prev_odometer),curr=num(row?.curr_odometer),service=num(row?.service_km);return curr>prev&&prev>0?curr-prev:service>0?service:0;};

function summarize(rows=[]){
  const totals={fills:rows.length,liters:0,amount:0,plates:new Set()};
  const byPlate=new Map();
  for(const row of rows){
    const liters=num(row.liters),amount=num(row.amount),plate=clean(row.plate_key)||'—',distance=rowDistance(row);
    totals.liters+=liters;totals.amount+=amount;totals.plates.add(plate);
    const entry=byPlate.get(plate)||{plate,name:clean(row.vehicle_name)||plate,liters:0,amount:0,fills:0,km:0,linked:false};
    entry.liters+=liters;entry.amount+=amount;entry.fills+=1;entry.km+=distance;entry.linked=entry.linked||Boolean(clean(row.vehicle_external_id));
    byPlate.set(plate,entry);
  }
  const vehicles=[...byPlate.values()].map(row=>({...row,
    avgFill:row.fills?row.liters/row.fills:0,
    avgPrice:row.liters?row.amount/row.liters:0,
    kmPerLiter:row.km>0&&row.liters>0?row.km/row.liters:null,
    costPerKm:row.km>0?row.amount/row.km:null,
    per100:row.km>0?Number((row.liters/row.km*100).toFixed(1)):null,
    share:totals.liters>0?row.liters/totals.liters*100:0
  })).sort((a,b)=>b.liters-a.liters);
  return{totals:{...totals,plates:totals.plates.size},vehicles};
}

'''
text=text[:start]+summary_block+text[end:]

insert_marker='// آخر بيانات فعلية وآخر ملف مرفوع:'
extended=r'''function consecutiveFuelRuns(rows=[]){
  const groups=new Map(),dayNumber=value=>{const date=isoDate(value);return date?Math.floor(new Date(`${date}T12:00:00Z`).getTime()/86400000):NaN;};
  for(const row of rows){
    const plate=clean(row.plate_key)||'—',date=isoDate(row.transaction_date);if(!date)continue;
    const group=groups.get(plate)||{plate,name:clean(row.vehicle_name)||plate,driver:clean(row.driver_name),days:new Map()};
    const day=group.days.get(date)||{date,fills:0,liters:0,amount:0};day.fills++;day.liters+=num(row.liters);day.amount+=num(row.amount);group.days.set(date,day);groups.set(plate,group);
  }
  const runs=[];
  for(const group of groups.values()){
    const days=[...group.days.values()].sort((a,b)=>a.date.localeCompare(b.date));let current=[];
    const flush=()=>{if(current.length>=2)runs.push({plate:group.plate,name:group.name,driver:group.driver,from:current[0].date,to:current.at(-1).date,days:current.length,dates:current.map(day=>day.date),fills:current.reduce((sum,day)=>sum+day.fills,0),liters:current.reduce((sum,day)=>sum+day.liters,0),amount:current.reduce((sum,day)=>sum+day.amount,0)});current=[];};
    for(const day of days){if(!current.length||dayNumber(day.date)-dayNumber(current.at(-1).date)===1)current.push(day);else{flush();current=[day];}}flush();
  }
  return runs.sort((a,b)=>b.days-a.days||b.liters-a.liters);
}

export function buildFuelExtendedReport(all=[],{from,to,category='diesel'}={}){
  const statement=buildStatement(all,{from,to,category}),rows=statement.rows;
  const receipts=new Map();
  for(const row of rows){const receipt=clean(row.receipt_no);if(receipt){const list=receipts.get(receipt)||[];list.push(row);receipts.set(receipt,list);}}
  const duplicateReceipts=[...receipts.entries()].filter(([,list])=>list.length>1).map(([receipt,list])=>({receipt,count:list.length,plates:[...new Set(list.map(row=>clean(row.plate_key)))],dates:[...new Set(list.map(row=>isoDate(row.transaction_date)))]}));
  const missingRows=rows.map(row=>{const missing=[];if(!clean(row.receipt_no))missing.push('الإيصال');if(!clean(row.station))missing.push('المحطة');if(!clean(row.driver_name))missing.push('السائق');if(!(num(row.curr_odometer)>0||num(row.service_km)>0))missing.push('العداد');if(!clean(row.vehicle_external_id))missing.push('ربط المركبة');return missing.length?{date:isoDate(row.transaction_date),plate:clean(row.plate_key),name:clean(row.vehicle_name)||clean(row.plate_key),missing}:null;}).filter(Boolean);
  const quality={
    total:rows.length,
    missingReceipt:rows.filter(row=>!clean(row.receipt_no)).length,
    missingStation:rows.filter(row=>!clean(row.station)).length,
    missingDriver:rows.filter(row=>!clean(row.driver_name)).length,
    missingOdometer:rows.filter(row=>!(num(row.curr_odometer)>0||num(row.service_km)>0)).length,
    unlinkedVehicle:rows.filter(row=>!clean(row.vehicle_external_id)).length,
    duplicateReceipts,
    missingRows:missingRows.slice(0,20)
  };
  const checks=quality.total*5,missing=quality.missingReceipt+quality.missingStation+quality.missingDriver+quality.missingOdometer+quality.unlinkedVehicle;
  quality.completeness=checks>0?Math.max(0,(checks-missing)/checks*100):0;
  const priced=rows.map(row=>({...row,calculatedPrice:rowUnitPrice(row)})).filter(row=>row.calculatedPrice>0),values=priced.map(row=>row.calculatedPrice),medianPrice=median(values),averagePrice=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;
  const prices={average:averagePrice,median:medianPrice,min:values.length?Math.min(...values):0,max:values.length?Math.max(...values):0,outliers:priced.filter(row=>medianPrice>0&&Math.abs(row.calculatedPrice-medianPrice)/medianPrice>0.10).sort((a,b)=>Math.abs(b.calculatedPrice-medianPrice)-Math.abs(a.calculatedPrice-medianPrice)).slice(0,15)};
  return{...statement,quality,prices,consecutiveRuns:consecutiveFuelRuns(rows),efficiency:statement.vehicles};
}

export async function loadFuelExtendedReport({from,to,category='diesel'}={}){
  const range=statementRange({from,to}),fetched=await fetchRange(range.from,range.to);
  return{...buildFuelExtendedReport(fetched.rows,{...range,category}),error:fetched.error};
}

export async function loadFuelImportHistory(limit=10){
  const safeLimit=Math.min(30,Math.max(1,Number(limit)||10));
  try{
    const rows=await select('imports',`source=eq.noor-khoy&report_type=eq.fuel&select=id,created_at,original_name,row_count,status,file_path,summary&order=created_at.desc&limit=${safeLimit}`)||[];
    return{rows:rows.map(row=>{const summary=row.summary&&typeof row.summary==='object'?row.summary:{},period=summary.period||{},fuel=summary.fuel||{},diesel=fuel.categories?.diesel||{};return{id:row.id,createdAt:clean(row.created_at),fileName:clean(row.original_name),rowCount:Number(row.row_count||fuel.rows||0),status:clean(row.status),from:isoDate(period.start)||isoDate(summary.source?.reportDate),to:isoDate(period.end)||isoDate(summary.source?.reportDate),dieselRows:Number(diesel.rows||0),dieselLiters:num(diesel.liters),dieselAmount:num(diesel.amount),accountBalance:Number.isFinite(Number(summary.accountBalance))?Number(summary.accountBalance):null,balanceDate:isoDate(summary.balanceDate),filePath:clean(row.file_path)};}),error:''};
  }catch(error){return{rows:[],error:storeFailureReason(error)};}
}

'''
if insert_marker not in text: raise SystemExit('missing extended insert marker')
text=text.replace(insert_marker,extended+insert_marker,1)
path.write_text(text)

# ── Telegram report views.
path=Path('api/_lib/bot-fuel-reports.js')
text=path.read_text()
text=replace_once(
    text,
    "import { loadFuelAnalytics, loadFuelStatement, loadVehicleStatement, loadLatestFuelActivity, monthStart, yesterday } from './fuel-analytics.js';",
    "import { loadFuelAnalytics, loadFuelStatement, loadVehicleStatement, loadLatestFuelActivity, loadFuelExtendedReport, loadFuelImportHistory, periodRange, monthStart, yesterday } from './fuel-analytics.js';",
    'fuel report imports'
)
old_menu="""    [{text:'⚠️ تعبئة للمراجعة',callback_data:at('flags')},{text:'📈 مقارنة بالسابق',callback_data:at('compare')}],
    [{text:'📒 كشف حساب المركبات',callback_data:`fuel:statement:0:${category}`},{text:'📅 مسحوبات أمس',callback_data:`fuel:day:0:${category}`}],"""
new_menu="""    [{text:'⚠️ تعبئة للمراجعة',callback_data:at('flags')},{text:'📈 مقارنة بالسابق',callback_data:at('compare')}],
    [{text:'⚙️ كفاءة وتكلفة',callback_data:at('efficiency')},{text:'💰 تحليل سعر اللتر',callback_data:at('prices')}],
    [{text:'📆 أيام متتالية',callback_data:at('consecutive')},{text:'🧾 اكتمال البيانات',callback_data:at('quality')}],
    [{text:'📊 التوزيع اليومي',callback_data:at('dailytrend')},{text:'📁 ملفات الديزل',callback_data:at('imports')}],
    [{text:'📒 كشف حساب المركبات',callback_data:`fuel:statement:0:${category}`},{text:'📅 مسحوبات أمس',callback_data:`fuel:day:0:${category}`}],"""
text=replace_once(text,old_menu,new_menu,'fuel menu rows')
insert_marker='// كشف حساب المركبات للفترة:'
views=r'''const extendedForDays=(days,category)=>{const range=periodRange(days);return loadFuelExtendedReport({from:range.from,to:range.to,category});};

async function efficiencyView(chatId,identity,days,category){
  const data=await extendedForDays(days,category);
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const rows=data.efficiency.slice(0,15);
  return sendMessage(chatId,compose(
    warmAck(identity),title('⚙️',`الكفاءة والتكلفة — ${CATEGORY_LABEL[category]}`),note(`${arabicDate(data.from)} إلى ${arabicDate(data.to)}`),RULE,
    ...rows.map((row,index)=>compose(
      `${index+1}. <b>${esc(row.name)}</b> — ${qty(Math.round(row.liters))} لتر · ${money(row.amount)} ر.س`,
      `   متوسط التعبئة <b>${qty(row.avgFill.toFixed(1))}</b> لتر · متوسط اللتر <b>${money(row.avgPrice,{decimals:2})}</b> ر.س · الحصة <b>${row.share.toFixed(1)}%</b>`,
      row.kmPerLiter?`   📏 ${qty(Math.round(row.km))} كم · <b>${row.kmPerLiter.toFixed(2)}</b> كم/لتر · <b>${money(row.costPerKm,{decimals:2})}</b> ر.س/كم`:'   📏 <i>العداد غير مكتمل؛ لا يمكن حساب كم/لتر أو تكلفة الكيلومتر.</i>',
      !row.linked?'   🔗 <i>المركبة غير مرتبطة بسجل الأصول.</i>':null
    )),
    RULE,note('الترتيب حسب إجمالي اللترات. الكفاءة لا تُحسب إلا عند وجود قراءة عداد أو مسافة خدمة صحيحة.')
  ),fuelMenu(category,days));
}

async function priceView(chatId,identity,days,category){
  const data=await extendedForDays(days,category);
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const p=data.prices;
  return sendMessage(chatId,compose(
    warmAck(identity),title('💰',`تحليل سعر اللتر — ${CATEGORY_LABEL[category]}`),note(`${arabicDate(data.from)} إلى ${arabicDate(data.to)}`),RULE,
    line('📊','المتوسط',money(p.average,{decimals:3}),'ر.س/لتر'),line('🎯','الوسيط',money(p.median,{decimals:3}),'ر.س/لتر'),line('⬇️','أقل سعر',money(p.min,{decimals:3}),'ر.س/لتر'),line('⬆️','أعلى سعر',money(p.max,{decimals:3}),'ر.س/لتر'),
    p.outliers.length?[RULE,section('⚠️','أسعار تختلف أكثر من 10% عن الوسيط'),...p.outliers.slice(0,10).map((row,index)=>`${index+1}. ${arabicDate(row.transaction_date)} · <b>${esc(row.vehicle_name||row.plate_key)}</b> — ${money(row.calculatedPrice,{decimals:3})} ر.س/لتر`)]:[RULE,note('لا توجد أسعار تتجاوز فرق 10% عن الوسيط.')]
  ),fuelMenu(category,days));
}

async function consecutiveView(chatId,identity,days,category){
  const data=await extendedForDays(days,category);
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const rows=data.consecutiveRuns;
  if(!rows.length)return sendMessage(chatId,compose(warmAck(identity),title('📆','التعبئة في أيام متتالية'),RULE,note(`لا توجد مركبة عُبئت في يومين متتاليين أو أكثر خلال ${days} يومًا.`)),fuelMenu(category,days));
  return sendMessage(chatId,compose(
    warmAck(identity),title('📆',`مركبات عُبئت في أيام متتالية — ${CATEGORY_LABEL[category]}`),RULE,
    ...rows.slice(0,15).map((row,index)=>`${index+1}. <b>${esc(row.name)}</b> — ${row.days} أيام · ${qty(row.fills)} تعبئة · ${qty(Math.round(row.liters))} لتر\n   ${arabicDate(row.from)} إلى ${arabicDate(row.to)}${row.driver?` · 👤 ${esc(row.driver)}`:''}`),
    rows.length>15?note(`و${rows.length-15} حالة أخرى.`):null,RULE,note('هذا مؤشر مراجعة تشغيلية، وليس إثباتًا لوجود مخالفة.')
  ),fuelMenu(category,days));
}

async function qualityView(chatId,identity,days,category){
  const data=await extendedForDays(days,category);
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const q=data.quality;
  return sendMessage(chatId,compose(
    warmAck(identity),title('🧾',`اكتمال بيانات ${CATEGORY_LABEL[category]}`),note(`${arabicDate(data.from)} إلى ${arabicDate(data.to)}`),RULE,
    line('✅','نسبة الاكتمال',`${q.completeness.toFixed(1)}%`),line('🧾','بدون إيصال',qty(q.missingReceipt)),line('⛽','بدون محطة',qty(q.missingStation)),line('👤','بدون سائق',qty(q.missingDriver)),line('📏','بدون عداد',qty(q.missingOdometer)),line('🔗','غير مرتبطة بالأصول',qty(q.unlinkedVehicle)),line('♻️','إيصالات مكررة',qty(q.duplicateReceipts.length)),
    q.duplicateReceipts.length?[RULE,section('♻️','الإيصالات المكررة'),...q.duplicateReceipts.slice(0,8).map(row=>`• <b>${esc(row.receipt)}</b> — ${row.count} مرات · ${row.plates.map(esc).join('، ')}`)]:null,
    q.missingRows.length?[RULE,section('🛠️','أول سجلات تحتاج استكمالًا'),...q.missingRows.slice(0,8).map(row=>`• ${arabicDate(row.date)} · <b>${esc(row.name)}</b> — ${row.missing.map(esc).join('، ')}`)]:null
  ),fuelMenu(category,days));
}

async function dailyTrendView(chatId,identity,days,category){
  const data=await extendedForDays(days,category);
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const rows=data.days.slice().sort((a,b)=>b.date.localeCompare(a.date));
  const highest=rows.slice().sort((a,b)=>b.liters-a.liters)[0];
  return sendMessage(chatId,compose(
    warmAck(identity),title('📊',`التوزيع اليومي — ${CATEGORY_LABEL[category]}`),note(`${arabicDate(data.from)} إلى ${arabicDate(data.to)}`),RULE,
    highest?note(`أعلى يوم سحبًا: ${arabicDate(highest.date)} — ${qty(Math.round(highest.liters))} لتر بقيمة ${money(highest.amount)} ر.س.`):null,
    ...rows.slice(0,20).map(row=>`• ${arabicDate(row.date)} — <b>${qty(Math.round(row.liters))}</b> لتر · ${money(row.amount)} ر.س · ${qty(row.fills)} تعبئة`),
    rows.length>20?note(`و${rows.length-20} يومًا آخر.`):null
  ),fuelMenu(category,days));
}

async function importsView(chatId,identity,days,category){
  const data=await loadFuelImportHistory(12);
  if(data.error)return sendMessage(chatId,compose(title('⚠️','تعذّر قراءة سجل ملفات الديزل'),RULE,note(data.error)),fuelMenu(category,days));
  if(!data.rows.length)return sendMessage(chatId,compose(title('📁','ملفات الديزل'),RULE,note('لا توجد ملفات نور خوي محفوظة بعد.')),fuelMenu(category,days));
  return sendMessage(chatId,compose(
    warmAck(identity),title('📁','آخر ملفات الديزل المستوردة'),RULE,
    ...data.rows.map((row,index)=>compose(
      `${index+1}. <b>${esc(row.fileName||'ملف وقود')}</b>`,
      `   📅 ${row.from&&row.to?`${arabicDate(row.from)} إلى ${arabicDate(row.to)}`:'الفترة غير مسجلة'} · 🧾 ${qty(row.rowCount)} حركة`,
      `   ⛽ ديزل: ${qty(Math.round(row.dieselLiters))} لتر · ${money(row.dieselAmount)} ر.س${row.accountBalance!==null?` · 💳 الرصيد ${money(row.accountBalance,{decimals:2})} ر.س`:''}`
    )),
    RULE,note('الملف الأصلي محفوظ في مركز الوارد، ومنع التكرار يعتمد على فترة التقرير.')
  ),fuelMenu(category,days));
}

'''
if insert_marker not in text: raise SystemExit('missing views insert marker')
text=text.replace(insert_marker,views+insert_marker,1)
callback_marker="""  if(view==='vehicles')return vehiclesView(message.chat.id,identity,days,category);
  if(view==='flags')return flagsView(message.chat.id,identity,days,category);
  if(view==='compare')return compareView(message.chat.id,identity,days,category);"""
callback_new="""  if(view==='vehicles')return vehiclesView(message.chat.id,identity,days,category);
  if(view==='flags')return flagsView(message.chat.id,identity,days,category);
  if(view==='compare')return compareView(message.chat.id,identity,days,category);
  if(view==='efficiency')return efficiencyView(message.chat.id,identity,days,category);
  if(view==='prices')return priceView(message.chat.id,identity,days,category);
  if(view==='consecutive')return consecutiveView(message.chat.id,identity,days,category);
  if(view==='quality')return qualityView(message.chat.id,identity,days,category);
  if(view==='dailytrend')return dailyTrendView(message.chat.id,identity,days,category);
  if(view==='imports')return importsView(message.chat.id,identity,days,category);"""
text=replace_once(text,callback_marker,callback_new,'callbacks')
command_marker="""  // كشف الحساب الافتراضي: من أول الشهر حتى أمس.
  if(/^\/(fuel_statement)$/i.test(raw)||/^(كشف حساب|كشف حساب الديزل|كشف حساب المركبات|كشف حساب السيارات|كشوف الحسابات|كشف الديزل)$/.test(value))"""
command_new="""  if(/^\/(fuel_efficiency)$/i.test(raw)||/^(كفاءه الديزل|كفاءة الديزل|تكلفه الديزل|تكلفة الديزل)$/.test(value))return guard(()=>efficiencyView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_prices)$/i.test(raw)||/^(تحليل سعر الديزل|سعر لتر الديزل|اسعار الديزل|أسعار الديزل)$/.test(value))return guard(()=>priceView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_consecutive)$/i.test(raw)||/^(ايام تعبئه متتاليه|أيام تعبئة متتالية|تعبئه متتاليه|تعبئة متتالية)$/.test(value))return guard(()=>consecutiveView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_quality)$/i.test(raw)||/^(اكتمال بيانات الديزل|جوده بيانات الديزل|جودة بيانات الديزل)$/.test(value))return guard(()=>qualityView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_daily_trend)$/i.test(raw)||/^(التوزيع اليومي للديزل|تحليل ايام الديزل|تحليل أيام الديزل)$/.test(value))return guard(()=>dailyTrendView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_imports)$/i.test(raw)||/^(ملفات الديزل|سجل رفع الديزل|اخر ملفات الديزل|آخر ملفات الديزل)$/.test(value))return guard(()=>importsView(message.chat.id,identity,30,'diesel'));
  // كشف الحساب الافتراضي: من أول الشهر حتى أمس.
  if(/^\/(fuel_statement)$/i.test(raw)||/^(كشف حساب|كشف حساب الديزل|كشف حساب المركبات|كشف حساب السيارات|كشوف الحسابات|كشف الديزل)$/.test(value))"""
text=replace_once(text,command_marker,command_new,'text commands')
path.write_text(text)

# ── Central nickname handling: known channel kunyas override account names.
path=Path('api/_lib/bot-profile.js')
text=path.read_text()
marker="const REPORT_LABELS={"
pos=text.index(marker)
end=text.index(';',pos)+1
addition=r'''

export function channelKunya(externalId,ownerId=config.telegramOwnerId){
  const id=String(externalId||'').trim(),owner=String(ownerId||'').trim();
  if(owner&&id===owner)return'أبو مالك';
  if(id==='6870312376')return'أبو فلاح';
  return'';
}
'''
if 'export function channelKunya' not in text:text=text[:end]+addition+text[end:]
old=r'''export async function enrichIdentity(basic,from){
  const identity=Array.isArray(basic)?basic[0]:basic;
  if(!identity?.user_id)return {...identity,external_id:String(from?.id||''),full_name:[from?.first_name,from?.last_name].filter(Boolean).join(' ')};
  let profile;try{profile=(await select('app_users',`id=eq.${encodeURIComponent(identity.user_id)}&select=id,full_name,nickname,role,active&limit=1`))?.[0];}catch{profile=(await select('app_users',`id=eq.${encodeURIComponent(identity.user_id)}&select=id,full_name,role,active&limit=1`))?.[0];}
  return {...identity,...profile,user_id:identity.user_id,external_id:identity.external_id||String(from?.id||'')};
}'''
new=r'''export async function enrichIdentity(basic,from){
  const identity=Array.isArray(basic)?basic[0]:basic,externalId=String(identity?.external_id||from?.id||''),fixed=channelKunya(externalId);
  if(!identity?.user_id)return {...identity,external_id:externalId,full_name:[from?.first_name,from?.last_name].filter(Boolean).join(' '),nickname:fixed||identity?.nickname||''};
  let profile;try{profile=(await select('app_users',`id=eq.${encodeURIComponent(identity.user_id)}&select=id,full_name,nickname,role,active&limit=1`))?.[0];}catch{profile=(await select('app_users',`id=eq.${encodeURIComponent(identity.user_id)}&select=id,full_name,role,active&limit=1`))?.[0];}
  return {...identity,...profile,user_id:identity.user_id,external_id:externalId,nickname:fixed||profile?.nickname||identity?.nickname||''};
}'''
text=replace_once(text,old,new,'enrich identity')
old=r'''export function displayName(identity,from){
  if(config.telegramOwnerId&&String(from?.id)===config.telegramOwnerId)return 'أبو مالك';
  const nickname=String(identity?.nickname||'').trim(),stored=String(identity?.full_name||'').trim();'''
new=r'''export function displayName(identity,from){
  const fixed=channelKunya(identity?.external_id||from?.id);if(fixed)return fixed;
  const nickname=String(identity?.nickname||'').trim(),stored=String(identity?.full_name||'').trim();'''
text=replace_once(text,old,new,'display name')
path.write_text(text)

# ── Regression tests.
Path('tests/fuel-extra-reports-and-kunya.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFuelExtendedReport } from '../api/_lib/fuel-analytics.js';
import { channelKunya, displayName } from '../api/_lib/bot-profile.js';

const sample=[
  {transaction_date:'2026-07-01',plate_key:'ABC123',vehicle_name:'شاحنة 1',vehicle_external_id:'V1',driver_name:'سائق 1',station:'نور',fuel_type:'Diesel',receipt_no:'R1',liters:100,unit_price:1.8,amount:180,prev_odometer:1000,curr_odometer:1200},
  {transaction_date:'2026-07-02',plate_key:'ABC123',vehicle_name:'شاحنة 1',vehicle_external_id:'V1',driver_name:'سائق 1',station:'نور',fuel_type:'Diesel',receipt_no:'R1',liters:110,unit_price:1.82,amount:200.2,prev_odometer:1200,curr_odometer:1410},
  {transaction_date:'2026-07-04',plate_key:'XYZ999',vehicle_name:'شاحنة 2',vehicle_external_id:null,driver_name:'',station:'',fuel_type:'Diesel',receipt_no:'',liters:50,unit_price:3.2,amount:160,prev_odometer:0,curr_odometer:0}
];

test('extended fuel report matches site control concepts',()=>{
  const data=buildFuelExtendedReport(sample,{from:'2026-07-01',to:'2026-07-31',category:'diesel'});
  assert.equal(data.totals.fills,3);
  assert.equal(data.consecutiveRuns.length,1);
  assert.equal(data.consecutiveRuns[0].days,2);
  assert.equal(data.quality.duplicateReceipts.length,1);
  assert.equal(data.quality.missingReceipt,1);
  assert.equal(data.quality.unlinkedVehicle,1);
  assert.equal(data.prices.outliers.length,1);
  assert.ok(data.efficiency[0].avgFill>0);
  assert.ok(data.efficiency[0].kmPerLiter>0);
});

test('known Telegram accounts use kunya instead of account name',()=>{
  assert.equal(channelKunya('111','111'),'أبو مالك');
  assert.equal(channelKunya('6870312376','111'),'أبو فلاح');
  assert.equal(displayName({external_id:'6870312376',full_name:'مانع'},{}),'أبو فلاح');
});

test('Telegram diesel menu exposes the additional site-equivalent reports',()=>{
  const source=fs.readFileSync(new URL('../api/_lib/bot-fuel-reports.js',import.meta.url),'utf8');
  for(const label of ['كفاءة وتكلفة','تحليل سعر اللتر','أيام متتالية','اكتمال البيانات','التوزيع اليومي','ملفات الديزل'])assert.match(source,new RegExp(label));
});
''')
