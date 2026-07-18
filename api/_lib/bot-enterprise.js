import { sendMessage, keyboard } from './telegram.js';
import { displayName, roleLabel } from './bot-profile.js';
import { clearMaintenanceSession } from './bot-maintenance.js';
import { roleHomeKeyboard, financeMenu, collectionMenu, inventoryMenu, fuelMenu, hrMenu, qualityMenu, tripMenu, peopleMenu, concreteSalesMenu, blockSalesMenu, systemsMenu } from './bot-enterprise-defs.js';
import { advanceEnterpriseForm, cancelEnterpriseForm, confirmEnterpriseForm, startEnterpriseForm } from './bot-enterprise-forms.js';
import { canManage, getEnterpriseSession, norm } from './bot-enterprise-store.js';
import { executeEnterpriseSearch, startEnterpriseSearch } from './bot-enterprise-search.js';
import { sendEnterprisePriorities } from './bot-enterprise-priorities.js';
import { sendEnterpriseAlerts, sendEnterpriseApprovals, sendEnterpriseCategorySummary, sendEnterpriseDailyReports, sendEnterpriseOperations, sendEnterpriseProductionReports, sendEnterpriseTasks, setEnterpriseOperationStatus } from './bot-enterprise-status.js';
import { sendFuelAnomalies } from './bot-insights-fleet.js';
import { sendInventoryRisks, sendDebtAnalysis, sendConcreteCapacity } from './bot-insights-ops.js';
import { handleEmployeeRegistrationAction, handleEmployeeRegistrationTextCommand } from './bot-employee-approvals.js';
import { handleCostCallback, handleCostTextCommand } from './bot-costs.js';
import { continueCustomerReportSession, handleCustomerReportCallback, handleCustomerReportTextCommand } from './bot-customer-reports.js';
import { continueInvitationSession, handleInvitationCallback, handleInvitationTextCommand } from './bot-invitations.js';
import { sendIntegrationCatalog } from './bot-integrations.js';
import { continueAccountingSession, handleAccountingCallback, handleAccountingTextCommand } from './bot-accounting.js';

function addBeforeHelp(rows,row){rows.splice(Math.max(0,rows.length-1),0,row);}
function miniAppUrl(){let base=String(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL||'https://binhamid-factory-control.vercel.app').trim().replace(/\/$/,'');if(!/^https?:\/\//i.test(base))base=`https://${base}`;return `${base}/telegram-operations.html`;}
export async function showRoleHome(message,identity){
  const name=displayName(identity,message.from),role=identity?.role||'pending';
  if(!identity?.active)return sendMessage(message.chat.id,`مرحبًا ${name}. حسابك مسجل وينتظر الاعتماد. استخدم /whoami وأرسل الرقم لمدير النظام.`);
  const markup=roleHomeKeyboard(role),rows=markup.reply_markup.inline_keyboard;
  if(['admin','manager'].includes(role)){
    addBeforeHelp(rows,[{text:'🧩 كل أنظمة البرنامج',callback_data:'ent:systems_menu'},{text:'📚 مركز المحاسبة',callback_data:'ent:accounting_menu'}]);
    addBeforeHelp(rows,[{text:'الحضور والانصراف',callback_data:'home:attendance'},{text:'حالة الأسطول اليوم',callback_data:'gps:fleet'}]);
    addBeforeHelp(rows,[{text:'التحليلات الرقابية',callback_data:'ent:insights_help'},{text:'تقارير العملاء',callback_data:'ent:customer_menu'}]);
    addBeforeHelp(rows,[{text:'فتح عمليات العملاء والمراجعة',web_app:{url:miniAppUrl()}}]);
    addBeforeHelp(rows,[{text:'التكاليف والربحية',callback_data:'ent:cost_menu'},{text:'دعوات المستخدمين',callback_data:'ent:inv|list'}]);
    if(role==='admin')addBeforeHelp(rows,[{text:'التكاملات والمفاتيح',callback_data:'ent:integrations'},{text:'طلبات تسجيل الموظفين',callback_data:'ent:er|list'}]);
  }else if(role==='driver'){
    rows.splice(0,0,[{text:'الحضور وحركة السائق',callback_data:'home:attendance'}],[{text:'حالة مركبتي اليوم',callback_data:'gps:fleet'},{text:'مهامي',callback_data:'ent:my_tasks'}]);
  }else if(role==='employee'){
    rows.splice(0,0,[{text:'تسجيل الحضور والانصراف',callback_data:'home:attendance'}],[{text:'خدمات الموظف',callback_data:'ent:hr_menu'}]);
  }else if(role==='mechanic'){
    addBeforeHelp(rows,[{text:'الحضور والانصراف',callback_data:'home:attendance'},{text:'حالة الأسطول اليوم',callback_data:'gps:fleet'}]);
  }else if(role==='warehouse'){
    rows.splice(0,0,[{text:'المخزون والصرف',callback_data:'ent:inventory_menu'},{text:'طلبات الشراء',callback_data:'ent:purchase'}],[{text:'الحضور',callback_data:'home:attendance'}]);
  }else if(role==='fuel_operator'){
    rows.splice(0,0,[{text:'الديزل والعدادات',callback_data:'ent:fuel_menu'},{text:'حالة الأسطول اليوم',callback_data:'gps:fleet'}],[{text:'الحضور',callback_data:'home:attendance'}]);
  }else if(role==='hr'){
    rows.splice(0,0,[{text:'الحضور والموظفون',callback_data:'home:attendance'},{text:'الموارد البشرية',callback_data:'ent:hr_menu'}],[{text:'تكلفة العامل',callback_data:'ent:cost_workers'},{text:'مهام الفريق',callback_data:'ent:team_tasks'}]);
  }else if(role==='procurement'){
    rows.splice(0,0,[{text:'المشتريات',callback_data:'ent:purchase'},{text:'مساعد المنتجات والموردون',callback_data:'home:suppliers'}],[{text:'المخزون',callback_data:'ent:inventory_menu'},{text:'الحضور',callback_data:'home:attendance'}]);
  }else if(role==='quality'){
    rows.splice(0,0,[{text:'الجودة والرقابة',callback_data:'ent:quality_menu'},{text:'الحضور',callback_data:'home:attendance'}]);
  }else if(['accountant','block_sales','concrete_sales','collector'].includes(role)){
    addBeforeHelp(rows,[{text:'الحضور والمواقع',callback_data:'home:attendance'},{text:'تقارير العملاء',callback_data:'ent:customer_menu'}]);
    if(role==='accountant'){addBeforeHelp(rows,[{text:'📚 مركز المحاسبة',callback_data:'ent:accounting_menu'},{text:'🧩 كل أنظمة البرنامج',callback_data:'ent:systems_menu'}]);addBeforeHelp(rows,[{text:'التكاليف والربحية',callback_data:'ent:cost_menu'},{text:'مساعد المنتجات والأسعار',callback_data:'home:suppliers'}]);}
  }
  return sendMessage(message.chat.id,`<b>لوحة الموظف الذكي</b>\nمرحبًا ${name} — ${roleLabel(role)}.\nاختر العملية المطلوبة؛ كل مسار يعمل خطوة بخطوة مع مراجعة قبل الحفظ.`,markup);
}
function documentsMenu(){return keyboard([[{text:'تقرير المدير',callback_data:'doc:manager'},{text:'تقرير المهام',callback_data:'doc:tasks'}],[{text:'تقرير الورشة',callback_data:'doc:workshop'},{text:'تقرير المبيعات',callback_data:'doc:sales'}]]);}
function insightsMenu(){return keyboard([[{text:'تحليل الديزل',callback_data:'ent:insight_fuel'},{text:'المخزون الحرج',callback_data:'ent:insight_inventory'}],[{text:'مديونية العملاء',callback_data:'ent:insight_debt'},{text:'طاقة الخرسانة',callback_data:'ent:insight_capacity'}],[{text:'بحث شامل',callback_data:'ent:search'}]]);}
export async function handleEnterpriseTextCommand(message,identity,text){
  const raw=String(text||'').trim(),value=norm(raw);
  if(await handleEmployeeRegistrationTextCommand(message,identity,raw))return true;
  if(await handleInvitationTextCommand(message,identity,raw))return true;
  if(await handleCostTextCommand(message,identity,raw))return true;
  if(await handleCustomerReportTextCommand(message,identity,raw))return true;
  if(await handleAccountingTextCommand(message,identity,raw))return true;
  if(/^\/suggestion(?:@\w+)?$/i.test(raw)||/^(اقتراح للاداره|اقتراح للمدير|ارسل اقتراح للاداره)$/.test(value)){await startEnterpriseForm(message,identity,'management_suggestion');return true;}
  if(/^\/(problem|complaint)(?:@\w+)?$/i.test(raw)||/^(مشكله للاداره|شكوى للاداره|بلاغ للاداره)$/.test(value)){await startEnterpriseForm(message,identity,'management_problem');return true;}
  if(/^\/(integrations|keys)(?:@\w+)?$/i.test(raw)||/^(التكاملات والمفاتيح|مفاتيح البرنامج|حاله التكاملات|حالة التكاملات)$/.test(value)){await sendIntegrationCatalog(message,identity);return true;}
  if(/^\/(menu|home)(?:@\w+)?$/i.test(raw)||/^(القائمه الرئيسيه|القائمة الرئيسية|لوحه التحكم|لوحة التحكم|العمليات)$/.test(value)){await showRoleHome(message,identity);return true;}
  if(/^\/tasks(?:@\w+)?$/i.test(raw)||/^(مهامي|المهام المفتوحه|المهام المفتوحة)$/.test(value)){await sendEnterpriseTasks(message.chat.id,identity,'mine');return true;}
  if(/^(مهام الفريق|المتاخر في مهامه|المتأخر في مهامه)$/.test(value)){await sendEnterpriseTasks(message.chat.id,identity,'team');return true;}
  if(/^(ما الذي يحتاج تدخلي الان|ما يحتاج تدخلي الان|اولويات اليوم|أولويات اليوم)$/.test(value)){if(!canManage(identity.role))await sendMessage(message.chat.id,'هذا الملخص مخصص لمدير المصنع ومدير النظام.');else await sendEnterprisePriorities(message.chat.id);return true;}
  if(/^(بحث شامل|ابحث في النظام|ابحث في البرنامج)$/.test(value)){await startEnterpriseSearch(message,identity);return true;}
  if(/^(تسجيل تحصيل|سند قبض عميل)$/.test(value)){await startEnterpriseForm(message,identity,'collection_receipt');return true;}
  if(/^(طلب شراء جديد|طلب شراء)$/.test(value)){await startEnterpriseForm(message,identity,'purchase');return true;}
  if(/^(بلاغ جوده|بلاغ جودة|عدم مطابقه|عدم مطابقة)$/.test(value)){await startEnterpriseForm(message,identity,'quality_issue');return true;}
  if(/تقرير.*(مسبق|بكره|غدا).*(خرسان|رخسان)|(?:خرسان|رخسان).*(تقرير|تسجيل).*(مسبق|بكره|غدا)/.test(value)){await startEnterpriseForm(message,identity,'concrete_pre_report');return true;}
  if(/تقرير.*(اليوم|يومي).*(خرسان|رخسان)|(?:خرسان|رخسان).*(تقرير|تسجيل).*(اليوم|يومي)/.test(value)){await startEnterpriseForm(message,identity,'concrete_daily_report');return true;}
  if(/تقرير.*(مسبق|بكره|غدا).*بلوك|بلوك.*(تقرير|تسجيل).*(مسبق|بكره|غدا)/.test(value)){await startEnterpriseForm(message,identity,'block_pre_report');return true;}
  if(/تقرير.*(اليوم|يومي).*بلوك|بلوك.*(تقرير|تسجيل).*(اليوم|يومي)/.test(value)){await startEnterpriseForm(message,identity,'block_daily_report');return true;}
  if(/^(تقارير الخرسانه|تشغيل الخرسانه|احتياجات الخرسانه)$/.test(value)){await sendEnterpriseProductionReports(message.chat.id,identity,'concrete');return true;}
  if(/^(تقارير البلوك|تشغيل البلوك|احتياجات البلوك)$/.test(value)){await sendEnterpriseProductionReports(message.chat.id,identity,'block');return true;}
  return false;
}
export async function continueEnterpriseSession(message,identity,session,text){
  const value=String(text||'').trim();
  if(await continueInvitationSession(message,identity,session,value))return true;
  if(/^(الغاء|إلغاء|تراجع|cancel)$/i.test(value)){await clearMaintenanceSession(message.chat.id,identity.external_id||message.from.id);await sendMessage(message.chat.id,'تم إلغاء العملية الحالية.');return true;}
  if(await continueCustomerReportSession(message,identity,session,value))return true;
  if(await continueAccountingSession(message,identity,session,value))return true;
  if(session.state==='enterprise_search'){await executeEnterpriseSearch(message,identity,value);return true;}
  if(session.state?.startsWith('enterprise_form:'))return advanceEnterpriseForm(message,identity,session,value);
  return false;
}
export async function handleEnterpriseCallback(message,from,identity,action,value){
  if(!identity?.active)return sendMessage(message.chat.id,'حسابك غير معتمد أو غير نشط.');
  if(action==='ent'){
    if(String(value||'').startsWith('er|'))return handleEmployeeRegistrationAction(message,from,identity,value);
    if(String(value||'').startsWith('inv|'))return handleInvitationCallback(message,from,identity,value);
    if(String(value||'').startsWith('cost_'))return handleCostCallback(message,from,identity,value);
    if(String(value||'').startsWith('customer_'))return handleCustomerReportCallback(message,from,identity,value);
    if(value==='help')return showRoleHome({...message,from},identity);
    if(value==='integrations')return sendIntegrationCatalog({...message,from},identity);
    if(value==='systems_menu')return sendMessage(message.chat.id,'كل أنظمة البرنامج المتاحة حسب صلاحيتك:',systemsMenu(identity.role));
    if(value==='accounting_menu'||String(value||'').startsWith('accounting_'))return handleAccountingCallback({...message,from},identity,value);
    if(value==='concrete_sales_menu')return sendMessage(message.chat.id,'الخرسانة مستقلة: أوامر بيع، تقرير مسبق، تقرير اليوم ومتطلبات التشغيل.',concreteSalesMenu(identity.role));
    if(value==='block_sales_menu')return sendMessage(message.chat.id,'البلوك مستقل: أوامر بيع، تقرير مسبق، تقرير اليوم ومتطلبات التشغيل.',blockSalesMenu(identity.role));
    if(value==='concrete_reports')return sendEnterpriseProductionReports(message.chat.id,identity,'concrete');
    if(value==='block_reports')return sendEnterpriseProductionReports(message.chat.id,identity,'block');
    if(value==='finance_menu')return sendMessage(message.chat.id,'اختر العملية المالية:',financeMenu());
    if(value==='collection_menu')return sendMessage(message.chat.id,'اختر عملية التحصيل:',collectionMenu());
    if(value==='inventory_menu')return sendMessage(message.chat.id,'اختر حركة المخزون أو الشراء:',inventoryMenu());
    if(value==='fuel_menu')return sendMessage(message.chat.id,'اختر عملية الديزل والأسطول:',fuelMenu());
    if(value==='hr_menu')return sendMessage(message.chat.id,'اختر خدمة الموظفين:',hrMenu());
    if(value==='quality_menu')return sendMessage(message.chat.id,'اختر عملية الجودة والرقابة:',qualityMenu());
    if(value==='trip_menu')return sendMessage(message.chat.id,'اختر حالة الرحلة أو التوريد:',tripMenu());
    if(value==='people_menu')return sendMessage(message.chat.id,'اختر الموظفين والمهام:',peopleMenu());
    if(value==='insights_help')return sendMessage(message.chat.id,'اختر التحليل المطلوب:',insightsMenu());
    if(value==='insight_fuel')return sendFuelAnomalies(message.chat.id,identity);
    if(value==='insight_inventory')return sendInventoryRisks(message.chat.id,identity);
    if(value==='insight_debt')return sendDebtAnalysis(message.chat.id,identity);
    if(value==='insight_capacity')return sendConcreteCapacity(message.chat.id,identity);
    if(value==='priorities')return canManage(identity.role)?sendEnterprisePriorities(message.chat.id):sendMessage(message.chat.id,'هذا الملخص مخصص للإدارة.');
    if(value==='approvals')return sendEnterpriseApprovals(message.chat.id,identity);
    if(value==='operations')return sendEnterpriseOperations(message.chat.id,identity);
    if(value==='search')return startEnterpriseSearch({...message,from},identity);
    if(value==='my_tasks')return sendEnterpriseTasks(message.chat.id,identity,'mine');
    if(value==='team_tasks')return sendEnterpriseTasks(message.chat.id,identity,'team');
    if(value==='daily_reports')return sendEnterpriseDailyReports(message.chat.id,identity);
    if(value==='documents')return sendMessage(message.chat.id,'اختر التقرير المطلوب. سيصدر PDF عند تفعيل خدمة التحويل، وإلا يرسل نسخة HTML قابلة للطباعة.',documentsMenu());
    if(value==='alerts')return sendEnterpriseAlerts(message.chat.id,identity);
    if(value==='finance_summary')return sendEnterpriseCategorySummary(message.chat.id,identity,'finance','ملخص المالية');
    if(value==='collection_summary')return sendEnterpriseCategorySummary(message.chat.id,identity,'collection','ملخص التحصيل');
    if(value==='inventory_summary')return sendEnterpriseCategorySummary(message.chat.id,identity,'inventory','ملخص المخزون');
    if(value==='fuel_summary')return sendEnterpriseCategorySummary(message.chat.id,identity,'fuel','ملخص الديزل');
    if(value==='hr_summary')return sendEnterpriseCategorySummary(message.chat.id,identity,'hr','ملخص الموارد البشرية');
    if(value==='quality_summary')return sendEnterpriseCategorySummary(message.chat.id,identity,'quality','ملخص الجودة والرقابة');
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
