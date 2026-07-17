import { keyboard, sendMessage } from './telegram.js';
import { breakEvenEconomics, costDataQuality, currentCostPeriod, loadCostDecisionData, normalizeCostPeriod, productEconomics, tripEconomics, vehicleEconomics, workerEconomics } from './bot-costs-data.js';

const VIEW_ROLES=new Set(['admin','manager','accountant','hr']);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const n=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
const money=value=>n(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=value=>n(value).toLocaleString('en-US',{maximumFractionDigits:3});
const percentage=value=>n(value).toLocaleString('en-US',{maximumFractionDigits:1});
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();
const centerName=code=>({block:'البلوك',concrete:'الخرسانة'}[code]||code);
const denied=identity=>!identity?.active||!VIEW_ROLES.has(identity?.role||'');

export function costMenu(){
  return keyboard([
    [{text:'🧭 قرار التكلفة',callback_data:'ent:cost_decision'},{text:'🏭 ربحية المنتجات',callback_data:'ent:cost_products'}],
    [{text:'🚚 تكلفة الرحلات',callback_data:'ent:cost_trips'},{text:'🚛 تكلفة السيارات',callback_data:'ent:cost_vehicles'}],
    [{text:'👷 تكلفة العامل',callback_data:'ent:cost_workers'},{text:'⚖️ نقطة التعادل',callback_data:'ent:cost_breakeven'}],
    [{text:'🧪 جودة بيانات التكلفة',callback_data:'ent:cost_quality'}],
    [{text:'↩️ القائمة الرئيسية',callback_data:'ent:help'}]
  ]);
}

export async function showCostMenu(message,identity){
  if(denied(identity))return sendMessage(message.chat.id,'نظام التكاليف متاح للإدارة والمحاسب والموارد البشرية وفق الصلاحية.');
  return sendMessage(message.chat.id,'<b>نظام التكاليف والربحية</b>\n\nيعرض تكلفة المنتج والرحلة والسيارة والعامل ونقطة التعادل. القرار النهائي يظهر فقط عندما تكون الفترة محسوبة ومعتمدة والبيانات مكتملة.',costMenu());
}

function productDecision(item){
  if(!item.quantity)return'لا توجد كمية مباعة تكفي للحكم.';
  if(item.grossMargin<0)return`خسارة: ارفع متوسط السعر ${money(Math.max(0,-item.priceGap))} ر.س للوحدة أو اخفض التكلفة.`;
  if(item.grossMargin===0)return'تعادل فقط؛ أي خصم إضافي يسبب خسارة.';
  return`مربح حسب البيانات المسجلة؛ هامش الوحدة ${money(item.marginPerUnit)} ر.س.`;
}
async function sendDecision(chatId,data){
  const products=productEconomics(data),quality=costDataQuality(data);
  if(!products.length)return sendMessage(chatId,`<b>قرار التكلفة — ${data.period}</b>\n\nلا توجد نتيجة تكلفة للبلوك أو الخرسانة. أكمل ربط الموظفين والأصول وشغّل احتساب الفترة من شاشة التكاليف في البرنامج.`,costMenu());
  const losing=products.filter(item=>item.grossMargin<0),judgment=losing.length?'موقوف للتوسع':quality.reliable?'جاهز للقرار':'قرار مشروط';
  const lines=products.map(item=>`<b>${centerName(item.costCenter)}</b>\nالإيراد: ${money(item.revenue)} ر.س\nالتكلفة: ${money(item.actualCost)} ر.س\nالهامش: ${money(item.grossMargin)} ر.س${item.marginRate===null?'':` (${percentage(item.marginRate)}%)`}\nالقرار: ${productDecision(item)}`);
  return sendMessage(chatId,`<b>قرار التكلفة — ${data.period}</b>\n\nالحكم: <b>${judgment}</b>\nحالة الفترة: <b>${esc(quality.periodStatus)}</b>\nجودة البيانات: <b>${quality.reliable?'صالحة للقرار':'تحتاج استكمال'}</b>\n\n${lines.join('\n\n')}\n\nلا تغيّر السعر أو حجم الإنتاج اعتمادًا على فترة غير معتمدة أو بها تكلفة غير مصنفة.`,costMenu());
}
async function sendProducts(chatId,data){
  const rows=productEconomics(data);if(!rows.length)return sendMessage(chatId,`لا توجد تكلفة وحدة محسوبة للفترة ${data.period}.`);
  const lines=rows.map(item=>`<b>${centerName(item.costCenter)}</b>\nالكمية: ${quantity(item.quantity)}\nمتوسط البيع: ${money(item.averageSalePrice)} ر.س/وحدة\nتكلفة الوحدة: ${money(item.unitCost)} ر.س\nهامش الوحدة: ${money(item.marginPerUnit)} ر.س\nالفرق عن سعر التعادل: ${item.priceGap>=0?'+':''}${money(item.priceGap)} ر.س\nالقرار: ${productDecision(item)}`);
  return sendMessage(chatId,`<b>ربحية المنتجات — ${data.period}</b>\n\n${lines.join('\n\n')}\n\nتكلفة الوحدة هي حد التعادل المسجل وليست سعر بيع مقترحًا بهامش ربح.`);
}
async function sendTrips(chatId,data){
  const trip=tripEconomics(data);if(!trip.vehicles.length)return sendMessage(chatId,`لا توجد رحلات أو تكاليف سيارات مسجلة للفترة ${data.period}.`);
  const warnings=[];if(!trip.completedTrips)warnings.push('لا توجد رحلات منتهية.');if(trip.costWithoutTrips)warnings.push(`${trip.costWithoutTrips} سيارة عليها تكلفة دون رحلة منتهية.`);if(!trip.distance)warnings.push('قراءات العداد غير كافية لحساب تكلفة الكيلومتر.');
  return sendMessage(chatId,`<b>تكلفة الرحلات — ${data.period}</b>\n\nالرحلات المكتملة: <b>${trip.completedTrips}</b>\nوقود وصيانة وأصل: <b>${money(trip.directCost)} ر.س</b>\nعمالة مرتبطة: <b>${money(trip.laborCost)} ر.س</b>\nإجمالي التشغيل: <b>${money(trip.operatingCost)} ر.س</b>\n${trip.averageTripCost===null?'تكلفة الرحلة: غير متاحة':`متوسط تكلفة الرحلة: <b>${money(trip.averageTripCost)} ر.س</b>`}\n${trip.averageKmCost===null?'':`متوسط تكلفة الكيلومتر: <b>${money(trip.averageKmCost)} ر.س</b>`}\n\nالقرار: ${trip.averageTripCost===null?'استكمل إنهاء الرحلات وربط العداد قبل التسعير.':`متوسط إيراد الرحلة يجب ألا يقل عن ${money(trip.averageTripCost)} ر.س قبل هامش الربح.`}${warnings.length?`\n\n${warnings.map(item=>`• ${item}`).join('\n')}`:''}\n\nربحية رحلة محددة تحتاج ربط إيراد الطلب برقم الرحلة؛ الرقم الحالي متوسط توزيع رقابي.`);
}
async function sendVehicles(chatId,data,query=''){
  let rows=vehicleEconomics(data);if(query){const needle=norm(query);rows=rows.filter(row=>norm(`${row.label} ${row.key} ${row.workers.join(' ')}`).includes(needle));}
  if(!rows.length)return sendMessage(chatId,query?'لا توجد سيارة مطابقة لها تكلفة في الفترة.':`لا توجد تكاليف سيارات مسجلة للفترة ${data.period}.`);
  const lines=rows.slice(0,10).map(row=>`<b>${esc(row.label)}</b>${row.workers.length?` — ${esc([...new Set(row.workers)].join('، '))}`:''}\nوقود ${money(row.fuel)} | صيانة ${money(row.maintenance)} | عمالة ${money(row.labor)}\nالإجمالي ${money(row.operatingCost)} ر.س | الرحلات ${row.trips}\n${row.costPerTrip===null?'تكلفة/رحلة: غير متاحة':`تكلفة/رحلة: ${money(row.costPerTrip)} ر.س`}${row.costPerKm===null?'':` | تكلفة/كم: ${money(row.costPerKm)} ر.س`}\nالقرار: ${row.operatingCost>0&&!row.trips?'تكلفة بلا رحلة مكتملة؛ راجع التشغيل.':'قارن تكلفة الرحلة بسعر التوريد قبل تشغيل السيارة.'}`);
  return sendMessage(chatId,`<b>تكلفة السيارات — ${data.period}</b>\n\n${lines.join('\n\n')}${rows.length>10?`\n\nالمعروض أعلى 10 سيارات تكلفة من ${rows.length}.`:''}`);
}
async function sendWorkers(chatId,data,query=''){
  let rows=workerEconomics(data);if(query){const needle=norm(query);rows=rows.filter(row=>norm(`${row.name} ${row.key} ${row.vehicle}`).includes(needle));}
  if(!rows.length)return sendMessage(chatId,query?'لم أجد عاملًا أو موظفًا مطابقًا.':'لا توجد بيانات موظفين نشطة لحساب التكلفة.');
  const lines=rows.slice(0,12).map(row=>`<b>${esc(row.name)}</b>${row.vehicle?` — مركبة ${esc(row.vehicle)}`:''}\nتكلفة الشهر: ${money(row.monthlyCost)} ر.س ${row.costSource==='cost_engine'?'(محرك التكلفة)':'(الراتب الأساسي)'}\nأيام الحضور: ${row.attendanceDays}${row.costPerDay===null?'':` | تكلفة اليوم: ${money(row.costPerDay)} ر.س`}\nالرحلات المنتهية: ${row.completedTrips}${row.costPerTrip===null?'':` | تكلفة العامل/رحلة: ${money(row.costPerTrip)} ر.س`}\nالقرار: ${!row.costAssigned?'غير مربوط بمركز تكلفة؛ النتيجة غير مكتملة.':row.attendanceDays===0&&row.monthlyCost>0?'تكلفة دون حضور مرصود؛ تحتاج مراجعة.':'قارن التكلفة بالإنتاج أو الرحلات المنجزة.'}`);
  return sendMessage(chatId,`<b>تكلفة العامل والموظف — ${data.period}</b>\n\n${lines.join('\n\n')}${rows.length>12?`\n\nالمعروض أعلى 12 تكلفة من ${rows.length}.`:''}`);
}
async function sendBreakEven(chatId,data){
  const rows=breakEvenEconomics(data);if(!rows.length)return sendMessage(chatId,`لا توجد بيانات كافية لحساب نقطة التعادل للفترة ${data.period}.`);
  const lines=rows.map(item=>`<b>${centerName(item.costCenter)}</b>\nالتكلفة المباشرة: ${money(item.directCost)} ر.س\nالتكلفة غير المباشرة: ${money(item.indirectCost)} ر.س\n${item.breakEvenRevenue===null?'نقطة التعادل غير قابلة للحساب لأن هامش المساهمة غير موجب.':`مبيعات التعادل: ${money(item.breakEvenRevenue)} ر.س\nوحدات التعادل: ${quantity(item.breakEvenUnits)}`}\nالقرار: ${item.breakEvenRevenue===null?'صحح السعر أو التكلفة المباشرة قبل التوسع.':item.revenue>=item.breakEvenRevenue?'المبيعات تجاوزت نقطة التعادل المسجلة.':'المبيعات أقل من نقطة التعادل؛ راجع الحجم والسعر.'}`);
  return sendMessage(chatId,`<b>نقطة التعادل — ${data.period}</b>\n\n${lines.join('\n\n')}\n\nالحساب تقديري: التكلفة غير المباشرة ÷ نسبة هامش المساهمة، ولا يعتمد مع بيانات غير مكتملة.`);
}
async function sendQuality(chatId,data){
  const quality=costDataQuality(data),completion=quality.products.length?Math.min(...quality.products.map(item=>item.completenessPercent)):0;
  return sendMessage(chatId,`<b>جودة بيانات التكلفة — ${data.period}</b>\n\nاكتمال تقرير المنتج: <b>${percentage(completion)}%</b>\nالتكاليف غير المصنفة: <b>${money(quality.unclassified)} ر.س</b>\nالأصول بلا مركز تكلفة: <b>${quality.missingAssets.length}</b>\nالموظفون بلا توزيع تكلفة: <b>${quality.missingEmployees.length}</b>\nرحلات بلا سيارة: <b>${quality.tripsWithoutVehicle}</b>\nرحلات بلا عداد: <b>${quality.tripsWithoutOdometer}</b>\nحالة الفترة: <b>${esc(quality.periodStatus)}</b>\n\nالحكم: <b>${quality.reliable?'البيانات صالحة للقرار':'القرار غير مكتمل'}</b>${quality.blockers.length?`\n\n${quality.blockers.map(item=>`• ${esc(item)}`).join('\n')}`:''}`);
}

async function sendView(message,identity,view,period,query=''){
  if(denied(identity))return sendMessage(message.chat.id,'لا تملك صلاحية عرض بيانات التكلفة.');
  const data=await loadCostDecisionData(period);
  if(view==='decision')return sendDecision(message.chat.id,data);
  if(view==='products')return sendProducts(message.chat.id,data);
  if(view==='trips')return sendTrips(message.chat.id,data);
  if(view==='vehicles')return sendVehicles(message.chat.id,data,query);
  if(view==='workers')return sendWorkers(message.chat.id,data,query);
  if(view==='breakeven')return sendBreakEven(message.chat.id,data);
  if(view==='quality')return sendQuality(message.chat.id,data);
  return showCostMenu(message,identity);
}

export async function handleCostTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw),period=normalizeCostPeriod(raw);
  if(/^\/(costs|cost)(?:@\w+)?(?:\s+.*)?$/i.test(raw)||/^(التكاليف|نظام التكاليف|قائمه التكاليف|قائمة التكاليف)$/.test(value)){await showCostMenu(message,identity);return true;}
  const commands=[
    {re:/^(قرار التكلفه|قرار التكلفة|تحليل التكلفه|تحليل التكلفة)/,view:'decision'},
    {re:/^(ربحيه المنتجات|ربحية المنتجات|تكلفه المنتج|تكلفة المنتج)/,view:'products'},
    {re:/^(تكلفه الرحله|تكلفة الرحلة|تكلفه الرحلات|تكلفة الرحلات)/,view:'trips'},
    {re:/^(نقطه التعادل|نقطة التعادل)/,view:'breakeven'},
    {re:/^(جوده بيانات التكلفه|جودة بيانات التكلفة|اكتمال التكلفه|اكتمال التكلفة)/,view:'quality'}
  ];
  const command=commands.find(item=>item.re.test(value));if(command){await sendView(message,identity,command.view,period);return true;}
  if(/^(تكلفه السياره|تكلفة السيارة|تكلفه المركبه|تكلفة المركبة)/.test(value)){const query=raw.replace(/^.*?(?:السيارة|السياره|المركبة|المركبه)\s*/,'').replace(/20\d{2}[-/]\d{1,2}/,'').trim();await sendView(message,identity,'vehicles',period,query);return true;}
  if(/^(تكلفه العامل|تكلفة العامل|تكلفه الموظف|تكلفة الموظف)/.test(value)){const query=raw.replace(/^.*?(?:العامل|الموظف)\s*/,'').replace(/20\d{2}[-/]\d{1,2}/,'').trim();await sendView(message,identity,'workers',period,query);return true;}
  return false;
}

export async function handleCostCallback(message,from,identity,value){
  if(!String(value||'').startsWith('cost_'))return false;
  if(value==='cost_menu'){await showCostMenu({...message,from},identity);return true;}
  const map={cost_decision:'decision',cost_products:'products',cost_trips:'trips',cost_vehicles:'vehicles',cost_workers:'workers',cost_breakeven:'breakeven',cost_quality:'quality'};
  if(map[value]){await sendView({...message,from},identity,map[value],currentCostPeriod());return true;}
  return false;
}
