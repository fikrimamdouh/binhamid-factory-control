import { directBusinessSearchRequested } from './bot-procurement-secure.js';
import { moduleForText } from './bot-menu-permissions.js';

const normalize=value=>String(value||'').toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();
const START=/^(?:لو سمحت\s+|من فضلك\s+|بالله\s+)?(?:انا\s+)?(?:عاوز|عايز|محتاج|اريد|ابغى|أبغى|هات|هاتلي|هات لي|جيب|جيبلي|جيب لي|اعرض|وريني|افتح|ابدأ|ابدا|سجل|اعمل|نفذ|ابحث|إبحث|دور|دوّر|فتش|فتّش|طلع|اطلع|شوف)\b/i;
const SEARCH_ITEM=/عمود|كردان|قطعه|قطعة|فلتر|رولمان|بلي|سير|بطاري|كاوتش|كفر|اطار|إطار|خرطوم|هيدروليك|طلمب|مضخ|موتور|محرك|صمام|بلف|ترس|جربوكس|جير|كلتش|فرامل|كمبروسر|شركة|شركه|مصنع|مورد|وكيل|موزع|محل|ورشه|ورشة|اشتري|شراء|سعر السوق/i;
const REPORT=/تقرير|اقرار|إقرار|كشف حساب|كشف عميل|فواتير اليوم|تحصيلات اليوم|حركه الخزائن|حركة الخزائن|رصيد الخزائن|مخزون اليوم|تحليل اليوم/i;
const FUEL=/ديزل|وقود|رصيد المركبات|رصيد السيارات|عداد الوقود/i;
const GPS=/gps|موقع السيارات|موقع السياره|موقع السيارة|حاله الاسطول|حالة الأسطول|السيارات الان|السيارات الآن/i;
const ATTENDANCE=/تسجيل حضور|تسجيل انصراف|الحضور والانصراف|لوحه السائق|لوحة السائق/i;
const SALES=/امر بيع|أمر بيع|سجل بيع|تسجيل بيع|بيع بلوك|بيع خرسان|طلب توريد|العميل.*(?:عاوز|يريد|طلب|محتاج).*(?:بلوك|خرسان)/i;
const WORKSHOP=/بلاغ عطل|عطل معد|صيانه|صيانة|طلب قطع غيار|فحص معد|امر اصلاح|أمر إصلاح|الورشه|الورشة/i;
const ENTERPRISE=/سجل سداد|تسجيل سداد|سجل قبض|تسجيل قبض|سجل صرف|تسجيل صرف|فاتوره مورد|فاتورة مورد|عهدة|طلب موافق|اعتماد|اقتراح|مشكله ادار|مشكلة إدار|مهمه جديد|مهمة جديدة|موظف|راتب|تكلفه|تكلفة|مديونيه|مديونية/i;

export function sessionModule(state=''){
  const value=String(state||'');
  if(value==='product_market_query'||/^(supplier_|rfq_|business_search_)/.test(value))return'procurement';
  if(/^(sales_|guided_sales_)/.test(value))return'sales';
  if(/^mechanic_/.test(value)||value==='waiting_plate')return'workshop';
  if(/^(attendance_|driver_)/.test(value))return'attendance';
  if(/^enterprise_/.test(value))return'enterprise';
  if(/^registration_/.test(value))return'registration';
  return'';
}

export function detectExplicitIntent(text=''){
  const raw=String(text||'').trim(),value=normalize(raw);
  if(!value)return{intent:'',module:'',explicit:false};
  const slash=/^\/\w+/.test(raw),imperative=START.test(raw),command=imperative||slash;

  // المسارات التشغيلية المحددة تُحسم أولًا. هذا يمنع عبارات مثل
  // «هات تقرير اليوم» من أن تُفسر كبحث سوق لمجرد بدايتها بكلمة «هات».
  if(command&&GPS.test(raw))return{intent:'gps',module:'fleet',explicit:true};
  if(command&&ATTENDANCE.test(raw))return{intent:'attendance',module:'attendance',explicit:true};
  if(command&&FUEL.test(raw))return{intent:'fuel',module:'fuel',explicit:true};
  if(command&&REPORT.test(raw))return{intent:'report',module:'reports',explicit:true};
  if(command&&SALES.test(raw))return{intent:'sales',module:'sales',explicit:true};
  if(command&&WORKSHOP.test(raw))return{intent:'workshop',module:'workshop',explicit:true};
  if(command&&ENTERPRISE.test(raw))return{intent:'enterprise',module:moduleForText(raw)||'enterprise',explicit:true};

  const directSearch=directBusinessSearchRequested(raw);
  if((directSearch||imperative&&SEARCH_ITEM.test(raw))&&!REPORT.test(raw)&&!FUEL.test(raw)&&!GPS.test(raw)&&!ATTENDANCE.test(raw)&&!SALES.test(raw)&&!WORKSHOP.test(raw)&&!ENTERPRISE.test(raw))return{intent:'business_search',module:'procurement',explicit:true};

  const moduleId=moduleForText(raw);
  if(slash&&moduleId)return{intent:moduleId,module:moduleId,explicit:true};
  return{intent:'',module:'',explicit:false};
}

export function shouldSwitchSession(state,text=''){
  const current=sessionModule(state),next=detectExplicitIntent(text);
  if(!next.explicit)return{switch:false,current,next};
  return{switch:!current||current!==next.module,current,next};
}
