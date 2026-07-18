# جرد وحدات النظام الحالية

> مرجع الحالة: `main` عند `917c74f4be825880b865a5a6257b66f9003b3063`.

## 1. واجهات الموقع المثبتة

| الواجهة | الملف | الوظيفة الحالية | ملاحظة رقابية |
|---|---|---|---|
| المدخل الرئيسي | `index.html` | تحميل النظام والتنقل | يعتمد على طبقات Assets وواجهة Legacy |
| النظام التشغيلي القديم | `legacy.html` | وظائف تشغيل وإدارة واسعة | خط أساس 8,273 سطرًا؛ ممنوع زيادته لكنه ما زال عالي المخاطر |
| مركز الرقابة | `control-center.html` | قرار الجاهزية والمخاطر | مرتبط بـ `/api/control-center` |
| الحوكمة | `governance.html` | الصلاحيات والرقابة والاستمرارية | يحتاج ربطًا كاملًا بمصفوفة الصلاحيات النهائية |
| المحاسبة | `accounting.html` | القيود والدفتر وميزان المراجعة | القراءة والعكس موجودان؛ إنشاء الفاتورة من أمر البيع غير مكتمل |
| تصميم الخلطات | `mix-designs.html` | تكلفة ومراجعة الخلطات | صلاحيات متخصصة موجودة |
| عمليات تيليجرام | `telegram-operations.html` | مراجعة نشاط البوت والعمليات | واجهة متابعة وليست مصدر حقيقة مستقلًا |

## 2. مسارات API المثبتة

جميع المسارات التالية تمر عبر `api/router.js`، باستثناء Webhook تيليجرام:

| المسار العام | ملف الوحدة | الوظيفة |
|---|---|---|
| `/api/admin/groups` | `routes/admin.js` | إدارة مجموعات تيليجرام |
| `/api/admin/users` | `routes/admin.js` | إدارة المستخدمين |
| `/api/dashboard` | `routes/manager-dashboard.js` | لوحة المدير |
| `/api/control-center` | `routes/control-center.js` | مركز الرقابة وقرار الجاهزية |
| `/api/governance` | `routes/governance.js` | الحوكمة والصلاحيات والرقابة |
| `/api/device/session` | `routes/device-session.js` | جلسات وربط الأجهزة |
| `/api/conversations` | `routes/management.js` | مركز محادثات تيليجرام |
| `/api/operations` | `routes/management.js` | العمليات والاعتمادات والمهام |
| `/api/reports` | `routes/management.js` | تقارير تشغيلية مجمعة |
| `/api/documents/verify` | `routes/management.js` | التحقق العام المحدود من المستندات |
| `/api/imports/status` | `routes/imports.js` | متابعة الاستيراد |
| `/api/daily-report` | `routes/daily-report.js` | معاينة واعتماد التقرير اليومي |
| `/api/daily-report/fifo` | `routes/fifo.js` | توزيع التحصيلات |
| `/api/accounting` | `routes/accounting.js` | القيود والدفتر والميزان والعكس |
| `/api/system/database-readiness` | `routes/system-runtime.js` | جاهزية قاعدة البيانات |
| `/api/system/status` | `routes/system-runtime.js` | حالة النظام |
| `/api/telegram/register` | `routes/telegram-admin.js` | تسجيل وربط تيليجرام |
| `/api/telegram/status` | `routes/telegram-admin.js` | حالة تيليجرام |
| `/api/telegram/test` | `routes/telegram-admin.js` | اختبار الاتصال |
| `/api/telegram/notify` | `routes/telegram-admin.js` | إشعار إداري |
| `/api/costs` | `routes/costs.js` | التكاليف |
| `/api/mix-designs` | `routes/mix-designs.js` | الخلطات والأسعار |
| `/api/driver/webapp` | `routes/driver-webapp.js` | واجهة السائق |
| `/api/resilience` | `routes/resilience.js` | النسخ والاستمرارية |
| `/api/fleet/status` | `routes/fleet-status.js` | حالة الأسطول |
| `/api/auth/request` | `routes/web-auth.js` | طلب دخول الموقع |
| `/api/auth/verify` | `routes/web-auth.js` | تحقق واعتماد الدخول |
| `/api/factory-reset` | `routes/factory-reset.js` | تنظيف اختباري محمي |
| `/api/telegram/mini-app` | `routes/telegram-mini-app.js` | خدمات Mini App |
| `/api/telegram/webhook` | `api/telegram/webhook-v3` | استقبال تحديثات تيليجرام |

## 3. وحدات تيليجرام المثبتة

| الوحدة | الملف أو المجموعة | الوظائف المعروفة |
|---|---|---|
| Webhook والتوجيه | `bot-webhook-core.js`, `telegram.js`, `webhook-v3` | استقبال التحديث، التحقق، الردود، Callbacks |
| الأوامر والقوائم | `bot-commands.js` | توجيه الأوامر العامة |
| المبيعات | `bot-sales.js` | أوامر بيع بلوك وخرسانة، متابعة الحالات، عرض القوائم |
| العملاء والتقارير | `bot-customer-reports.js` | إنشاء/بحث العميل وكشوف وتقارير |
| الملفات وExcel | `bot-files.js` | حفظ الملفات، تحليل Excel، ربط الاستيراد |
| الصوت والذكاء | مسارات Webhook وEnterprise | تفريغ الصوت، فهم النية، تمريرها إلى الجلسات |
| الإنتاج | `bot-enterprise.js`, `bot-enterprise-defs.js` | تقارير الخرسانة والبلوك والعمليات الإدارية |
| المحاسبة والتكاليف | `bot-costs.js` ووحدات المحاسبة | ملخصات وتكاليف ومؤشرات مالية |
| الصيانة | `bot-maintenance.js` | بلاغات ومتابعة الصيانة |
| الموقع والحضور | `bot-gps.js` | إحداثيات وحضور ومسارات السائق |
| الإشعارات | `bot-notifications.js`, `bot-notifications-safe.js` | إرسال وتنبيهات ومحاولات آمنة |
| الدعوات والهوية | وحدات التسجيل والدعوات | ربط الموظف والدور والكنية والجهاز |
| الاقتراحات والمشكلات | مسارات Enterprise | حفظ بلاغ وإخطار الإدارة وإيصالات الاطلاع |

## 4. وحدات الدومين وقواعد البيانات المرصودة

### العملاء والمبيعات

- `customers`
- `sales_orders`
- `daily_report_sales_lines`
- `collection_events`
- `daily_report_cash_movements`
- `approvals`

### المحاسبة

- `chart_of_accounts`
- `journal_entries`
- `journal_entry_lines`
- `trial_balance`
- `general_ledger`
- RPC: `commit_daily_report_acceptance`
- RPC: `reverse_journal_entry`

### الاستيراد والملفات

- `imports`
- `daily_report_batches`
- سجل محاولات التقرير اليومي
- Supabase Storage للملفات الأصلية
- `document_registry`

### التشغيل والإدارة

- `operational_records`
- `operational_tasks`
- `purchase_requests`
- `finance_events`
- `quality_cases`
- `notification_outbox`
- `audit_log`

### الموظفون والصلاحيات

- `app_users`
- `employees`
- `user_channels`
- `user_invitations`
- `role_capabilities`
- `user_capabilities`
- `device_enrollments`
- `bot_sessions`

### تيليجرام

- `telegram_messages`
- `telegram_groups`
- إيصالات تحديثات/Webhook ومنع التكرار الخاصة بها

### الأصول والتشغيل الميداني

- جداول الأصول الموحدة والمركبات
- `maintenance_orders`
- `inventory_movements`
- `inventory_items`
- ملخصات حضور الموظفين والسائقين
- بيانات الوقود والديزل ومراكز التكلفة

### الاستمرارية

- `backup_runs`
- Workflows النسخ المشفر
- Scripts الاستعادة المعزولة والتحقق

## 5. اختبارات وبوابات الجودة

المشروع يعرّف في `package.json`:

- `npm test`: جميع `tests/*.test.mjs`.
- `audit:functions` و`check:functions`.
- `check:api`.
- `audit:migrations`.
- `audit:legacy`.
- `audit:dependencies`.
- `backup`.
- `restore:test`.
- `npm run check` كبوابة مجمعة.

كما توجد Workflows مستقلة لجودة PR، جاهزية الإنتاج، النسخ، الاستعادة، وتطبيق الترحيلات المحكومة.

## 6. مناطق التداخل الحالية

| الملف/الوحدة | المسؤوليات المجمعة | قرار التفكيك المستقبلي |
|---|---|---|
| `legacy.html` | واجهة وتشغيل وحقن وحدات | عدم إضافة وظائف جديدة؛ نقل تدريجي |
| `routes/management.js` | محادثات، عمليات، مهام، اعتماد، إشعار، تقارير، تحقق مستند | تقسيم حسب الدومين بعد إنشاء خدمة العمليات |
| `bot-sales.js` | Parsing، جلسات، حفظ، حالات، حذف، تقارير، إشعارات | فصل Adapter عن Sales Service |
| `bot-files.js` | تنزيل، تخزين، تحليل، Import lifecycle، إشعار | فصل File Intake عن Parser وعن Posting |
| وحدات Enterprise | تعريف نماذج وتشغيل وإشعار وتقارير | ربط كل عملية بجدول دومين واضح |

## 7. الوحدات غير المثبت اكتمالها

وجود اسم أو زر أو تقرير لا يثبت اكتمال دورة العملية. الوحدات التالية تحتاج إثباتًا من الإنشاء إلى الاعتماد والترحيل والعكس والتقرير:

- الموردون وعروض الموردين.
- المشتريات كاملة حتى فاتورة المورد والسداد.
- الفاتورة الناتجة مباشرة من أمر البيع.
- المصروفات وربطها بالقيد.
- المخزون والتحويل والجرد والتسوية.
- العهدة كاملة حتى الإرجاع والتسوية.
- الحضور من تيليجرام والموقع مع منع الانتحال.
- الديزل وربط كل حركة بأصل واحد.
- الصيانة كاملة حتى التكلفة والاختبار والإغلاق.
- الصوت والصورة من المسودة حتى تأكيد المستخدم.

هذه العناصر تظهر في مصفوفة التكافؤ كـ `جزئي` أو `غير مثبت` إلى أن تنجح اختبارات القبول.