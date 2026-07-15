import { select } from './supabase.js';
import { sendMessage } from './telegram.js';
import { allowed, reportSummary } from './domain.js';
import { displayName, roleLabel } from './bot-profile.js';
import { welcomeMessage, helpMessage } from './bot-help.js';
import { reportKeyboard, sendReport } from './bot-reports.js';

const norm=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();

async function programStatus(chatId,identity){
  const row=(await select('app_state','key=eq.primary&select=revision,updated_at,payload&limit=1'))?.[0];
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

export async function handleBuiltInCommand({message,identity,text}){
  const chatId=message.chat.id,raw=String(text||'').trim(),t=norm(text),role=identity?.role||'pending',active=Boolean(identity?.active),name=displayName(identity,message.from);
  if(/^\/start(?:@\w+)?$/i.test(raw)){await sendMessage(chatId,welcomeMessage(identity,message.from));return true;}
  if(/^\/help(?:@\w+)?$/i.test(raw)||/^(مساعده|الاوامر|اوامر|المميزات|ماذا تستطيع|تقدر تعمل ايه)$/.test(t)){await sendMessage(chatId,helpMessage(identity,message.from));return true;}
  if(/^\/whoami(?:@\w+)?$/i.test(raw)||/^(من انا|مين انا)$/.test(t)){
    await sendMessage(chatId,`رقم Telegram: ${message.from.id}\nالاسم: ${name}\nالدور: ${roleLabel(role)}\nالحالة: ${active?'معتمد':'ينتظر اعتماد مدير النظام'}\nالمحادثة: ${message.chat.id}`);return true;
  }
  if(/^(انت مين|من انت|اسمك ايه|عرف نفسك|ايه شغلك|بتعمل ايه|ما وظيفتك)$/.test(t)){
    await sendMessage(chatId,`أنا الموظف الذكي والمساعد التنفيذي لمصنع بن حامد يا ${name}. أقرأ آخر بيانات البرنامج السحابية، أعرض التقارير المسموحة لدورك، أستقبل ملفات Excel والمستندات، وأفتح بلاغات الصيانة بعد مطابقة المركبة والتأكيد. اكتب «مساعدة» لعرض جميع الأوامر.`);return true;
  }
  if(/^(مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير)$/.test(t)){
    await sendMessage(chatId,`أهلًا يا ${name}. أنا جاهز لمساعدتك في تقارير المصنع والديزل والصيانة والمبيعات والتحصيل. اكتب طلبك مباشرة أو اكتب «مساعدة».`);return true;
  }
  if(/^\/status(?:@\w+)?$/i.test(raw)||/^(حاله النظام|حاله الربط|اخر مزامنه|البرنامج متصل|بيانات البرنامج)$/.test(t)){
    if(!active){await sendMessage(chatId,'حسابك مسجل، لكنه يحتاج اعتمادًا قبل عرض حالة بيانات البرنامج. استخدم /whoami.');return true;}
    await programStatus(chatId,identity);return true;
  }
  if(/^\/reports(?:@\w+)?$/i.test(raw)){
    if(!active||!allowed(role,'report')){await sendMessage(chatId,'عرض التقارير متاح لمدير المصنع ومدير النظام فقط.');return true;}
    await sendMessage(chatId,`حاضر يا ${name}. اختر التقرير المطلوب:`,reportKeyboard());return true;
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
