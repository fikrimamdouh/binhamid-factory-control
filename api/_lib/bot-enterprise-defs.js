import { keyboard } from './telegram.js';

export const SIMPLE_DEFS={
  finance_receipt:{prefix:'RCV',category:'finance',subtype:'receipt',title:'سند قبض',fields:[['party','اكتب اسم العميل أو الجهة.'],['amount','اكتب المبلغ بالأرقام.'],['method','اختر طريقة القبض.',[['cash','نقدي'],['transfer','تحويل'],['cheque','شيك']]],['note','اكتب البيان أو رقم السند.']]},
  finance_payment:{prefix:'PAY',category:'finance',subtype:'payment',title:'سند صرف',fields:[['party','اكتب اسم المورد أو المستفيد.'],['amount','اكتب المبلغ بالأرقام.'],['method','اختر طريقة الصرف.',[['cash','نقدي'],['transfer','تحويل'],['cheque','شيك']]],['note','اكتب سبب الصرف أو رقم المستند.']]},
  finance_invoice:{prefix:'INV',category:'finance',subtype:'supplier_invoice',title:'فاتورة مورد',fields:[['party','اكتب اسم المورد.'],['amount','اكتب إجمالي الفاتورة.'],['note','اكتب رقم الفاتورة ووصفها.']]},
  finance_cash:{prefix:'CSH',category:'finance',subtype:'cash_reconciliation',title:'تسوية صندوق',fields:[['amount','اكتب الرصيد الفعلي.'],['expected','اكتب الرصيد الدفتري.'],['note','اكتب سبب الفرق أو ملاحظتك.']]},
  collection_receipt:{prefix:'COL',category:'collection',subtype:'receipt',title:'تحصيل عميل',fields:[['party','اكتب اسم العميل.'],['amount','اكتب مبلغ التحصيل.'],['method','اختر طريقة السداد.',[['cash','نقدي'],['transfer','تحويل'],['cheque','شيك']]],['note','اكتب رقم السند أو الملاحظة.']]},
  collection_visit:{prefix:'VIS',category:'collection',subtype:'visit',title:'زيارة عميل',fields:[['party','اكتب اسم العميل.'],['note','اكتب نتيجة الزيارة.'],['next_date','اكتب المتابعة القادمة أو اكتب لا يوجد.']]},
  collection_promise:{prefix:'PRM',category:'collection',subtype:'promise',title:'وعد سداد',fields:[['party','اكتب اسم العميل.'],['amount','اكتب المبلغ المتوقع.'],['due_date','اكتب تاريخ السداد بصيغة 2026-07-20.'],['note','اكتب تفاصيل الوعد.']]},
  collection_no_answer:{prefix:'NAR',category:'collection',subtype:'no_answer',title:'عميل لم يرد',fields:[['party','اكتب اسم العميل.'],['note','اكتب عدد المحاولات أو ملاحظة التواصل.']]},
  inventory_receive:{prefix:'REC',category:'inventory',subtype:'receive',title:'استلام مخزون',fields:[['item','اكتب اسم الصنف أو رقمه.'],['quantity','اكتب الكمية.'],['party','اكتب المورد أو مصدر الاستلام.'],['note','اكتب رقم الفاتورة أو الملاحظة.']]},
  inventory_issue:{prefix:'ISS',category:'inventory',subtype:'issue',title:'صرف مخزون',fields:[['item','اكتب اسم الصنف أو رقمه.'],['quantity','اكتب الكمية المصروفة.'],['party','اكتب الجهة أو أمر الإصلاح المستفيد.'],['note','اكتب سبب الصرف.']]},
  inventory_count:{prefix:'CNT',category:'inventory',subtype:'count',title:'جرد سريع',fields:[['item','اكتب اسم الصنف أو رقمه.'],['quantity','اكتب الرصيد الفعلي.'],['expected','اكتب الرصيد الدفتري إن وجد.'],['note','اكتب الملاحظة.']]},
  inventory_low:{prefix:'LOW',category:'inventory',subtype:'low_stock',title:'تنبيه مخزون منخفض',fields:[['item','اكتب اسم الصنف أو رقمه.'],['quantity','اكتب الرصيد الحالي.'],['expected','اكتب الحد الأدنى المطلوب.'],['note','اكتب سبب الاستعجال.']]},
  purchase:{prefix:'PUR',category:'purchase',subtype:'purchase_request',title:'طلب شراء',fields:[['item','اكتب الصنف أو الخدمة المطلوبة.'],['quantity','اكتب الكمية.'],['priority','اختر الأولوية.',[['normal','عادي'],['urgent','عاجل'],['critical','حرج']]],['note','اكتب سبب الطلب والمواصفات.']]},
  fuel_fill:{prefix:'FUL',category:'fuel',subtype:'fill',title:'تعبئة ديزل',fields:[['asset','اكتب رقم اللوحة أو الأصل.'],['quantity','اكتب اللترات.'],['amount','اكتب القيمة الإجمالية.'],['odometer','اكتب قراءة العداد أو اكتب 0.'],['party','اكتب اسم المحطة.'],['note','اكتب رقم الفاتورة أو الملاحظة.']]},
  fuel_odometer:{prefix:'ODO',category:'fuel',subtype:'odometer',title:'قراءة عداد',fields:[['asset','اكتب رقم اللوحة أو الأصل.'],['odometer','اكتب قراءة العداد.'],['note','اكتب الملاحظة.']]},
  fuel_discrepancy:{prefix:'FDS',category:'fuel',subtype:'discrepancy',title:'فرق ديزل',fields:[['asset','اكتب رقم اللوحة أو الأصل.'],['amount','اكتب قيمة أو كمية الفرق.'],['note','اشرح سبب الاشتباه أو الفرق.']]},
  hr_leave:{prefix:'LEV',category:'hr',subtype:'leave',title:'طلب إجازة',fields:[['date_from','اكتب تاريخ البداية.'],['date_to','اكتب تاريخ النهاية.'],['note','اكتب السبب.']]},
  hr_loan:{prefix:'LON',category:'hr',subtype:'loan',title:'طلب سلفة',fields:[['amount','اكتب مبلغ السلفة.'],['note','اكتب السبب وطريقة الخصم المقترحة.']]},
  hr_certificate:{prefix:'CRT',category:'hr',subtype:'salary_certificate',title:'طلب تعريف راتب',fields:[['party','اكتب الجهة الموجه إليها التعريف.'],['note','اكتب أي ملاحظات مطلوبة.']]},
  hr_expiry:{prefix:'EXP',category:'hr',subtype:'document_expiry',title:'تنبيه انتهاء مستند',fields:[['item','اكتب نوع المستند: إقامة، رخصة، هوية.'],['due_date','اكتب تاريخ الانتهاء.'],['note','اكتب اسم الموظف أو الأصل.']]},
  hr_injury:{prefix:'INJ',category:'hr',subtype:'injury',title:'بلاغ إصابة',fields:[['party','اكتب اسم الموظف.'],['location','اكتب موقع الإصابة.'],['note','اكتب وصف الإصابة والإجراء المتخذ.']]},
  hr_payroll:{prefix:'PAYR',category:'hr',subtype:'payroll_note',title:'ملاحظة رواتب أو سلفة',fields:[['party','اكتب اسم الموظف.'],['amount','اكتب المبلغ إن وجد.'],['note','اكتب تفاصيل الراتب أو الخصم أو الإضافة.']]},
  quality_check:{prefix:'QCK',category:'quality',subtype:'check',title:'فحص جودة',fields:[['item','اكتب المنتج أو العملية.'],['result','اكتب نتيجة الفحص.'],['note','اكتب القياسات أو الملاحظات.']]},
  quality_issue:{prefix:'NCR',category:'quality',subtype:'nonconformity',title:'عدم مطابقة أو سلامة',fields:[['item','اكتب المنتج أو الموقع أو الأصل.'],['priority','اختر الخطورة.',[['normal','ملاحظة'],['urgent','تحتاج مراجعة'],['critical','حرجة']]],['note','اشرح المشكلة والأثر.']]},
  quality_corrective:{prefix:'CAP',category:'quality',subtype:'corrective_action',title:'إجراء تصحيحي',fields:[['item','اكتب مرجع المخالفة أو الموضوع.'],['party','اكتب المسؤول عن الإجراء.'],['due_date','اكتب موعد الإغلاق.'],['note','اكتب الإجراء التصحيحي.']]},
  trip_start:{prefix:'TRP',category:'trip',subtype:'start',title:'بدء رحلة',fields:[['asset','اكتب رقم السيارة أو اللوحة.'],['location','اكتب الوجهة أو العميل.'],['note','اكتب رقم الطلب أو الحمولة.']]},
  trip_loaded:{prefix:'TLD',category:'trip',subtype:'loaded',title:'تم التحميل',fields:[['asset','اكتب رقم السيارة أو اللوحة.'],['note','اكتب نوع وكمية الحمولة.']]},
  trip_arrived:{prefix:'TAR',category:'trip',subtype:'arrived',title:'وصول للموقع',fields:[['asset','اكتب رقم السيارة أو اللوحة.'],['location','اكتب الموقع أو العميل.'],['note','اكتب الملاحظة.']]},
  trip_delivered:{prefix:'TDL',category:'trip',subtype:'delivered',title:'تم التسليم',fields:[['asset','اكتب رقم السيارة أو اللوحة.'],['party','اكتب اسم العميل أو المستلم.'],['note','اكتب رقم سند التسليم أو الملاحظة.']]},
  trip_delay:{prefix:'TDY',category:'trip',subtype:'delay',title:'تأخير رحلة',fields:[['asset','اكتب رقم السيارة أو اللوحة.'],['location','اكتب الموقع الحالي.'],['note','اكتب سبب التأخير والوقت المتوقع.']]},
  trip_fault:{prefix:'TFT',category:'trip',subtype:'fault',title:'عطل أثناء رحلة',fields:[['asset','اكتب رقم السيارة أو اللوحة.'],['location','اكتب الموقع الحالي.'],['note','اكتب وصف العطل وهل المركبة متوقفة.']]},
  trip_end:{prefix:'TEN',category:'trip',subtype:'end',title:'إنهاء رحلة',fields:[['asset','اكتب رقم السيارة أو اللوحة.'],['odometer','اكتب قراءة العداد.'],['note','اكتب نتيجة الرحلة.']]},
  customer:{prefix:'CUS',category:'customer',subtype:'new',title:'عميل جديد',fields:[['party','اكتب اسم العميل أو المنشأة.'],['phone','اكتب رقم الجوال.'],['location','اكتب المدينة أو العنوان.'],['note','اكتب النشاط أو ملاحظات الائتمان.']]},
  daily_report:{prefix:'DLY',category:'incident',subtype:'daily_report',title:'تقرير يومي',fields:[['note','اكتب ما أنجزته، ما تعطل، وما يحتاج متابعة.']]},
  task_new:{prefix:'TSK',category:'task',subtype:'task',title:'مهمة جديدة',fields:[['title','اكتب عنوان المهمة.'],['party','اكتب اسم المسؤول أو اكتب نفسي.'],['due_date','اكتب موعد الإنجاز أو اكتب اليوم.'],['priority','اختر الأولوية.',[['normal','عادي'],['urgent','عاجل'],['critical','حرج']]],['note','اكتب تفاصيل المهمة.']]}
};

export function roleHomeRows(role){
  const rows=[];
  if(role==='admin'||role==='manager'){
    rows.push([{text:'🚨 ما يحتاج تدخلي الآن',callback_data:'ent:priorities'},{text:'✅ الاعتمادات',callback_data:'ent:approvals'}]);
    rows.push([{text:'📊 لوحة التشغيل',callback_data:'ent:operations'},{text:'🧭 بحث شامل',callback_data:'ent:search'}]);
    rows.push([{text:'🔧 الورشة',callback_data:'home:workshop'},{text:'🧱 المبيعات',callback_data:'home:sales'}]);
    rows.push([{text:'💰 المالية والتحصيل',callback_data:'ent:finance_menu'},{text:'📦 المخزون والشراء',callback_data:'ent:inventory_menu'}]);
    rows.push([{text:'⛽ الديزل والأسطول',callback_data:'ent:fuel_menu'},{text:'👥 الموظفون والمهام',callback_data:'ent:people_menu'}]);
    rows.push([{text:'🧪 الجودة والرقابة',callback_data:'ent:quality_menu'},{text:'🔎 الموردون والأسعار',callback_data:'home:suppliers'}]);
    rows.push([{text:'📄 المستندات الفورية',callback_data:'ent:documents'},{text:'🔔 التنبيهات',callback_data:'ent:alerts'}]);
  }else if(role==='accountant'){
    rows.push([{text:'💰 المالية',callback_data:'ent:finance_menu'},{text:'🧾 التحصيلات',callback_data:'ent:collection_menu'}]);
    rows.push([{text:'📦 المخزون والمشتريات',callback_data:'ent:inventory_menu'},{text:'⛽ الديزل',callback_data:'ent:fuel_menu'}]);
    rows.push([{text:'👥 الرواتب والموظفون',callback_data:'ent:hr_menu'},{text:'✅ الاعتمادات',callback_data:'ent:approvals'}]);
    rows.push([{text:'📋 مهامي',callback_data:'ent:my_tasks'},{text:'🧭 بحث شامل',callback_data:'ent:search'}]);
    rows.push([{text:'🔧 حالة الورشة',callback_data:'home:workshop'},{text:'🧱 أوامر البيع',callback_data:'home:sales'}]);
    rows.push([{text:'🔎 الموردون والأسعار',callback_data:'home:suppliers'}]);
  }else if(role==='mechanic'){
    rows.push([{text:'🔧 قائمة الورشة',callback_data:'home:workshop'},{text:'🔎 بحث قطعة أو مورد',callback_data:'home:suppliers'}]);
    rows.push([{text:'📋 مهامي',callback_data:'ent:my_tasks'},{text:'📦 طلب شراء',callback_data:'ent:purchase'}]);
    rows.push([{text:'⛽ تسجيل وقود',callback_data:'ent:fuel_fill'},{text:'🚚 حركة مركبة/رحلة',callback_data:'ent:trip_menu'}]);
    rows.push([{text:'🧪 بلاغ جودة أو سلامة',callback_data:'ent:quality_issue'}]);
  }else if(role==='block_sales'||role==='concrete_sales'){
    rows.push([{text:'➕ أمر بيع جديد',callback_data:'home:sales'},{text:'📋 أوامر البيع',callback_data:'home:sales'}]);
    rows.push([{text:'💵 تسجيل تحصيل',callback_data:'ent:collection_receipt'},{text:'👤 عميل جديد',callback_data:'ent:customer'}]);
    rows.push([{text:'📍 متابعة توريد/زيارة',callback_data:'ent:trip_menu'},{text:'📋 مهامي',callback_data:'ent:my_tasks'}]);
    rows.push([{text:'🧭 بحث',callback_data:'ent:search'},{text:'📝 تقريري اليومي',callback_data:'ent:daily_report'}]);
  }else if(role==='collector'){
    rows.push([{text:'💵 تسجيل تحصيل',callback_data:'ent:collection_receipt'},{text:'🤝 تسجيل زيارة',callback_data:'ent:collection_visit'}]);
    rows.push([{text:'📅 وعد سداد',callback_data:'ent:collection_promise'},{text:'📵 لم يرد',callback_data:'ent:collection_no_answer'}]);
    rows.push([{text:'📋 مهامي',callback_data:'ent:my_tasks'},{text:'📍 حركة اليوم',callback_data:'ent:trip_menu'}]);
    rows.push([{text:'📝 تقريري اليومي',callback_data:'ent:daily_report'},{text:'🧭 بحث عميل',callback_data:'ent:search'}]);
  }else rows.push([{text:'📋 مهامي',callback_data:'ent:my_tasks'},{text:'🧭 بحث',callback_data:'ent:search'}]);
  rows.push([{text:'ℹ️ المساعدة',callback_data:'ent:help'}]);
  return rows;
}
export const roleHomeKeyboard=role=>keyboard(roleHomeRows(role));
export const financeMenu=()=>keyboard([[{text:'➕ سند قبض',callback_data:'ent:finance_receipt'},{text:'➖ سند صرف',callback_data:'ent:finance_payment'}],[{text:'🧾 فاتورة مورد',callback_data:'ent:finance_invoice'},{text:'🏦 تسوية صندوق',callback_data:'ent:finance_cash'}],[{text:'👥 ملاحظة رواتب/سلفة',callback_data:'ent:hr_payroll'},{text:'📊 ملخص المالية',callback_data:'ent:finance_summary'}]]);
export const collectionMenu=()=>keyboard([[{text:'💵 تحصيل',callback_data:'ent:collection_receipt'},{text:'🤝 زيارة عميل',callback_data:'ent:collection_visit'}],[{text:'📅 وعد سداد',callback_data:'ent:collection_promise'},{text:'📵 لم يرد',callback_data:'ent:collection_no_answer'}],[{text:'📊 ملخص التحصيل',callback_data:'ent:collection_summary'}]]);
export const inventoryMenu=()=>keyboard([[{text:'📥 استلام صنف',callback_data:'ent:inventory_receive'},{text:'📤 صرف صنف',callback_data:'ent:inventory_issue'}],[{text:'🧮 جرد سريع',callback_data:'ent:inventory_count'},{text:'⚠️ صنف منخفض',callback_data:'ent:inventory_low'}],[{text:'🛒 طلب شراء',callback_data:'ent:purchase'},{text:'📊 حركة المخزون',callback_data:'ent:inventory_summary'}]]);
export const fuelMenu=()=>keyboard([[{text:'⛽ تسجيل تعبئة',callback_data:'ent:fuel_fill'},{text:'📏 تسجيل عداد',callback_data:'ent:fuel_odometer'}],[{text:'🚨 بلاغ فرق ديزل',callback_data:'ent:fuel_discrepancy'},{text:'📊 ملخص الديزل',callback_data:'ent:fuel_summary'}]]);
export const hrMenu=()=>keyboard([[{text:'🏖 طلب إجازة',callback_data:'ent:hr_leave'},{text:'💳 طلب سلفة',callback_data:'ent:hr_loan'}],[{text:'📄 تعريف راتب',callback_data:'ent:hr_certificate'},{text:'⏳ انتهاء مستند',callback_data:'ent:hr_expiry'}],[{text:'🩹 بلاغ إصابة',callback_data:'ent:hr_injury'},{text:'📊 ملخص الموظفين',callback_data:'ent:hr_summary'}]]);
export const qualityMenu=()=>keyboard([[{text:'🧪 فحص جودة',callback_data:'ent:quality_check'},{text:'⚠️ عدم مطابقة',callback_data:'ent:quality_issue'}],[{text:'🛠 إجراء تصحيحي',callback_data:'ent:quality_corrective'},{text:'📊 مخالفات الجودة',callback_data:'ent:quality_summary'}]]);
export const tripMenu=()=>keyboard([[{text:'▶️ بدأت الرحلة',callback_data:'ent:trip_start'},{text:'📦 تم التحميل',callback_data:'ent:trip_loaded'}],[{text:'📍 وصلت الموقع',callback_data:'ent:trip_arrived'},{text:'✅ تم التسليم',callback_data:'ent:trip_delivered'}],[{text:'⏱ يوجد تأخير',callback_data:'ent:trip_delay'},{text:'🔧 يوجد عطل',callback_data:'ent:trip_fault'}],[{text:'⏹ إنهاء الرحلة',callback_data:'ent:trip_end'}]]);
export const peopleMenu=()=>keyboard([[{text:'➕ إنشاء مهمة',callback_data:'ent:task_new'},{text:'📋 مهامي',callback_data:'ent:my_tasks'}],[{text:'👥 مهام الفريق',callback_data:'ent:team_tasks'},{text:'📝 تقارير الموظفين',callback_data:'ent:daily_reports'}],[{text:'👤 الموارد البشرية',callback_data:'ent:hr_menu'}]]);
export const optionsKeyboard=(action,items)=>{const rows=[];for(let i=0;i<items.length;i+=3)rows.push(items.slice(i,i+3).map(([value,label])=>({text:label,callback_data:`entopt:${action}|${value}`})));return keyboard(rows);};
export const statusKeyboard=reference=>keyboard([[{text:'بدء التنفيذ',callback_data:`entstatus:${reference}|in_progress`},{text:'مكتمل',callback_data:`entstatus:${reference}|completed`}],[{text:'بانتظار طرف آخر',callback_data:`entstatus:${reference}|waiting`},{text:'إلغاء',callback_data:`entstatus:${reference}|cancelled`}]]);
