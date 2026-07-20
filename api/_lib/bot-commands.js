import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { allowed, reportSummary } from './domain.js';
import { displayName, roleLabel } from './bot-profile.js';
import { welcomeMessage, helpMessage, jobCatalogMessage } from './bot-help.js';
import { registrationKeyboard, startRegistration, registrationStatus, startWorkshopRegistration, startBlockSalesRegistration } from './bot-registration.js';
import { reportKeyboard, sendReport } from './bot-reports.js';
import { showAttendanceMenu } from './bot-attendance.js';
import { startDriverRegistration } from './bot-driver-registration.js';

const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num=value=>Number(value||0)||0;
function riyadhDate(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const get=type=>parts.find(x=>x.type===type)?.value||'';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function rowDate(row={}){const value=row.date||row.reportDate||row.createdAt||row.created_at||row.filledAt||row.outAt||row.timestamp;return value?String(value).slice(0,10):'';}
function fuelLiters(row={}){return num(row.liters??row.quantity??row.qty??row.dieselLiters??row.fuelLiters);}
function fuelCost(row={}){return num(row.totalCost??row.cost??row.amount??row.total);}
function formatNumber(value,digits=2){return num(value).toLocaleString('en-US',{maximumFractionDigits:digits});}
async function getState(){return(await select('app_state','key=eq.primary&select=revision,updated_at,payload&limit=1'))?.[0]||null;}

async function programStatus(chatId,identity){
  const row=await getState();
  if(!row?.payload)return sendMessage(chatId,'الربط السحابي جاهز، لكن لا توجد نسخة بيانات محفوظة من البرنامج حتى الآن. افتح البرنامج واضغط «مزامنة الآن».');
  const when=row.updated_at?new Date(row.updated_at).toLocaleString('ar-SA',{timeZone:'Asia/Riyadh'}):'غير معروف';
  let text=`📡 حالة الربط مع البرنامج\n\nآخر مزامنة: ${when}\nرقم النسخة السحابية: ${Number(row.revision||0)}\nالحالة: البيانات متاحة للبوت من آخر نسخة سحابية.`;
  if(allowed(identity?.role,'report')){
    const s=reportSummary(row.payload);
    text+=`\n\nملخص النسخة الحالية:\nالموظفون: ${s.employees}\nالمركبات: ${s.vehicles}\nالعملاء: ${s.clients}\nأوامر الإصلاح المفتوحة: ${s.openMaintenance}`;
  }
  text+='\n\nأي تعديل جديد داخل البرنامج لن يظهر هنا إلا بعد اكتمال المزامنة السحابية.';
  return sendMessage(chatId,text);
}

async function factoryAnalysis(chatId){
  const row=await getState();
  if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية يمكن تحليلها. افتح البرنامج واضغط «مزامنة الآن» ثم أعد الطلب.');
  const [openOrders,discrepancies]=await Promise.all([
    select('maintenance_orders','status=in.(reported,inspection,quotation_required,approval_pending,approved,in_repair,testing)&select=id,vehicle_stopped,priority&limit=1000'),
    select('discrepancies','status=in.(open,under_review)&select=id,severity&limit=1000')
  ]);
  const s=reportSummary(row.payload),sales=num(s.salesToday),collections=num(s.collectionsToday),gap=sales-collections,ratio=sales>0?collections/sales:null;
  const stopped=(openOrders||[]).filter(x=>x.vehicle_stopped).length,urgent=(openOrders||[]).filter(x=>x.priority==='urgent').length,critical=(discrepancies||[]).filter(x=>x.severity==='critical').length;
  const notes=[];
  if(sales===0&&collections===0)notes.push('لا توجد حركة مبيعات أو تحصيل مسجلة لليوم في النسخة المتزامنة.');
  else if(gap>0)notes.push(`التحصيل أقل من المبيعات بمبلغ ${formatNumber(gap)} ر.س${ratio!==null?`، ونسبة التحصيل ${formatNumber(ratio*100,1)}%`:''}.`);
  else if(gap<0)notes.push(`التحصيل أعلى من مبيعات اليوم بمبلغ ${formatNumber(Math.abs(gap))} ر.س، وقد يشمل تحصيل مديونيات سابقة.`);
  else notes.push('المبيعات والتحصيل متساويان اليوم حسب البيانات المتاحة.');
  if(num(s.fuelLitersToday)>0)notes.push(`استهلاك الديزل المسجل اليوم ${formatNumber(s.fuelLitersToday)} لتر بتكلفة ${formatNumber(s.fuelCostToday)} ر.س.`);else notes.push('لا توجد تعبئة ديزل مسجلة اليوم في النسخة الحالية.');
  if((openOrders||[]).length)notes.push(`يوجد ${(openOrders||[]).length} أمر إصلاح مفتوح، منها ${stopped} لمركبات متوقفة و${urgent} عاجلة.`);else notes.push('لا توجد أوامر إصلاح مفتوحة في قاعدة أوامر الصيانة.');
  if((discrepancies||[]).length)notes.push(`توجد ${(discrepancies||[]).length} فروقات رقابية مفتوحة، منها ${critical} حرجة.`);else notes.push('لا توجد فروقات رقابية مفتوحة.');
  const priority=critical?'الأولوية: مراجعة الفروقات الحرجة فورًا.':stopped?'الأولوية: متابعة المركبات المتوقفة وأوامر الإصلاح.':gap>0?'الأولوية: متابعة فجوة التحصيل مقابل المبيعات.':'لا يظهر مؤشر حرج من البيانات المتاحة حاليًا.';
  return sendMessage(chatId,`<b>تحليل وضع المصنع اليوم</b>\n\n${notes.map(x=>`• ${x}`).join('\n')}\n\n<b>${priority}</b>\n\nالتحليل مبني على آخر نسخة سحابية، وليس على بيانات لم تتم مزامنتها.`);
}

async function fuelAnalysis(chatId){
  const row=await getState();
  if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية لتحليل الديزل. نفّذ «مزامنة الآن» من البرنامج ثم أعد الطلب.');
  const fuel=row.payload?.ops?.fuel||[],today=riyadhDate(),todayRows=fuel.filter(x=>rowDate(x)===today),todayLiters=todayRows.reduce((sum,x)=>sum+fuelLiters(x),0),todayCost=todayRows.reduce((sum,x)=>sum+fuelCost(x),0);
  const daily=[];
  for(let offset=1;offset<=7;offset++){
    const date=new Date();date.setDate(date.getDate()-offset);const key=riyadhDate(date);
    const rows=fuel.filter(x=>rowDate(x)===key);daily.push({key,liters:rows.reduce((sum,x)=>sum+fuelLiters(x),0),fills:rows.length});
  }
  const avg=daily.reduce((sum,x)=>sum+x.liters,0)/7,avgFills=daily.reduce((sum,x)=>sum+x.fills,0)/7;
  if(!todayRows.length&&avg===0)return sendMessage(chatId,'لا توجد بيانات ديزل لليوم أو للأيام السبعة السابقة في النسخة السحابية، لذلك لا يمكن الحكم على الارتفاع. راجع استيراد الديزل ثم نفّذ المزامنة.');
  let verdict='ضمن النطاق المعتاد';
  if(avg===0&&todayLiters>0)verdict='لا يوجد متوسط سابق كافٍ للمقارنة';
  else if(todayLiters>avg*1.25)verdict='مرتفع عن المتوسط';
  else if(todayLiters<avg*0.75)verdict='أقل من المتوسط';
  const change=avg>0?((todayLiters-avg)/avg)*100:null;
  return sendMessage(chatId,`<b>تحليل استهلاك الديزل اليوم</b>\n\nاستهلاك اليوم: <b>${formatNumber(todayLiters)} لتر</b>\nتكلفة اليوم: <b>${formatNumber(todayCost)} ر.س</b>\nعدد التعبئات اليوم: <b>${todayRows.length}</b>\nمتوسط آخر 7 أيام: <b>${formatNumber(avg)} لتر يوميًا</b>\nمتوسط عدد التعبئات: <b>${formatNumber(avgFills,1)}</b>\n${change===null?'التغير: لا يوجد خط أساس كافٍ':`التغير عن المتوسط: <b>${change>=0?'+':''}${formatNumber(change,1)}%</b>`}\n\nالنتيجة: <b>${verdict}</b>.\n\nالمقارنة حسابية من البيانات المتزامنة، ولا تثبت وحدها وجود مخالفة.`);
}

async function salesCollectionGap(chatId){
  const row=await getState();
  if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية متاحة للمقارنة.');
  const s=reportSummary(row.payload),gap=num(s.salesToday)-num(s.collectionsToday);
  return sendMessage(chatId,`مبيعات اليوم: <b>${formatNumber(s.salesToday)} ر.س</b>\nتحصيل اليوم: <b>${formatNumber(s.collectionsToday)} ر.س</b>\nالفرق: <b>${formatNumber(Math.abs(gap))} ر.س</b> ${gap>0?'لصالح المبيعات':gap<0?'لصالح التحصيل':'ولا يوجد فرق'}.`);
}

export async function handleBuiltInCommand({message,identity,text}){
  const chatId=message.chat.id,raw=String(text||'').trim(),t=norm(text),role=identity?.role||'pending',active=Boolean(identity?.active),name=displayName(identity,message.from);
  // رابط تسجيل السواقين المستقل: t.me/<bot>?start=driver يبدأ فورم تسجيل
  // السائق مباشرة بدل شاشة اختيار الوظيفة العامة — أي حد يدخل منه هيتسجل
  // كسائق مباشرة وينتظر اعتماد مدير النظام.
  if(/^\/start(?:@\w+)?\s+(driver|سائق|سواق)$/i.test(raw)){
    if(active)await sendMessage(chatId,`أنت مسجّل بالفعل بوظيفة <b>${esc(roleLabel(role))}</b>. لو محتاج تتسجل كسائق تواصل مع مدير النظام.`);
    else await startDriverRegistration(message,identity,{});
    return true;
  }
  // رابط تسجيل موظفي الورشة المستقل: t.me/<bot>?start=workshop يبدأ فورم
  // التسجيل العادي لكن بوظيفة "الورشة / ميكانيكي" مثبّتة مسبقًا — يتخطى
  // خطوة اختيار الوظيفة تمامًا، وأي حد يدخل منه هيتسجل كموظف ورشة فقط.
  if(/^\/start(?:@\w+)?\s+(workshop|ورشة|ورشه)$/i.test(raw)){
    if(active)await sendMessage(chatId,`أنت مسجّل بالفعل بوظيفة <b>${esc(roleLabel(role))}</b>. لو محتاج تتسجل كموظف ورشة تواصل مع مدير النظام.`);
    else await startWorkshopRegistration(message,identity);
    return true;
  }
  // رابط تسجيل مندوب البلوك المستقل: t.me/<bot>?start=block يبدأ فورم
  // التسجيل بوظيفة "مندوب بلوك" مثبّتة مسبقًا — يكتب اسمه ورقمه الوظيفي
  // ويرسل الطلب، ولا تُمنح أي صلاحية قبل اعتماد مدير النظام.
  if(/^\/start(?:@\w+)?\s+(block|بلوك|بلوك_مبيعات)$/i.test(raw)){
    if(active)await sendMessage(chatId,`أنت مسجّل بالفعل بوظيفة <b>${esc(roleLabel(role))}</b>. لو محتاج تتسجل كمندوب بلوك تواصل مع مدير النظام.`);
    else await startBlockSalesRegistration(message,identity);
    return true;
  }
  if(/^\/start(?:@\w+)?\s+attendance$/i.test(raw)){
    if(!active)await sendMessage(chatId,welcomeMessage(identity,message.from),registrationKeyboard());else await showAttendanceMenu(message,identity);
    return true;
  }
  if(/^\/start(?:@\w+)?$/i.test(raw)){await sendMessage(chatId,welcomeMessage(identity,message.from),active?{}:registrationKeyboard());return true;}
  if(/^\/(register|signup)(?:@\w+)?$/i.test(raw)||/^(تسجيل|تسجيل حساب|تسجيل موظف|تسجيل بياناتي|تحديث بيانات التسجيل)$/.test(t)){await startRegistration(message,identity);return true;}
  if(/^\/attendance(?:@\w+)?$/i.test(raw)){
    if(!active)await sendMessage(chatId,'أكمل التسجيل وانتظر اعتماد مدير النظام قبل تسجيل الحضور.',registrationKeyboard());else await showAttendanceMenu(message,identity);
    return true;
  }
  if(/^\/help(?:@\w+)?$/i.test(raw)||/^(مساعده|الاوامر|اوامر|المميزات|ماذا تستطيع|تقدر تعمل ايه)$/.test(t)){await sendMessage(chatId,helpMessage(identity,message.from),active?{}:registrationKeyboard());return true;}
  if(/^(الوظائف|الوظائف المتاحه|الوظائف المتاحة|وظائف البوت|الخدمات المتاحه|الخدمات المتاحة)$/.test(t)){await sendMessage(chatId,jobCatalogMessage(identity,message.from),active?{}:registrationKeyboard());return true;}
  if(/^(حاله التسجيل|حالة التسجيل|حاله طلبي|حالة طلبي)$/.test(t)){await registrationStatus(message,identity);return true;}
  if(/^\/whoami(?:@\w+)?$/i.test(raw)||/^(من انا|مين انا)$/.test(t)){
    await sendMessage(chatId,`رقم Telegram: ${message.from.id}\nالاسم: ${name}\nالدور: ${roleLabel(role)}\nالحالة: ${active?'معتمد':'ينتظر إكمال التسجيل أو اعتماد مدير النظام'}\nالمحادثة: ${message.chat.id}`,active?{}:registrationKeyboard());return true;
  }
  if(/^(انت مين|من انت|اسمك ايه|عرف نفسك|ايه شغلك|بتعمل ايه|ما وظيفتك)$/.test(t)){
    await sendMessage(chatId,`أنا مساعد مصنع بن حامد للتشغيل والمتابعة. أربط الموظفين والسائقين والورشة والمبيعات والحسابات والمخزن والديزل والتقارير بمنظومة المصنع، وفق صلاحية كل مستخدم. اكتب «مساعدة» لعرض الخدمات.`);return true;
  }
  if(/^(مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير)$/.test(t)){
    await sendMessage(chatId,active?`مرحبًا ${name}. اكتب طلبك مباشرة أو استخدم /menu.`:welcomeMessage(identity,message.from),active?{}:registrationKeyboard());return true;
  }
  if(/^\/status(?:@\w+)?$/i.test(raw)||/^(حاله النظام|حاله الربط|اخر مزامنه|البرنامج متصل|بيانات البرنامج)$/.test(t)){
    if(!active){await sendMessage(chatId,'حسابك يحتاج اعتمادًا قبل عرض بيانات البرنامج.',registrationKeyboard());return true;}
    await programStatus(chatId,identity);return true;
  }
  if(/^\/reports(?:@\w+)?$/i.test(raw)){
    if(!active||!allowed(role,'report')){await sendMessage(chatId,'عرض التقارير متاح لمدير المصنع ومدير النظام فقط.');return true;}
    await sendMessage(chatId,`حاضر يا ${name}. اختر التقرير المطلوب:`,reportKeyboard());return true;
  }
  if(/^\/report(?:@\w+)?\s+(today|اليوم)$/i.test(raw)){
    if(!active||!allowed(role,'report')){await sendMessage(chatId,'عرض التقرير متاح لمدير المصنع ومدير النظام فقط.');return true;}
    await sendReport(chatId,'daily');return true;
  }
  const analytical=/^(حلل لي وضع المصنع اليوم|حلل وضع المصنع اليوم|تحليل وضع المصنع اليوم|حلل وضع المصنع|اعمل تحليل للمصنع اليوم)$/.test(t);
  if(analytical){if(!active||!allowed(role,'report'))await sendMessage(chatId,'تحليل وضع المصنع متاح لمدير المصنع ومدير النظام فقط.');else await factoryAnalysis(chatId);return true;}
  if(/^(هل استهلاك الديزل اليوم مرتفع|حلل استهلاك الديزل اليوم|تحليل الديزل اليوم|استهلاك الديزل اليوم مرتفع|قارن ديزل اليوم)$/.test(t)){
    if(!active||!allowed(role,'report'))await sendMessage(chatId,'تحليل الديزل متاح لمدير المصنع ومدير النظام فقط.');else await fuelAnalysis(chatId);return true;
  }
  if(/المبيعات.*التحصيل.*بكام|الفرق بين المبيعات والتحصيل|المبيعات اعلى من التحصيل/.test(t)){
    if(!active||!allowed(role,'report'))await sendMessage(chatId,'مقارنة المبيعات والتحصيل متاحة لمدير المصنع ومدير النظام فقط.');else await salesCollectionGap(chatId);return true;
  }
  if(/كم مركبه متوقفه|كم سيارة متوقفة|كم امر اصلاح مفتوح|المركبات المتوقفه/.test(t)){
    if(!active||!(allowed(role,'report')||role==='mechanic'))await sendMessage(chatId,'تقرير الورشة متاح لمدير المصنع ومدير النظام وموظفي الورشة.');else await sendReport(chatId,'workshop');return true;
  }
  const reports=[
    {re:/^(ملخص اليوم|تقرير اليوم|الوضع اليوم|ملخص المصنع)$/,kind:'daily'},
    {re:/^(تقرير الديزل|ديزل اليوم|وقود اليوم|تقرير الوقود)$/,kind:'fuel'},
    {re:/^(تقرير الورشه|حاله الورشه|اوامر الاصلاح|الصيانه اليوم)$/,kind:'workshop'},
    {re:/^(تقرير المبيعات|مبيعات اليوم|التحصيل اليوم|المبيعات والتحصيل)$/,kind:'sales'},
    {re:/^(الفروقات المفتوحه|الفروقات|تقرير الفروقات)$/,kind:'discrepancies'}
  ];
  const report=reports.find(x=>x.re.test(t));
  if(report){
    if(!active||!allowed(role,'report')){await sendMessage(chatId,'فهمت طلب التقرير، لكن عرضه متاح لمدير المصنع ومدير النظام فقط.');return true;}
    await sendReport(chatId,report.kind);return true;
  }
  return false;
}
