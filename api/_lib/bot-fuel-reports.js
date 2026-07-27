// صفحة تقارير الديزل: كل ما يخص الاستهلاك في مكان واحد — ملخص الفترة، استهلاك كل
// مركبة وكفاءتها، التعبئة المشبوهة، والمقارنة بالفترة السابقة.
import { sendMessage, keyboard } from './telegram.js';
import { loadFuelAnalytics, loadFuelStatement, loadVehicleStatement, loadLatestFuelActivity, loadFuelExtendedReport, loadFuelImportHistory, loadLatestVehicleDieselBalance, periodRange, monthStart, yesterday } from './fuel-analytics.js';
import { compose, title, section, line, note, alert, trend, money, qty, arabicDate, esc, warmAck, RULE } from './bot-format.js';

const VIEW_ROLES=new Set(['admin','manager','accountant','fuel_operator','mechanic','procurement']);
export const canUseFuelReports=identity=>Boolean(identity?.active&&VIEW_ROLES.has(String(identity.role||'')));

// الفئة تُمرَّر في بيانات الزر حتى تبقى الشاشة على نفس الوقود عند تغيير المدة،
// فلا يقفز المستخدم من البنزين إلى الديزل لمجرد أنه ضغط «آخر 7 أيام».
const CATEGORY_LABEL={diesel:'الديزل',petrol:'البنزين',all:'كل الوقود'};
export function fuelMenu(category='diesel',days=30){
  const at=(view,value=days,cat=category)=>`fuel:${view}:${value}:${cat}`;
  return keyboard([
    [{text:`⛽ ملخص ${CATEGORY_LABEL[category]}`,callback_data:at('summary')},{text:'🚚 استهلاك المركبات',callback_data:at('vehicles')}],
    [{text:'⚠️ تعبئة للمراجعة',callback_data:at('flags')},{text:'📈 مقارنة بالسابق',callback_data:at('compare')}],
    [{text:'⚙️ كفاءة وتكلفة',callback_data:at('efficiency')},{text:'💰 تحليل سعر اللتر',callback_data:at('prices')}],
    [{text:'📆 أيام متتالية',callback_data:at('consecutive')},{text:'🧾 اكتمال البيانات',callback_data:at('quality')}],
    [{text:'📊 التوزيع اليومي',callback_data:at('dailytrend')},{text:'📁 ملفات الديزل',callback_data:at('imports')}],
    [{text:'📒 كشف حساب المركبات',callback_data:`fuel:statement:0:${category}`},{text:'📅 مسحوبات أمس',callback_data:`fuel:day:0:${category}`}],
    [{text:'🗓️ آخر 7 أيام',callback_data:at('summary',7)},{text:'🗓️ آخر 30 يوم',callback_data:at('summary',30)},{text:'🗓️ آخر 90 يوم',callback_data:at('summary',90)}],
    [{text:category==='diesel'?'✅ ديزل':'⛽ ديزل',callback_data:at('summary',days,'diesel')},{text:category==='petrol'?'✅ بنزين':'🚗 بنزين',callback_data:at('summary',days,'petrol')},{text:category==='all'?'✅ الكل':'🛢️ الكل',callback_data:at('summary',days,'all')}]
  ]);
}

// أزرار الكشف: التنقّل بين المركبات يتم بالفهرس لا برقم اللوحة، لأن اللوحة عربية
// ومتعددة البايتات وحد callback_data في تليجرام 64 بايت.
function statementMenu(category,from,to,vehicles=[]){
  const rows=vehicles.slice(0,6).map((vehicle,index)=>({text:`${index+1}. ${vehicle.name}`.slice(0,28),callback_data:`fuel:veh:${index}:${category}:${from}:${to}`}));
  const pairs=[];for(let index=0;index<rows.length;index+=2)pairs.push(rows.slice(index,index+2));
  return keyboard([
    ...pairs,
    [{text:'📅 مسحوبات أمس',callback_data:`fuel:day:0:${category}`},{text:'📆 الشهر حتى أمس',callback_data:`fuel:statement:0:${category}`}],
    [{text:'⛽ ديزل',callback_data:`fuel:statement:0:diesel:${from}:${to}`},{text:'🚗 بنزين',callback_data:`fuel:statement:0:petrol:${from}:${to}`},{text:'🛢️ الكل',callback_data:`fuel:statement:0:all:${from}:${to}`}],
    [{text:'⬅️ رجوع للتقارير',callback_data:`fuel:summary:30:${category}`}]
  ]);
}

export async function showFuelMenu(message,identity){
  if(!canUseFuelReports(identity))return sendMessage(message.chat.id,'تقارير الديزل متاحة للإدارة والحسابات ومسؤول الوقود والورشة والمشتريات.');
  return sendMessage(message.chat.id,compose(warmAck(identity),title('⛽','تقارير الديزل'),RULE,'اختر التقرير المطلوب:'),fuelMenu('diesel',30));
}

// «لا يوجد ديزل» و«لا يوجد شيء إطلاقًا» حالتان مختلفتان: الأولى تعني أن الملف
// وصل لكنه بنزين فقط، فالإرشاد الصحيح هو تبديل الفئة لا إعادة الرفع.
// خطأ القراءة يُعرض كخطأ لا كـ«لا توجد حركات»: الثاني يجعل القسم يكذب ويترك
// المستخدم ينتظر بيانات لن تصل أبدًا.
const empty=(days,category,hasAnyData,error)=>error?compose(
  title('⚠️','تعذّر قراءة سجل الوقود'),RULE,
  `🛠️ ${esc(error)}`,
  note('التقارير ستعمل فور معالجة هذا السبب؛ الملفات المرسلة لن تضيع.')
):compose(
  title('⛽',`تقارير ${CATEGORY_LABEL[category]}`),RULE,
  note(`لا توجد حركات ${CATEGORY_LABEL[category]} مسجّلة في آخر ${days} يومًا.`),
  hasAnyData?note('توجد حركات وقود من فئة أخرى في هذه الفترة — بدّل الفئة من أزرار الأسفل.'):note('نزّل ملف «اكسيل» من موقع المحطة وأرسله هنا لتبدأ الحركات في التسجيل.')
);

async function summaryView(chatId,identity,days,category){
  const [data,unusedDieselBalance]=await Promise.all([loadFuelAnalytics(days,{category}),category==='petrol'?Promise.resolve(null):loadLatestVehicleDieselBalance()]);
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const{totals,previousTotals,otherTotals,range,vehicles}=data;
  const perLiter=totals.liters>0?totals.amount/totals.liters:0;
  return sendMessage(chatId,compose(
    warmAck(identity),
    title('⛽',`ملخص ${CATEGORY_LABEL[category]} — ${days} يومًا`),
    note(`${arabicDate(range.from)} إلى ${arabicDate(range.to)}`),
    RULE,
    line('🛢️','اللترات',qty(Math.round(totals.liters)),'لتر'),
    line('💰','التكلفة',money(totals.amount),'ر.س'),
    line('🧾','التعبئات',qty(totals.fills)),
    line('🚚','المركبات',qty(totals.plates)),
    line('📊','متوسط اللتر',money(perLiter.toFixed(2)),'ر.س'),
    unusedDieselBalance?[RULE,section('🛢️','رصيد الديزل غير المستخدم بالمركبات'),
      line('💰','الرصيد المتوفر',money(unusedDieselBalance.total),'ر.س'),
      line('🚚','مركبات لها رصيد',qty(unusedDieselBalance.vehicleCount)),
      note(`آخر قراءة موثقة: ${arabicDate(unusedDieselBalance.capturedAt)}`)]:null,
    previousTotals?.liters?[RULE,section('📈','مقابل الفترة السابقة'),
      `   اللترات ${trend(totals.liters,previousTotals.liters,{invert:true})}`,
      `   التكلفة ${trend(totals.amount,previousTotals.amount,{invert:true})}`]:null,
    vehicles.length?[section('🔝','الأعلى استهلاكًا'),
      ...vehicles.slice(0,3).map((row,index)=>`   ${index+1}. ${esc(row.name)} — <b>${qty(Math.round(row.liters))}</b> لتر`)]:null,
    otherTotals?.fills?[RULE,note(`خارج ${CATEGORY_LABEL[category]}: ${qty(otherTotals.fills)} تعبئة بإجمالي ${money(otherTotals.amount)} ر.س — بدّل الفئة لعرضها.`)]:null,
    data.flags.length?[RULE,alert(`${data.flags.length} تعبئة تحتاج مراجعة — اضغط «تعبئة للمراجعة»`)]:null
  ),fuelMenu(category,days));
}

async function vehiclesView(chatId,identity,days,category){
  const data=await loadFuelAnalytics(days,{category});
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const rows=data.vehicles.slice(0,15);
  return sendMessage(chatId,compose(
    warmAck(identity),
    title('🚚',`استهلاك المركبات (${CATEGORY_LABEL[category]}) — ${days} يومًا`),
    RULE,
    ...rows.map((row,index)=>compose(
      `${index+1}. <b>${esc(row.name)}</b>`,
      `   🛢️ ${qty(Math.round(row.liters))} لتر · 💰 ${money(row.amount)} ر.س · ${qty(row.fills)} تعبئة`,
      // لتر/100كم يكشف المركبة التي تشرب أكثر من أختها بنفس المسافة.
      row.per100?`   📏 ${qty(row.km)} كم · <b>${row.per100}</b> لتر/100كم`:'   📏 <i>العدّاد غير مسجّل</i>'
    )),
    RULE,
    // تقرير المحطة يرسل العدّاد أصفارًا، فنقول ذلك صراحةً بدل ترك خانة فارغة.
    rows.some(row=>row.per100)?note('الكفاءة تُحسب من العدّاد؛ سجّله عند التعبئة لتظهر لكل مركبة.'):note('تقرير المحطة يصل بقراءة عدّاد صفرية، لذلك لا تظهر الكفاءة (لتر/100كم). سجّل العدّاد عند التعبئة من زر «قراءة عداد» ليُحتسب.')
  ),fuelMenu(category,days));
}

async function flagsView(chatId,identity,days,category){
  const data=await loadFuelAnalytics(days,{category});
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  if(!data.flags.length)return sendMessage(chatId,compose(title('✅','لا توجد تعبئة مشبوهة'),RULE,note(`فُحصت ${data.totals.fills} تعبئة خلال ${days} يومًا.`)),fuelMenu(category,days));
  return sendMessage(chatId,compose(
    warmAck(identity),
    title('⚠️',`تعبئة تحتاج مراجعة (${data.flags.length})`),
    RULE,
    ...data.flags.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b> — ${arabicDate(row.date)}\n   ${esc(row.text)}`),
    RULE,
    // إشارة تحقيق لا اتهام: قد يكون لها سبب تشغيلي مشروع.
    note('هذه إشارات للمراجعة وقد يكون لها سبب تشغيلي؛ تأكد قبل أي إجراء.')
  ),fuelMenu(category,days));
}

async function compareView(chatId,identity,days,category){
  const data=await loadFuelAnalytics(days,{category});
  if(!data.hasData)return sendMessage(chatId,empty(days,category,data.hasAnyData,data.error),fuelMenu(category,days));
  const{totals,previousTotals,range}=data;
  if(!previousTotals?.liters)return sendMessage(chatId,compose(title('📈','المقارنة'),RULE,note('لا توجد بيانات كافية للفترة السابقة بعد.')),fuelMenu(category,days));
  const litersDiff=totals.liters-previousTotals.liters,costDiff=totals.amount-previousTotals.amount;
  return sendMessage(chatId,compose(
    warmAck(identity),
    title('📈',`المقارنة — ${days} يومًا`),
    note(`${arabicDate(range.from)} — ${arabicDate(range.to)} مقابل ما قبلها`),
    RULE,
    line('🛢️','اللترات',`${qty(Math.round(totals.liters))} مقابل ${qty(Math.round(previousTotals.liters))}`),
    `   ${trend(totals.liters,previousTotals.liters,{invert:true})} · ${litersDiff>=0?'+':''}${qty(Math.round(litersDiff))} لتر`,
    line('💰','التكلفة',`${money(totals.amount)} مقابل ${money(previousTotals.amount)}`),
    `   ${trend(totals.amount,previousTotals.amount,{invert:true})} · ${costDiff>=0?'+':''}${money(Math.round(costDiff))} ر.س`,
    line('🧾','التعبئات',`${qty(totals.fills)} مقابل ${qty(previousTotals.fills)}`),
    RULE,
    // الزيادة ليست سيئة دائمًا: قد يكون الإنتاج أعلى، لذلك تُعرض كإشارة لا حكم.
    note('قارن الزيادة بحجم التشغيل والإنتاج قبل الحكم على كفاءة الاستهلاك.')
  ),fuelMenu(category,days));
}

const extendedForDays=(days,category)=>{const range=periodRange(days);return loadFuelExtendedReport({from:range.from,to:range.to,category});};

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

// كشف حساب المركبات للفترة: «كل سيارة سحبت كام» — الافتراضي من أول الشهر حتى
// أمس، لأن اليوم الجاري لم يكتمل ولم يصل تقريره من المحطة بعد.
async function statementView(chatId,identity,category,from,to){
  const data=await loadFuelStatement({from,to,category});
  if(!data.hasData)return sendMessage(chatId,data.error?compose(
    title('⚠️','تعذّر قراءة سجل الوقود'),RULE,`🛠️ ${esc(data.error)}`,
    note('الكشف سيعمل فور معالجة هذا السبب؛ الملفات المرسلة لن تضيع.')
  ):compose(
    title('📒',`كشف حساب ${CATEGORY_LABEL[category]}`),
    note(`${arabicDate(data.from)} إلى ${arabicDate(data.to)}`),RULE,
    note('لا توجد مسحوبات في هذه الفترة.'),
    data.hasAnyData?note('توجد حركات من فئة وقود أخرى — بدّل الفئة من الأسفل.'):note('أرسل ملف «اكسيل» من موقع المحطة لتسجيل الحركات.')
  ),statementMenu(category,data.from,data.to,[]));
  const{totals,vehicles,days,perLiter}=data;
  return sendMessage(chatId,compose(
    warmAck(identity),
    title('📒',`كشف حساب المركبات — ${CATEGORY_LABEL[category]}`),
    note(`من ${arabicDate(data.from)} إلى ${arabicDate(data.to)}`),
    RULE,
    line('🛢️','إجمالي المسحوب',qty(Math.round(totals.liters)),'لتر'),
    line('💰','إجمالي القيمة',money(totals.amount),'ر.س'),
    line('🧾','عدد التعبئات',qty(totals.fills)),
    line('🚚','عدد المركبات',qty(totals.plates)),
    line('📊','متوسط اللتر',money(perLiter.toFixed(2)),'ر.س'),
    RULE,
    section('🚚','المسحوب لكل مركبة'),
    ...vehicles.slice(0,20).map((row,index)=>{
      const share=totals.liters>0?(row.liters/totals.liters*100).toFixed(1):'0.0';
      return `${index+1}. <b>${esc(row.name)}</b>\n   🛢️ ${qty(Math.round(row.liters))} لتر · 💰 ${money(row.amount)} ر.س · ${qty(row.fills)} تعبئة · ${share}%`;
    }),
    vehicles.length>20?note(`و${vehicles.length-20} مركبة أخرى.`):null,
    days.length>1?[RULE,section('📅','أعلى الأيام سحبًا'),
      ...days.slice().sort((a,b)=>b.liters-a.liters).slice(0,3).map(day=>`   ${arabicDate(day.date)} — <b>${qty(Math.round(day.liters))}</b> لتر · ${money(day.amount)} ر.س`)]:null,
    data.otherTotals?.fills?[RULE,note(`خارج ${CATEGORY_LABEL[category]}: ${qty(data.otherTotals.fills)} تعبئة بمبلغ ${money(data.otherTotals.amount)} ر.س.`)]:null,
    RULE,
    note('اضغط اسم المركبة لكشف حسابها التفصيلي بكل تعبئة.')
  ),statementMenu(category,data.from,data.to,vehicles));
}

// كشف حساب سيارة واحدة: كل تعبئة بتاريخها ومحطتها وسائقها لتُراجَع سطرًا سطرًا.
async function vehicleStatementView(chatId,identity,index,category,from,to){
  const data=await loadFuelStatement({from,to,category});
  const target=data.vehicles[index];
  if(!target)return sendMessage(chatId,compose(title('📒','كشف حساب مركبة'),RULE,note('لم أعد أجد هذه المركبة في الفترة المحددة.')),statementMenu(category,data.from,data.to,data.vehicles));
  const detail=await loadVehicleStatement(target.plate,{from:data.from,to:data.to,category});
  const{vehicleTotals}=detail;
  return sendMessage(chatId,compose(
    warmAck(identity),
    title('📒',`كشف حساب — ${esc(target.name)}`),
    note(`${arabicDate(data.from)} إلى ${arabicDate(data.to)} · ${CATEGORY_LABEL[category]}`),
    RULE,
    line('🛢️','المسحوب',qty(Math.round(vehicleTotals.liters)),'لتر'),
    line('💰','القيمة',money(vehicleTotals.amount),'ر.س'),
    line('🧾','التعبئات',qty(vehicleTotals.fills)),
    line('📊','متوسط اللتر',money(vehicleTotals.perLiter.toFixed(2)),'ر.س'),
    line('📈','نسبة من الأسطول',`${detail.share.toFixed(1)}%`),
    RULE,
    section('🧾','تفاصيل التعبئات'),
    ...detail.fills.slice(0,25).map((fill,order)=>`${order+1}. ${arabicDate(fill.date)} — <b>${qty(Math.round(fill.liters))}</b> لتر · ${money(fill.amount)} ر.س\n   ⛽ ${esc(fill.station||'—')}${fill.driver?` · 👤 ${esc(fill.driver)}`:''}`),
    detail.fills.length>25?note(`و${detail.fills.length-25} تعبئة أخرى في الفترة.`):null
  ),statementMenu(category,data.from,data.to,data.vehicles));
}

// «تقرير اليوم» يعني مسحوبات أمس. إذا لم تصل مزامنة أمس بعد فلا نعرض
// صفرًا مضللًا؛ نرجع إلى آخر يوم بيانات متاح ونذكر تاريخ آخر رفع بوضوح.
function uploadNote(latest={}){
  const reportDate=latest.lastReportDate||latest.latestDate;
  if(!reportDate)return null;
  return note(`آخر ملف مرفوع يغطي حتى ${arabicDate(reportDate)}${latest.sourceFile?` — ${esc(latest.sourceFile)}`:''}.`);
}
function dayReportBody(identity,category,day,data,contextNote=null,latest=null){
  const{totals,vehicles,perLiter}=data;
  return compose(warmAck(identity),title('📅',`مسحوبات ${arabicDate(day)} — ${CATEGORY_LABEL[category]}`),contextNote?note(contextNote):null,latest?uploadNote(latest):null,RULE,line('🛢️','المسحوب',qty(Math.round(totals.liters)),'لتر'),line('💰','القيمة',money(totals.amount),'ر.س'),line('🧾','التعبئات',qty(totals.fills)),line('🚚','المركبات',qty(totals.plates)),line('📊','متوسط اللتر',money(perLiter.toFixed(2)),'ر.س'),RULE,section('🚚','لكل مركبة'),...vehicles.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b> — ${qty(Math.round(row.liters))} لتر · ${money(row.amount)} ر.س${row.fills>1?` · ${qty(row.fills)} تعبئات`:''}`),data.otherTotals?.fills?[RULE,note(`وأيضًا ${qty(data.otherTotals.fills)} تعبئة من فئة أخرى بمبلغ ${money(data.otherTotals.amount)} ر.س.`)]:null);
}
async function dayView(chatId,identity,category,date){
  const requestedDay=date||yesterday();
  const data=await loadFuelStatement({from:requestedDay,to:requestedDay,category});
  if(data.error)return sendMessage(chatId,compose(title('⚠️','تعذّر قراءة سجل الوقود'),RULE,`🛠️ ${esc(data.error)}`,note('التقرير سيعمل فور معالجة هذا السبب؛ الملفات المرسلة لن تضيع.')),statementMenu(category,requestedDay,requestedDay,[]));
  if(data.hasData)return sendMessage(chatId,dayReportBody(identity,category,requestedDay,data),statementMenu(category,requestedDay,requestedDay,data.vehicles));
  const latest=await loadLatestFuelActivity({category});
  if(latest.latestDate&&latest.latestDate!==requestedDay){
    const latestData=await loadFuelStatement({from:latest.latestDate,to:latest.latestDate,category});
    if(latestData.hasData)return sendMessage(chatId,dayReportBody(identity,category,latest.latestDate,latestData,`لا توجد بيانات مسجلة ليوم ${arabicDate(requestedDay)}؛ المعروض هو آخر يوم متاح.`,latest),statementMenu(category,latest.latestDate,latest.latestDate,latestData.vehicles));
  }
  return sendMessage(chatId,compose(title('📅',`مسحوبات ${arabicDate(requestedDay)}`),RULE,note(`لا توجد مسحوبات ${CATEGORY_LABEL[category]} مسجّلة في هذا اليوم.`),uploadNote(latest),data.hasAnyData?note('توجد حركات من فئة وقود أخرى في اليوم نفسه — بدّل الفئة.'):note('لم تصل بيانات أحدث إلى سجل الوقود بعد.')),statementMenu(category,requestedDay,requestedDay,[]));
}

const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const isoOrNull=value=>ISO_DATE.test(String(value||''))?String(value):null;

export async function handleFuelCallback(message,identity,value=''){
  if(!canUseFuelReports(identity))return sendMessage(message.chat.id,'تقارير الديزل غير متاحة لدورك الحالي.');
  const[view,slot,categoryRaw,fromRaw,toRaw]=String(value||'summary').split(':');
  const days=Math.min(365,Math.max(1,Number(slot)||30));
  // أي فئة غير معروفة تعود للديزل: القسم أُنشئ للديزل والباقي إضافة.
  const category=CATEGORY_LABEL[categoryRaw]?categoryRaw:'diesel';
  const from=isoOrNull(fromRaw),to=isoOrNull(toRaw);
  if(view==='statement')return statementView(message.chat.id,identity,category,from||monthStart(),to||yesterday());
  if(view==='day')return dayView(message.chat.id,identity,category,isoOrNull(fromRaw)||null);
  if(view==='veh')return vehicleStatementView(message.chat.id,identity,Math.max(0,Number(slot)||0),category,from||monthStart(),to||yesterday());
  if(view==='vehicles')return vehiclesView(message.chat.id,identity,days,category);
  if(view==='flags')return flagsView(message.chat.id,identity,days,category);
  if(view==='compare')return compareView(message.chat.id,identity,days,category);
  if(view==='efficiency')return efficiencyView(message.chat.id,identity,days,category);
  if(view==='prices')return priceView(message.chat.id,identity,days,category);
  if(view==='consecutive')return consecutiveView(message.chat.id,identity,days,category);
  if(view==='quality')return qualityView(message.chat.id,identity,days,category);
  if(view==='dailytrend')return dailyTrendView(message.chat.id,identity,days,category);
  if(view==='imports')return importsView(message.chat.id,identity,days,category);
  return summaryView(message.chat.id,identity,days,category);
}

export async function handleFuelTextCommand(message,identity,text){
  const raw=String(text||'').trim();
  const value=raw.toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/\s+/g,' ');
  const guard=async run=>{if(!canUseFuelReports(identity)){await sendMessage(message.chat.id,'تقارير الديزل غير متاحة لدورك الحالي.');return true;}await run();return true;};
  // «تقرير اليوم» للديزل يعني مسحوبات أمس: تقرير المحطة يصل عن اليوم المنقضي
  // واليوم الجاري ناقص دائمًا. العبارة المجردة «تقرير اليوم» تبقى للتقرير اليومي
  // للمبيعات كما هي، فلا تُخطف من مكانها.
  if(/^\/(fuel_today|diesel_today)$/i.test(raw)||/^(تقرير الديزل اليوم|تقرير اليوم للديزل|تقرير اليوم ديزل|مسحوبات امس|مسحوبات الديزل امس|تقرير الديزل امس|ديزل امس|سحب امس|سحوبات امس)$/.test(value))
    return guard(()=>dayView(message.chat.id,identity,'diesel',null));
  if(/^\/(fuel_efficiency)$/i.test(raw)||/^(كفاءه الديزل|كفاءة الديزل|تكلفه الديزل|تكلفة الديزل)$/.test(value))return guard(()=>efficiencyView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_prices)$/i.test(raw)||/^(تحليل سعر الديزل|سعر لتر الديزل|اسعار الديزل|أسعار الديزل)$/.test(value))return guard(()=>priceView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_consecutive)$/i.test(raw)||/^(ايام تعبئه متتاليه|أيام تعبئة متتالية|تعبئه متتاليه|تعبئة متتالية)$/.test(value))return guard(()=>consecutiveView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_quality)$/i.test(raw)||/^(اكتمال بيانات الديزل|جوده بيانات الديزل|جودة بيانات الديزل)$/.test(value))return guard(()=>qualityView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_daily_trend)$/i.test(raw)||/^(التوزيع اليومي للديزل|تحليل ايام الديزل|تحليل أيام الديزل)$/.test(value))return guard(()=>dailyTrendView(message.chat.id,identity,30,'diesel'));
  if(/^\/(fuel_imports)$/i.test(raw)||/^(ملفات الديزل|سجل رفع الديزل|اخر ملفات الديزل|آخر ملفات الديزل)$/.test(value))return guard(()=>importsView(message.chat.id,identity,30,'diesel'));
  // كشف الحساب الافتراضي: من أول الشهر حتى أمس.
  if(/^\/(fuel_statement)$/i.test(raw)||/^(كشف حساب|كشف حساب الديزل|كشف حساب المركبات|كشف حساب السيارات|كشوف الحسابات|كشف الديزل)$/.test(value))
    return guard(()=>statementView(message.chat.id,identity,'diesel',monthStart(),yesterday()));
  // مدى صريح: «كشف حساب من 2026-07-01 الى 2026-07-26».
  const range=value.match(/^(?:كشف حساب|كشف|تقرير)\s*(?:الديزل|المركبات|السيارات)?\s*من\s*(\d{4}-\d{2}-\d{2})\s*(?:الى|إلى|حتى|-)\s*(\d{4}-\d{2}-\d{2})$/);
  if(range)return guard(()=>statementView(message.chat.id,identity,'diesel',range[1],range[2]));
  if(/^\/(fuel|diesel)$/i.test(raw)||/^(ديزل|تقارير الديزل|الديزل|تقرير الديزل|استهلاك الديزل|الوقود)$/.test(value)||/ديزل/.test(value)){
    await showFuelMenu(message,identity);return true;
  }
  return false;
}
