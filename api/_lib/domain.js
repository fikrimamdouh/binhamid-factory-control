import crypto from 'node:crypto';
export const DEPARTMENTS = ['workshop','finance','block','concrete'];
export const ROLES = ['admin','manager','accountant','mechanic','block_sales','concrete_sales','collector','driver','employee','warehouse','fuel_operator','hr','procurement','quality'];
export const DEPARTMENT_LABELS = {
  workshop:'الورشة والصيانة', finance:'المالية والحسابات', block:'مبيعات وتحصيل البلوك', concrete:'مبيعات وتحصيل الخرسانة',
  management:'لوحة مدير المصنع', fuel:'سجل الديزل والرقابة على الوقود', general:'مركز الاتصال', unassigned:'مركز الاتصال — يحتاج تحديد القسم', private:'المساعد الشخصي'
};
export const ROLE_LABELS = {
  admin:'مدير النظام',manager:'مدير المصنع',accountant:'المحاسب',mechanic:'مسؤول الورشة',block_sales:'مبيعات البلوك',concrete_sales:'مبيعات الخرسانة',collector:'مسؤول التحصيل',
  driver:'سائق',employee:'موظف',warehouse:'مسؤول المخزن',fuel_operator:'مسؤول الديزل',hr:'الموارد البشرية',procurement:'المشتريات',quality:'الجودة والرقابة',pending:'غير معتمد'
};
export function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
export function inferDepartment(title = '') {
  const t = String(title).toLowerCase();
  if (/ورشة|صيانة|ميكانيك/.test(t)) return 'workshop';
  if (/مالي|محاسب|رواتب|حساب/.test(t)) return 'finance';
  if (/بلوك/.test(t)) return 'block';
  if (/خرسان|concrete/.test(t)) return 'concrete';
  return 'unassigned';
}
export function classifyFile(name = '', department = '', sheetNames = []) {
  const text = `${name} ${sheetNames.join(' ')}`.toLowerCase();
  if (/ديزل|وقود|fuel|diesel/.test(text)) return 'fuel';
  if (/راتب|رواتب|مسير|مدد|payroll|mudad/.test(text)) return 'payroll';
  if (/تحصيل|سند قبض|collection/.test(text)) return department === 'block' ? 'block_collections' : department === 'concrete' ? 'concrete_collections' : 'collections';
  if (/حركة|مبيعات|invoice|sales|daily/.test(text)) return department === 'block' ? 'block_daily_movement' : department === 'concrete' ? 'concrete_daily_movement' : 'daily_movement';
  return department === 'finance' ? 'financial_document' : 'unknown_excel';
}
export function extractPlate(text = '') {
  const normalized = String(text).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const candidates = [...normalized.matchAll(/(?:لوح(?:ة|ه)?|رقم|السيار(?:ة|ه)|المركب(?:ة|ه))?\s*[:\-]?\s*([A-Za-z\u0600-\u06FF]{0,5}\s*)?([0-9]{3,6})/g)].map(m => `${String(m[1]||'').trim()} ${m[2]}`.trim());
  return candidates[0] || '';
}
export function isFaultMessage(text = '') { return /عطل|خرب|مشكلة|تسريب|فرامل|زيت|حرارة|متوقف|واقفة|صيانة|كسر|صوت/.test(String(text)); }
export function allowed(role, action) {
  if (role === 'admin') return true;
  const map = {
    manager: ['report','approve','reject','view','attendance','location','fleet'],
    accountant: ['finance','upload','invoice','payroll','view','collection'],
    mechanic: ['maintenance','upload','view','fleet'],
    block_sales: ['block','upload','view','collection','trip'],
    concrete_sales: ['concrete','upload','view','collection','trip'],
    collector: ['collection','upload','view','trip'],
    driver: ['attendance','location','trip','fuel','view'],
    employee: ['attendance','location','view'],
    warehouse: ['inventory','purchase','upload','view'],
    fuel_operator: ['fuel','fleet','upload','view'],
    hr: ['attendance','payroll','view'],
    procurement: ['purchase','quotation','upload','view'],
    quality: ['quality','upload','view']
  };
  return (map[role] || []).includes(action);
}
function normalizeText(value=''){
  return String(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ').trim();
}
export function routeMessage(text='', department='unassigned', role='pending'){
  const t=normalizeText(text);
  const inDepartment=DEPARTMENTS.includes(department)?department:'unassigned';
  let route={intent:'general',department:inDepartment,destination:DEPARTMENT_LABELS[inDepartment]||DEPARTMENT_LABELS.general,summary:String(text).trim().slice(0,240),confidence:0.45,needsConfirmation:false};
  if(!t||/^(\/start(?:@\w+)?|\/help(?:@\w+)?|مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير)$/.test(t)) return {...route,intent:'greeting',department:'general',destination:DEPARTMENT_LABELS.private,confidence:0.98};
  if(/شكرا|تسلم|جزاك الله|thank/.test(t)) return {...route,intent:'thanks',department:'general',destination:DEPARTMENT_LABELS.private,confidence:0.95};
  if(/حضور|انصراف|بصمه|بصمة|دوام|لوكيشن|موقع مباشر/.test(t)) return {...route,intent:'attendance',department:'general',destination:'الحضور والمواقع',confidence:0.94,needsConfirmation:true};
  if(/تقرير|تقارير|ملخص|مؤشر|الاداء|الوضع اليوم/.test(t)) return {...route,intent:'report',department:'management',destination:DEPARTMENT_LABELS.management,confidence:0.88};
  if(isFaultMessage(t)||/اصلاح|ميكانيكي|كهربائي سيارات|بنشر|كاوتش/.test(t)) return {...route,intent:'maintenance',department:'workshop',destination:DEPARTMENT_LABELS.workshop,confidence:0.94,needsConfirmation:true};
  if(/ديزل|وقود|سولار|تعبئه|تعبية|لتر|fuel|diesel/.test(t)) return {...route,intent:'fuel',department:'fuel',destination:DEPARTMENT_LABELS.fuel,confidence:0.94};
  if(/راتب|رواتب|مسير|مدد|سلفه|سلفة|خصم موظف|اضافي|اجازه|غياب|حضور|payroll|salary/.test(t)) return {...route,intent:'payroll',department:'finance',destination:'المالية — الرواتب وشؤون الموظفين',confidence:0.91};
  if(/تحصيل|سند قبض|استلمنا|حواله عميل|حوالة عميل|سداد عميل|collection|collected/.test(t)){
    const target=inDepartment==='block'||/بلوك/.test(t)?'block':inDepartment==='concrete'||/خرسان/.test(t)?'concrete':'finance';
    return {...route,intent:'collection',department:target,destination:target==='block'?'تحصيلات البلوك':target==='concrete'?'تحصيلات الخرسانة':'المالية — التحصيلات',confidence:0.92};
  }
  if(/مبيعات|فاتوره عميل|فاتورة عميل|طلب عميل|توريد|صب|متر مكعب|sales|customer order/.test(t)){
    const target=inDepartment==='block'||/بلوك/.test(t)?'block':inDepartment==='concrete'||/خرسان|صب|متر مكعب/.test(t)?'concrete':role==='block_sales'?'block':role==='concrete_sales'?'concrete':'unassigned';
    return {...route,intent:'sales',department:target,destination:target==='block'?DEPARTMENT_LABELS.block:target==='concrete'?DEPARTMENT_LABELS.concrete:DEPARTMENT_LABELS.unassigned,confidence:target==='unassigned'?0.62:0.91};
  }
  if(/عرض سعر|تسعير|quotation|quote/.test(t)) return {...route,intent:'quotation',department:inDepartment==='workshop'?'workshop':'finance',destination:inDepartment==='workshop'?'الورشة — عروض أسعار الإصلاح':'المالية — عروض الأسعار والمشتريات',confidence:0.88,needsConfirmation:true};
  if(/فاتوره|فاتورة|مصروف|مورد|مشتريات|تحويل بنكي|شيك|invoice|expense|supplier/.test(t)) return {...route,intent:'finance',department:'finance',destination:DEPARTMENT_LABELS.finance,confidence:0.88};
  if(inDepartment!=='unassigned') return {...route,intent:'department_message',department:inDepartment,destination:DEPARTMENT_LABELS[inDepartment],confidence:0.72};
  return route;
}
export function reportSummary(payload = {}) {
  const D = payload.legacy || {}, OPS = payload.ops || {};
  const today = new Date().toISOString().slice(0,10);
  const same = v => String(v || '').slice(0,10) === today;
  const deliveries = (OPS.deliveries || []).filter(x => same(x.date || x.outAt));
  const collections = (OPS.collections || []).filter(x => same(x.date));
  const fuel = (OPS.fuel || []).filter(x => same(x.date));
  const maintenance = OPS.maintenance || [];
  return {
    employees: (D.emp || []).length, vehicles: (D.veh || []).length, clients: (D.cli || []).length,
    salesToday: deliveries.reduce((s,x)=>s+Number(x.total||x.amount||0),0),
    collectionsToday: collections.reduce((s,x)=>s+Number(x.amount||0),0),
    fuelLitersToday: fuel.reduce((s,x)=>s+Number(x.liters||0),0),
    fuelCostToday: fuel.reduce((s,x)=>s+Number(x.totalCost||x.amount||0),0),
    openMaintenance: maintenance.filter(x=>!['closed','accepted','cancelled'].includes(x.status)).length,
    stoppedVehicles: maintenance.filter(x=>!['closed','accepted','cancelled'].includes(x.status) && (x.vehicleStopped || /متوقف|واقفة/.test(x.problem||''))).length
  };
}
