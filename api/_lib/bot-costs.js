import { keyboard, sendMessage } from './telegram.js';
import { breakEvenEconomics, costDataQuality, currentCostPeriod, loadCostDecisionData, normalizeCostPeriod, productEconomics, tripEconomics, vehicleEconomics, workerEconomics } from './bot-costs-data.js';
import { findCustomerProfitability, loadCustomerProfitability } from './customer-profitability.js';
import { listLatestMixCosts } from './mix-design-costing.js';
import { config } from './config.js';

const STANDARD_ROLES=new Set(['admin','manager','accountant','hr']);
const MIX_ROLES=new Set(['admin','manager','accountant','quality','concrete_sales']);
const CUSTOMER_ROLES=new Set(['admin','manager','accountant']);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const n=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
const money=value=>n(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=value=>n(value).toLocaleString('en-US',{maximumFractionDigits:3});
const percentage=value=>n(value).toLocaleString('en-US',{maximumFractionDigits:1});
const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();
const centerName=code=>({block:'البلوك',concrete:'الخرسانة'}[code]||code);
const allowedAny=identity=>Boolean(identity?.active&&(STANDARD_ROLES.has(identity.role)||MIX_ROLES.has(identity.role)));

export function costMenu(identity={role:'admin'}){
  const role=identity?.role||'pending',rows=[];
  if(STANDARD_ROLES.has(role)){
    rows.push([{text:'قرار التكلفة',callback_data:'ent:cost_decision'},{text:'ربحية المنتجات',callback_data:'ent:cost_products'}]);
    rows.push([{text:'تكلفة الرحلات',callback_data:'ent:cost_trips'},{text:'تكلفة السيارات',callback_data:'ent:cost_vehicles'}]);
    rows.push([{text:'تكلفة العامل',callback_data:'ent:cost_workers'},{text:'نقطة التعادل',callback_data:'ent:cost_breakeven'}]);
    if(CUSTOMER_ROLES.has(role))rows.push([{text:'ربحية عميل',callback_data:'ent:cost_customer'}]);
    rows.push([{text:'جودة بيانات التكلفة',callback_data:'ent:cost_quality'}]);
  }
  if(MIX_ROLES.has(role))rows.push([{text:'تكلفة الخلطات',callback_data:'ent:cost_mixes'}]);
  rows.push([{text:'القائمة الرئيسية',callback_data:'ent:help'}]);return keyboard(rows);
}

export async function showCostMenu(message,identity){
  if(!allowedAny(identity))return sendMessage(message.chat.id,'لا تملك صلاحية عرض نظام التكاليف.');
  if(identity.role==='concrete_sales')return sendMessage(message.chat.id,'يعرض هذا القسم سعر البيع المعتمد للخلطات فقط، دون تفاصيل تكلفة المواد.',costMenu(identity));
  return sendMessage(message.chat.id,'<b>نظام التكاليف والربحية</b>\n\nيعرض التكلفة الفعلية للمنتجات والمركبات والموظفين والعملاء، والتكلفة المعيارية للخلطات. القرار النهائي يعتمد على فترة تكلفة معتمدة وبيانات مكتملة.',costMenu(identity));
}

function productDecision(item){
  if(!item.quantity)return'لا توجد كمية مباعة تكفي للحكم.';
  if(item.grossMargin<0)return`خسارة: ارفع متوسط السعر ${money(Math.max(0,-item.priceGap))} ر.س للوحدة أو اخفض التكلفة.`;
  if(item.grossMargin===0)return'تعادل فقط؛ أي خصم إضافي يسبب خسارة.';
  return`مربح حسب البيانات المسجلة؛ هامش الوحدة ${money(item.marginPerUnit)} ر.س.`;
}
async function sendDecision(chatId,data,identity){
  const products=productEconomics(data),quality=costDataQuality(data);
  if(!products.length)return sendMessage(chatId,`<b>قرار التكلفة — ${data.period}</b>\n\nلا توجد نتيجة تكلفة للبلوك أو الخرسانة. أكمل ربط الموظفين والأصول وشغّل احتساب الفترة من شاشة التكاليف في البرنامج.`,costMenu(identity));
  const losing=products.filter(item=>item.grossMargin<0),judgment=losing.length?'موقوف للتوسع':quality.reliable?'جاهز للقرار':'قرار مشروط';
  const lines=products.map(item=>`<b>${centerName(item.costCenter)}</b>\nالإيراد: ${money(item.revenue)} ر.س\nالتكلفة: ${money(item.actualCost)} ر.س\nالهامش: ${money(item.grossMargin)} ر.س${item.marginRate===null?'':` (${percentage(item.marginRate)}%)`}\nالقرار: ${productDecision(item)}`);
  return sendMessage(chatId,`<b>قرار التكلفة — ${data.period}</b>\n\nالحكم: <b>${judgment}</b>\nحالة الفترة: <b>${esc(quality.periodStatus)}</b>\nجودة البيانات: <b>${quality.reliable?'صالحة للقرار':'تحتاج استكمال'}</b>\n\n${lines.join('\n\n')}\n\nلا تغيّر السعر أو حجم الإنتاج اعتمادًا على فترة غير معتمدة أو بها تكلفة غير مصنفة.`,costMenu(identity));
}
async function sendProducts(chatId,data){
  const rows=productEconomics(data);if(!rows.length)return sendMessage(chatId,`لا توجد تكلفة وحدة محسوبة للفترة ${data.period}.`);
  const lines=rows.map(item=>`<b>${centerName(item.costCenter)}</b>\nالكمية: ${quantity(item.quantity)}\nمتوسط البيع: ${money(item.averageSalePrice)} ر.س/وحدة\nتكلفة الوحدة: ${money(item.unitCost)} ر.س\nهامش الوحدة: ${money(item.marginPerUnit)} ر.س\nإجمالي الربح: ${money(item.grossMargin)} ر.س${item.marginRate===null?'':`\nنسبة الهامش: ${percentage(item.marginRate)}%`}\nالفرق عن سعر التعادل: ${item.priceGap>=0?'+':''}${money(item.priceGap)} ر.س\nالقرار: ${productDecision(item)}`);
  return sendMessage(chatId,`<b>تكلفة المنتجات وربحيتها — ${data.period}</b>\n\n${lines.join('\n\n')}\n\nتكلفة الوحدة متوسط شهري فعلي وليست سعر بيع مقترحًا.`);
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
async function sendCustomer(chatId,identity,period,query=''){
  if(!CUSTOMER_ROLES.has(identity.role))return sendMessage(chatId,'ربحية العميل متاحة للإدارة والمحاسب فقط.');
  if(!query)return sendMessage(chatId,'اكتب: <code>ربحية عميل اسم العميل 2026-07</code> أو استخدم كود العميل.');
  const data=await loadCustomerProfitability(period),matches=findCustomerProfitability(data.rows,query);
  if(!matches.length)return sendMessage(chatId,'لم أجد عميلًا مطابقًا في مبيعات الفترة.');
  if(matches.length>1&&norm(matches[0].name)!==norm(query)&&norm(matches[0].code)!==norm(query)){return sendMessage(chatId,`وجدت أكثر من نتيجة. استخدم الكود أو الاسم الكامل:\n\n${matches.slice(0,8).map(row=>`• ${esc(row.code||'—')} — ${esc(row.name)}`).join('\n')}`);}
  const row=matches[0],warning=row.marginRate!==null&&row.marginRate<0?'\n\n<b>تحذير: هذا العميل بيع له بأقل من التكلفة الشهرية المتوسطة.</b>':'',quality=!row.reliable?`\n\n<b>دقة النتيجة: تقديرية</b>\n${esc(data.disclaimer)}`:'\n\nدقة النتيجة: تعتمد على تكلفة شهرية وحقول ضريبية مكتملة.';
  return sendMessage(chatId,`<b>ربحية العميل ${esc(row.name)} — ${data.period}</b>\n\nالبلوك: ${quantity(row.blockQuantity)} حبة — التكلفة ${money(row.blockCost)} ر.س\nالخرسانة: ${quantity(row.concreteQuantity)} م³ — التكلفة ${money(row.concreteCost)} ر.س\n\nصافي المبيعات المستخدم: <b>${money(row.netSalesBeforeVat)} ر.س</b>\nالتكلفة التقديرية: <b>${money(row.estimatedCost)} ر.س</b>\nصافي الربح: <b>${money(row.profit)} ر.س</b>\n${row.marginRate===null?'الهامش: غير متاح':`الهامش: <b>${percentage(row.marginRate)}%</b>`}\nالرصيد المستحق: <b>${money(row.balance)} ر.س</b>${warning}${quality}`);
}
async function sendMixes(chatId,identity,query=''){
  if(!MIX_ROLES.has(identity.role))return sendMessage(chatId,'لا تملك صلاحية عرض تكلفة الخلطات.');
  let rows=await listLatestMixCosts();if(query){const needle=norm(query);rows=rows.filter(row=>norm(`${row.code} ${row.name} ${row.version_no}`).includes(needle));}
  if(!rows.length){
    const mixPage=config.publicAppUrl?`\n\nافتح شاشة الخلطات: ${esc(`${config.publicAppUrl.replace(/\/$/,'')}/mix-designs.html`)}`:'';
    return sendMessage(chatId,`لا توجد خلطة محسوبة ومعتمدة حتى الآن. Migration 019 مطبّق ضمن Schema 22؛ لا يلزم تشغيله مرة أخرى.\n\nالخطوات: أضف المواد الخام → سجّل الأسعار واعتمدها → أنشئ خلطة بلوك أو خرسانة → أضف المكونات → «احسب واحفظ» ثم «اعتماد».${mixPage}`);
  }
  const salesOnly=identity.role==='concrete_sales',lines=rows.slice(0,12).map(row=>salesOnly?`<b>${esc(row.code)} — ${esc(row.name)}</b>\nالإصدار ${row.version_no} | سعر البيع المعتمد: <b>${money(row.recommended_price)} ر.س/م³</b>`:`<b>${esc(row.code)} — ${esc(row.name)}</b>\nالإصدار ${row.version_no} | تاريخ الأسعار ${esc(row.price_date)}\nتكلفة المتر: <b>${money(row.total_cost_per_m3)} ر.س</b>\nالهامش المستهدف: ${percentage(row.target_margin_percent)}% | السعر المقترح: <b>${money(row.recommended_price)} ر.س</b>\nالحالة: ${esc(row.design_status)} / ${esc(row.calculation_status)}`);
  return sendMessage(chatId,`<b>تكلفة الخلطات المعيارية</b>\n\n${lines.join('\n\n')}${rows.length>12?`\n\nالمعروض 12 من ${rows.length}.`:''}\n\nالتكلفة معيارية مبنية على وصفة الخلطة والأسعار السارية، وليست بديلًا عن التكلفة الفعلية الشهرية.`);
}
async function sendView(message,identity,view,period,query=''){
  if(!identity?.active)return sendMessage(message.chat.id,'حسابك غير نشط.');
  if(view==='customer')return sendCustomer(message.chat.id,identity,period,query);
  if(view==='mixes')return sendMixes(message.chat.id,identity,query);
  if(!STANDARD_ROLES.has(identity.role))return sendMessage(message.chat.id,'لا تملك صلاحية عرض هذا التقرير.');
  const data=await loadCostDecisionData(period);
  if(view==='decision')return sendDecision(message.chat.id,data,identity);
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
  if(/^(ربحيه عميل|ربحية عميل)/.test(value)){const query=raw.replace(/^.*?(?:عميل)\s*/,'').replace(/20\d{2}[-/]\d{1,2}/,'').trim();await sendView(message,identity,'customer',period,query);return true;}
  if(/^(تكلفه خلطه|تكلفة خلطة|تكلفه الخلطات|تكلفة الخلطات)/.test(value)){const query=raw.replace(/^.*?(?:خلطة|خلطه|الخلطات)\s*/,'').trim();await sendView(message,identity,'mixes',period,query);return true;}
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
  if(value==='cost_customer'){await sendView({...message,from},identity,'customer',currentCostPeriod(),'');return true;}
  if(value==='cost_mixes'){await sendView({...message,from},identity,'mixes',currentCostPeriod(),'');return true;}
  const map={cost_decision:'decision',cost_products:'products',cost_trips:'trips',cost_vehicles:'vehicles',cost_workers:'workers',cost_breakeven:'breakeven',cost_quality:'quality'};
  if(map[value]){await sendView({...message,from},identity,map[value],currentCostPeriod());return true;}
  return false;
}
