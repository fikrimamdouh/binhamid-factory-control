import { sendMessage, keyboard } from './telegram.js';
import { displayName, roleLabel } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { roleHomeKeyboard, financeMenu, collectionMenu, inventoryMenu, fuelMenu, hrMenu, qualityMenu, tripMenu, peopleMenu } from './bot-enterprise-defs.js';
import { advanceEnterpriseForm, cancelEnterpriseForm, confirmEnterpriseForm, startEnterpriseForm } from './bot-enterprise-forms.js';
import { canManage, getEnterpriseSession, norm } from './bot-enterprise-store.js';
import { executeEnterpriseSearch, startEnterpriseSearch } from './bot-enterprise-search.js';
import { sendEnterprisePriorities } from './bot-enterprise-priorities.js';
import { sendEnterpriseAlerts, sendEnterpriseApprovals, sendEnterpriseCategorySummary, sendEnterpriseDailyReports, sendEnterpriseOperations, sendEnterpriseTasks, setEnterpriseOperationStatus } from './bot-enterprise-status.js';

export async function showRoleHome(message,identity){
  const name=displayName(identity,message.from),role=identity?.role||'pending';
  if(!identity?.active)return sendMessage(message.chat.id,`مرحبًا ${name}. حسابك مسجل وينتظر الاعتماد. استخدم /whoami وأرسل الرقم لمدير النظام.`);
  return sendMessage(message.chat.id,`<b>لوحة الموظف الذكي</b>\nمرحبًا ${name} — ${roleLabel(role)}.\nاختر العملية المطلوبة؛ كل مسار يعمل خطوة بخطوة مع مراجعة قبل الحفظ.`,roleHomeKeyboard(role));
}
function documentsMenu(){return keyboard([[{text:'تقرير المدير',callback_data:'doc:manager'},{text:'تقرير المهام',callback_data:'doc:tasks'}],[{text:'تقرير الورشة',callback_data:'doc:workshop'},{text:'تقرير المبيعات',callback_data:'doc:sales'}]]);}
export async function handleEnterpriseTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);
  if(/^\/(menu|home)(?:@\w+)?$/i.test(raw)||/^(القائمه الرئيسيه|القائمة الرئيسية|لوحه التحكم|لوحة التحكم|العمليات)$/.test(value)){await showRoleHome(message,identity);return true;}
  if(/^\/tasks(?:@\w+)?$/i.test(raw)||/^(مهامي|المهام المفتوحه|المهام المفتوحة)$/.test(value)){await sendEnterpriseTasks(message.chat.id,identity,'mine');return true;}
  if(/^(مهام الفريق|المتاخر في مهامه|المتأخر في مهامه)$/.test(value)){await sendEnterpriseTasks(message.chat.id,identity,'team');return true;}
  if(/^(ما الذي يحتاج تدخلي الان|ما يحتاج تدخلي الان|اولويات اليوم|أولويات اليوم)$/.test(value)){if(!canManage(identity.role))await sendMessage(message.chat.id,'هذا الملخص مخصص لمدير المصنع ومدير النظام.');else await sendEnterprisePriorities(message.chat.id);return true;}
  if(/^(بحث شامل|ابحث في النظام|ابحث في البرنامج)$/.test(value)){await startEnterpriseSearch(message,identity);return true;}
  if(/^(تسجيل تحصيل|سند قبض عميل)$/.test(value)){await startEnterpriseForm(message,identity,'collection_receipt');return true;}
  if(/^(طلب شراء جديد|طلب شراء)$/.test(value)){await startEnterpriseForm(message,identity,'purchase');return true;}
  if(/^(بلاغ جوده|بلاغ جودة|عدم مطابقه|عدم مطابقة)$/.test(value)){await startEnterpriseForm(message,identity,'quality_issue');return true;}
  return false;
}
export async function continueEnterpriseSession(message,identity,session,text){
  const value=String(text||'').trim();
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء العملية الحالية.');return true;}
  if(session.state==='enterprise_search'){await executeEnterpriseSearch(message,identity,value);return true;}
  if(session.state?.startsWith('enterprise_form:'))return advanceEnterpriseForm(message,identity,session,value);
  return false;
}
export async function handleEnterpriseCallback(message,from,identity,action,value){
  if(action==='ent'){
    if(value==='help')return showRoleHome({...message,from},identity);
    if(value==='finance_menu')return sendMessage(message.chat.id,'اختر العملية المالية:',financeMenu());
    if(value==='collection_menu')return sendMessage(message.chat.id,'اختر عملية التحصيل:',collectionMenu());
    if(value==='inventory_menu')return sendMessage(message.chat.id,'اختر حركة المخزون أو الشراء:',inventoryMenu());
    if(value==='fuel_menu')return sendMessage(message.chat.id,'اختر عملية الديزل والأسطول:',fuelMenu());
    if(value==='hr_menu')return sendMessage(message.chat.id,'اختر خدمة الموظفين:',hrMenu());
    if(value==='quality_menu')return sendMessage(message.chat.id,'اختر عملية الجودة والرقابة:',qualityMenu());
    if(value==='trip_menu')return sendMessage(message.chat.id,'اختر حالة الرحلة أو التوريد:',tripMenu());
    if(value==='people_menu')return sendMessage(message.chat.id,'اختر الموظفين والمهام:',peopleMenu());
    if(value==='priorities')return canManage(identity.role)?sendEnterprisePriorities(message.chat.id):sendMessage(message.chat.id,'هذا الملخص مخصص للإدارة.');
    if(value==='approvals')return sendEnterpriseApprovals(message.chat.id,identity);
    if(value==='operations')return sendEnterpriseOperations(message.chat.id);
    if(value==='search')return startEnterpriseSearch({...message,from},identity);
    if(value==='my_tasks')return sendEnterpriseTasks(message.chat.id,identity,'mine');
    if(value==='team_tasks')return sendEnterpriseTasks(message.chat.id,identity,'team');
    if(value==='daily_reports')return sendEnterpriseDailyReports(message.chat.id);
    if(value==='documents')return sendMessage(message.chat.id,'اختر التقرير المطلوب. إنشاء PDF يحتاج تفعيل خدمة التحويل في إعدادات الخادم.',documentsMenu());
    if(value==='alerts')return sendEnterpriseAlerts(message.chat.id);
    if(value==='finance_summary')return sendEnterpriseCategorySummary(message.chat.id,'finance','ملخص المالية');
    if(value==='collection_summary')return sendEnterpriseCategorySummary(message.chat.id,'collection','ملخص التحصيل');
    if(value==='inventory_summary')return sendEnterpriseCategorySummary(message.chat.id,'inventory','ملخص المخزون');
    if(value==='fuel_summary')return sendEnterpriseCategorySummary(message.chat.id,'fuel','ملخص الديزل');
    if(value==='hr_summary')return sendEnterpriseCategorySummary(message.chat.id,'hr','ملخص الموارد البشرية');
    if(value==='quality_summary')return sendEnterpriseCategorySummary(message.chat.id,'quality','ملخص الجودة والرقابة');
    return startEnterpriseForm({...message,from},identity,value);
  }
  if(action==='entopt'){
    const [formAction,selected]=String(value||'').split('|'),session=await getEnterpriseSession(message.chat.id,identity.external_id||from.id);
    if(!session?.state?.startsWith(`enterprise_form:${formAction}:`))return sendMessage(message.chat.id,'انتهت هذه الخطوة. ابدأ العملية من جديد.');
    return advanceEnterpriseForm({...message,from},identity,session,selected);
  }
  if(action==='entconfirm')return confirmEnterpriseForm(message,from,identity,value);
  if(action==='entcancel')return cancelEnterpriseForm(message,from,identity);
  if(action==='entstatus')return setEnterpriseOperationStatus(message,from,identity,value);
  return false;
}
