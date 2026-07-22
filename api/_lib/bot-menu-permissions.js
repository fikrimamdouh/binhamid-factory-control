import { requiredSelect } from './required-data.js';

export const BOT_MENU_PREFIX='bot.menu.';
const allActive=['admin','manager','accountant','mechanic','block_sales','concrete_sales','collector','driver','employee','warehouse','fuel_operator','hr','procurement','quality'];
const managers=['admin','manager'];

export const BOT_MENU_CATALOG=Object.freeze([
  {id:'priorities',icon:'🚨',label:'ما يحتاج تدخلي',group:'الإدارة',defaultRoles:managers},
  {id:'approvals',icon:'✅',label:'الاعتمادات',group:'الإدارة',defaultRoles:['admin','manager','accountant']},
  {id:'operations',icon:'📊',label:'لوحة التشغيل',group:'الإدارة',defaultRoles:managers},
  {id:'search',icon:'🧭',label:'البحث الشامل',group:'عام',defaultRoles:['admin','manager','accountant','block_sales','concrete_sales','collector']},
  {id:'concrete',icon:'🏭',label:'الخرسانة',group:'التشغيل',defaultRoles:['admin','manager','concrete_sales','accountant']},
  {id:'block',icon:'🧱',label:'البلوك',group:'التشغيل',defaultRoles:['admin','manager','block_sales','accountant']},
  {id:'workshop',icon:'🔧',label:'الورشة والصيانة',group:'التشغيل',defaultRoles:['admin','manager','accountant','mechanic']},
  {id:'sales',icon:'📋',label:'المبيعات وأوامر البيع',group:'التشغيل',defaultRoles:['admin','manager','accountant','block_sales','concrete_sales']},
  {id:'finance',icon:'💰',label:'المالية',group:'المالية',defaultRoles:['admin','manager','accountant']},
  {id:'accounting',icon:'📚',label:'مركز المحاسبة',group:'المالية',defaultRoles:['admin','manager','accountant']},
  {id:'collection',icon:'🧾',label:'التحصيلات',group:'المالية',defaultRoles:['admin','manager','accountant','block_sales','concrete_sales','collector']},
  {id:'customer',icon:'👥',label:'العملاء وكشوف الحساب',group:'المالية',defaultRoles:['admin','manager','accountant','block_sales','concrete_sales','collector']},
  {id:'costs',icon:'💸',label:'التكاليف والربحية',group:'المالية',defaultRoles:['admin','manager','accountant','hr']},
  {id:'inventory',icon:'📦',label:'المخزون والصرف',group:'التشغيل',defaultRoles:['admin','manager','accountant','warehouse','procurement','mechanic']},
  {id:'procurement',icon:'🛒',label:'المشتريات والموردون',group:'التشغيل',defaultRoles:['admin','manager','accountant','warehouse','procurement','mechanic']},
  {id:'fuel',icon:'⛽',label:'الديزل والعدادات',group:'الأسطول',defaultRoles:['admin','manager','accountant','mechanic','fuel_operator','driver']},
  {id:'fleet',icon:'🚚',label:'حالة الأسطول من الحضور',group:'الأسطول',defaultRoles:['admin','manager','mechanic','fuel_operator','driver']},
  {id:'trips',icon:'📍',label:'الرحلات والتوريد',group:'الأسطول',defaultRoles:['admin','manager','mechanic','block_sales','concrete_sales','collector','driver']},
  {id:'attendance',icon:'🕒',label:'الحضور والانصراف',group:'الموظفون',defaultRoles:allActive},
  {id:'people',icon:'📋',label:'المهام وتقارير الموظفين',group:'الموظفون',defaultRoles:allActive},
  {id:'hr',icon:'👤',label:'خدمات الموارد البشرية',group:'الموظفون',defaultRoles:['admin','manager','accountant','hr','employee']},
  {id:'quality',icon:'🧪',label:'الجودة والرقابة',group:'التشغيل',defaultRoles:['admin','manager','mechanic','quality']},
  {id:'reports',icon:'📈',label:'التقارير والملفات',group:'التقارير',defaultRoles:['admin','manager','accountant','block_sales','concrete_sales','collector','mechanic','warehouse']},
  {id:'documents',icon:'📄',label:'المستندات الفورية',group:'التقارير',defaultRoles:managers},
  {id:'alerts',icon:'🔔',label:'التنبيهات والتحليلات',group:'التقارير',defaultRoles:managers},
  {id:'governance',icon:'🏛',label:'الإدارة والحوكمة',group:'الإدارة',defaultRoles:['admin','manager','hr']},
  {id:'systems',icon:'🧩',label:'كل أنظمة البرنامج',group:'الإدارة',defaultRoles:['admin','manager','accountant']},
  {id:'mini_app',icon:'📱',label:'عمليات العملاء والمراجعة',group:'الإدارة',defaultRoles:managers},
  {id:'invitations',icon:'✉️',label:'دعوات المستخدمين',group:'الإدارة',defaultRoles:managers},
  {id:'integrations',icon:'🔑',label:'التكاملات والمفاتيح',group:'الإدارة',defaultRoles:['admin']},
  {id:'employee_registration',icon:'🪪',label:'طلبات تسجيل الموظفين',group:'الإدارة',defaultRoles:['admin']},
  {id:'feedback',icon:'💡',label:'الاقتراحات والمشكلات',group:'عام',defaultRoles:allActive},
  {id:'cfo',icon:'🧠',label:'مساعد المدير المالي',group:'خاص بالمالك',defaultRoles:[],ownerOnly:true},
  {id:'notifications',icon:'📣',label:'إشعارات النظام',group:'خاص بالمالك',defaultRoles:[],ownerOnly:true},
  {id:'test_reset',icon:'🧹',label:'تنظيف تجارب Telegram',group:'خاص بالمالك',defaultRoles:[],ownerOnly:true}
]);

const byId=new Map(BOT_MENU_CATALOG.map(item=>[item.id,item]));
const cache=new Map();
const userIdOf=identity=>String(identity?.user_id||identity?.id||identity?.app_user_id||'').trim();
const normalize=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
export const botMenuCapability=id=>`${BOT_MENU_PREFIX}${id}`;
export const botMenuItem=id=>byId.get(String(id||''))||null;
export const defaultBotModulesForRole=role=>new Set(BOT_MENU_CATALOG.filter(item=>!item.ownerOnly&&item.defaultRoles.includes(String(role||'pending'))).map(item=>item.id));

export async function loadBotMenuPolicy(identity,{owner=false,cacheMs=10000}={}){
  const role=String(identity?.role||'pending'),userId=userIdOf(identity),key=`${userId}|${role}|${owner?1:0}`,now=Date.now(),hit=cache.get(key);
  if(hit&&now-hit.at<cacheMs)return hit.value;
  const defaults=defaultBotModulesForRole(role),overrides=new Map();
  if(userId){
    const rows=await requiredSelect('user_capabilities',`app_user_id=eq.${encodeURIComponent(userId)}&select=capability,allowed&limit=500`,'صلاحيات وحدات البوت','BOT_CAPABILITIES_READ_FAILED');
    for(const row of rows){const capability=String(row?.capability||'');if(capability.startsWith(BOT_MENU_PREFIX))overrides.set(capability.slice(BOT_MENU_PREFIX.length),Boolean(row.allowed));}
  }
  const enabled=new Set();
  for(const item of BOT_MENU_CATALOG){
    if(item.ownerOnly){if(owner)enabled.add(item.id);continue;}
    const explicit=overrides.get(item.id);if(explicit===true||(explicit===undefined&&defaults.has(item.id)))enabled.add(item.id);
  }
  const value={role,userId,owner,defaults,overrides,enabled};cache.set(key,{at:now,value});return value;
}
export function clearBotMenuPolicyCache(){cache.clear();}
export async function botModuleAllowed(identity,moduleId,options={}){if(!moduleId)return true;const policy=await loadBotMenuPolicy(identity,options);return policy.enabled.has(moduleId);}

export function moduleForCallback(action,value=''){
  const a=String(action||''),v=String(value||'');
  if(a==='home')return({workshop:'workshop',sales:'sales',suppliers:'procurement',attendance:'attendance'})[v]||null;
  if(a==='gps')return'fleet';if(a==='doc')return'documents';if(a==='report'||a==='reportfile')return'reports';
  if(a==='sales'||a.startsWith('gs_')||a.startsWith('sales_'))return'sales';
  if(['proc','supplier_city','supplier_rfq','rfq_qty','rfq_urgency'].includes(a))return'procurement';
  if(['mech','parts_confirm','maint_confirm','maint_cancel','vehicle'].includes(a))return'workshop';
  if(['att','fuelconfirm','fuelcancel'].includes(a))return'attendance';if(['approve','reject'].includes(a))return'approvals';
  if(a!=='ent'&&a!=='entopt'&&a!=='entconfirm'&&a!=='entcancel'&&a!=='entstatus')return null;
  const form=a==='entopt'?v.split('|')[0]:v;
  if(/^cfo_/.test(form)||form==='cfo_menu')return'cfo';if(/^notification_/.test(form))return'notifications';if(/^telegram_reset/.test(form))return'test_reset';
  if(/^er\|/.test(form))return'employee_registration';if(/^inv\|/.test(form))return'invitations';if(/^accounting_/.test(form)||form==='accounting_menu')return'accounting';
  if(/^customer_/.test(form)||['customer','customer_menu'].includes(form))return'customer';if(/^cost_/.test(form)||form==='cost_menu')return'costs';
  if(/^concrete_/.test(form)||form==='insight_capacity')return'concrete';if(/^block_/.test(form))return'block';
  if(/^finance_/.test(form)||form==='finance_menu')return'finance';if(/^collection_/.test(form)||form==='collection_menu')return'collection';
  if(/^inventory_/.test(form)||form==='inventory_menu')return'inventory';if(form==='purchase')return'procurement';if(/^fuel_/.test(form)||form==='fuel_menu'||form==='insight_fuel')return'fuel';
  if(/^hr_/.test(form)||form==='hr_menu')return'hr';if(/^quality_/.test(form)||form==='quality_menu')return'quality';if(/^trip_/.test(form)||form==='trip_menu')return'trips';
  if(['people_menu','my_tasks','team_tasks','task_new','daily_reports'].includes(form))return'people';if(form==='priorities')return'priorities';if(form==='approvals')return'approvals';if(form==='operations')return'operations';if(form==='search')return'search';
  if(form==='documents')return'documents';if(['alerts','insights_help','insight_inventory','insight_debt'].includes(form))return'alerts';if(form==='admin_menu'||/^admin_/.test(form)||['risk_register','contract_renewal','governance_summary','administration_summary'].includes(form))return'governance';
  if(form==='systems_menu')return'systems';if(form==='integrations')return'integrations';if(['management_suggestion','management_problem'].includes(form))return'feedback';if(form==='daily_report')return'reports';
  return null;
}

export function moduleForButton(button){
  if(!button||typeof button!=='object')return null;
  if(button.web_app)return'mini_app';const raw=String(button.callback_data||''),i=raw.indexOf(':');return i<0?null:moduleForCallback(raw.slice(0,i),raw.slice(i+1));
}
export function filterBotKeyboard(markup,policy){
  const rows=markup?.reply_markup?.inline_keyboard;if(!Array.isArray(rows))return markup;
  markup.reply_markup.inline_keyboard=rows.map(row=>(row||[]).filter(button=>{const moduleId=moduleForButton(button);return!moduleId||policy.enabled.has(moduleId);})).filter(row=>row.length);
  return markup;
}

export function moduleForText(rawText){
  const raw=String(rawText||'').trim(),value=normalize(raw);
  if(/^\/start(?:@\w+)?\s+attendance$/i.test(raw))return'attendance';
  if(/^\/(menu|home|help|whoami)(?:@\w+)?\b/i.test(raw)||/^\/start(?:@\w+)?(?:\s+(driver|workshop|block|سائق|سواق|ورشه|ورشة|بلوك|بلوك_مبيعات))?$/i.test(raw))return null;
  if(/^\/(reports|report)(?:@\w+)?(?:\s|$)/i.test(raw))return'reports';
  if(/^\/status(?:@\w+)?\b/i.test(raw)||/حاله النظام|حالة النظام|حاله الربط|حالة الربط|اخر مزامنه|آخر مزامنة|البرنامج متصل|بيانات البرنامج/.test(value))return'operations';
  if(/^\/(attendance)(?:@\w+)?\b/i.test(raw)||/الحضور|الانصراف|لوحه السائق|لوحة السائق/.test(value))return'attendance';
  if(/^\/sales(?:@\w+)?\b/i.test(raw)||/اوامر البيع|المبيعات|امر بيع|أمر بيع/.test(value))return'sales';
  if(/^\/workshop(?:@\w+)?\b/i.test(raw)||/الورشه|الورشة|صيانه|صيانة|قطع غيار|عطل معده|عطل معدات/.test(value))return'workshop';
  if(/^\/suppliers(?:@\w+)?\b/i.test(raw)||/مورد|الموردين|قطعه|قطعة|طلب شراء/.test(value))return'procurement';
  if(/^\/gps(?:@\w+)?\b/i.test(raw)||/الاسطول|الأسطول|موقع السيارات|حاله gps|حالة gps/.test(value))return'fleet';
  if(/^\/(cfo|finance_manager)(?:@\w+)?\b/i.test(raw)||/مساعد المدير المالي|المركز المالي|الموقف المالي|السيوله|السيولة/.test(value))return'cfo';
  if(/^\/(integrations|keys)(?:@\w+)?\b/i.test(raw)||/التكاملات|المفاتيح/.test(value))return'integrations';
  if(/^\/(suggestion|problem|complaint)(?:@\w+)?\b/i.test(raw)||/اقتراح للاداره|اقتراح للادارة|مشكله للاداره|مشكلة للادارة|شكوى للاداره|شكوى للادارة/.test(value))return'feedback';
  if(/^\/tasks(?:@\w+)?\b/i.test(raw)||/مهامي|مهام الفريق|مهمه جديده|مهمة جديدة/.test(value))return'people';
  if(/حلل وضع المصنع|تحليل وضع المصنع|تنبيهات|تحليل رقابي/.test(value))return'alerts';
  if(/بحث شامل|ابحث في النظام|ابحث في البرنامج/.test(value))return'search';
  if(/ما يحتاج تدخلي|اولويات اليوم|أولويات اليوم/.test(value))return'priorities';
  if(/الاعتمادات|اعتماد|رفض/.test(value))return'approvals';
  if(/لوحه التشغيل|لوحة التشغيل|عمليات المصنع/.test(value))return'operations';
  if(/الخرسان|الخرسانة|رخسان/.test(value))return'concrete';
  if(/البلوك/.test(value))return'block';
  if(/سند قبض|سند صرف|فاتوره مورد|فاتورة مورد|تسويه صندوق|تسوية صندوق|طلب ميزانيه|طلب ميزانية|التزام مورد|مطالبه مصروف|مطالبة مصروف|طلب عهده|طلب عهدة/.test(value))return'finance';
  if(/تحصيل|زياره عميل|زيارة عميل|وعد سداد|لم يرد/.test(value))return'collection';
  if(/عميل جديد|كشف حساب عميل|تقارير العملاء|مديونيه العملاء|مديونية العملاء/.test(value))return'customer';
  if(/التكاليف|الربحيه|الربحية|تكلفه العامل|تكلفة العامل/.test(value))return'costs';
  if(/المخزون|استلام صنف|صرف صنف|جرد سريع|صنف منخفض/.test(value))return'inventory';
  if(/ديزل|وقود|عداد/.test(value))return'fuel';
  if(/رحله|رحلة|تم التحميل|وصلت الموقع|تم التسليم|تأخير رحلة|عطل اثناء رحله|عطل أثناء رحلة/.test(value))return'trips';
  if(/طلب اجازه|طلب إجازة|طلب سلفه|طلب سلفة|تعريف راتب|انتهاء مستند|بلاغ اصابه|بلاغ إصابة|الموارد البشريه|الموارد البشرية/.test(value))return'hr';
  if(/فحص جوده|فحص جودة|عدم مطابقه|عدم مطابقة|اجراء تصحيحي|إجراء تصحيحي/.test(value))return'quality';
  if(/تقرير|تقارير|ملخص/.test(value))return'reports';
  if(/قرار اداري|قرار إداري|محضر اجتماع|تعميم اداري|تعميم إداري|سياسه|سياسة|تسجيل خطر|خطر تشغيلي|خطر اداري|خطر إداري/.test(value))return'governance';
  return null;
}

export function moduleForSession(stateValue){
  const state=String(stateValue||'');if(!state)return null;
  if(state.startsWith('attendance_'))return'attendance';if(state.startsWith('driver_'))return'trips';
  if(state==='enterprise_search')return'search';if(state.startsWith('enterprise_form:'))return moduleForCallback('ent',state.split(':')[1]||'');
  if(state.startsWith('supplier_')||state.startsWith('rfq_'))return'procurement';if(state.startsWith('guided_sales_')||state.startsWith('sales_'))return'sales';
  if(state.startsWith('mechanic_')||state==='waiting_plate')return'workshop';if(state.startsWith('accounting_'))return'accounting';
  if(state.startsWith('customer_')||state.startsWith('select_customer_')||state.startsWith('customer_report_'))return'customer';
  if(state.startsWith('notification_'))return'notifications';return null;
}
