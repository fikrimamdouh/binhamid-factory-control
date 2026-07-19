# خريطة تدفق البيانات — الموقع وتيليجرام

> الهدف: تحديد مصدر الحقيقة لكل عملية، وأين يختلف التدفق الحالي عن التصميم الموحد المطلوب.

## 1. الصورة الحالية العامة

```text
Website HTML/Assets ──> API Router ──> Route Module ──> Supabase REST/RPC
                                               ├──> audit_log
                                               ├──> direct Telegram send
                                               └──> notification_outbox (بعض المسارات)

Telegram Webhook ──> Bot Router/Session ──> Bot Domain File ──> Supabase REST/RPC
                                                    ├──> audit_log
                                                    ├──> direct Telegram send
                                                    └──> operational_records / domain table حسب الوحدة
```

المشكلة ليست في تعدد الواجهات، بل في أن اختيار جدول الحفظ والخدمة والاعتماد يختلف من وحدة لأخرى.

## 2. تدفق التقرير اليومي — النموذج الأقرب للصحيح

### من الموقع

```text
Excel في المتصفح
  -> Parse/Normalize
  -> POST /api/daily-report action=preview
  -> requireCapability(daily_report.import)
  -> validatePayload
  -> duplicate checks
  -> imports = ready_for_review
  -> POST action=commit
  -> requireCapability(daily_report.approve)
  -> resolveStoredOriginal
  -> RPC commit_daily_report_acceptance
       -> daily_report_batches
       -> sales/cash/inventory lines
       -> customer balances/FIFO
       -> journal_entries + journal_entry_lines
       -> audit/status evidence
  -> response to website
```

### من تيليجرام

```text
Telegram document
  -> save import + original/storage metadata
  -> parse workbook
  -> commitDailyReportFromTelegram
  -> validatePayload
  -> duplicate checks
  -> resolveStoredOriginal(importId)
  -> نفس RPC commit_daily_report_acceptance
  -> accounting evidence
  -> Telegram result
```

### نقاط القوة

- نفس التحقق ونفس RPC.
- بصمة ملف ومحتوى.
- منع تقريرين لنفس التاريخ.
- إثبات القيود واتزانها.
- فشل الترحيل لا يترك اعتمادًا جزئيًا ظاهرًا.

### الفجوات المتبقية

- إثبات E2E واقعي من الواجهتين على نفس الملف.
- إعادة محاولة Storage دون إعادة الترحيل.
- توحيد الإشعار عبر Outbox بدل الإرسال المباشر حيثما ينطبق.

## 3. تدفق أمر البيع الحالي من تيليجرام

```text
Telegram text/voice
  -> session sales_new_order
  -> parseOrder
  -> عرض ملخص
  -> زر تأكيد
  -> next_document_no
  -> upsert sales_orders(reference_no)
  -> insert audit_log(sales_order_created)
  -> Telegram confirmation
```

### تحديث الحالة

```text
Telegram command
  -> statusFromUpdate
  -> upsert sales_orders(status)
  -> insert audit_log(sales_order_updated)
  -> Telegram confirmation
```

### فجوة الفوترة

```text
"إصدار فاتورة BH-..."
  -> status = invoiced
  -> لا Invoice Service مثبت
  -> لا إنشاء فاتورة فعلية مثبت
  -> لا قيد محاسبي من هذا المسار
```

### مزامنة السجلات القديمة

```text
Read sales list
  -> read sales_orders
  -> read audit_log legacy events
  -> create missing sales_orders أثناء القراءة
```

هذه آلية انتقالية وليست تصميمًا نهائيًا؛ القراءة يجب ألا تنتج كتابة بعد انتهاء Backfill الرسمي.

## 4. تدفق العمليات العامة الحالي

### تحديث حالة عملية

```text
POST /api/operations action=set_status
  -> requireAdmin
  -> read operational_records
  -> insert audit_log(enterprise_operation_status)
  -> direct Telegram notification
```

الفجوة: لا يظهر تحديث `operational_records.status` في التدفق الحالي المثبت.

### إنشاء مهمة إدارية

```text
POST /api/operations action=create_task
  -> next_document_no(TSK)
  -> insert audit_log(enterprise_operation_created)
```

الفجوة: التقارير تقرأ `operational_tasks`، لكن الإنشاء المثبت هنا لا يكتب إليه.

### قرار اعتماد

```text
POST /api/operations action=approval_decision
  -> requireAdmin
  -> read approvals
  -> patch approvals
  -> patch domain table إن كان النوع معروفًا
  -> insert audit_log
  -> direct Telegram notification
```

الفجوات:

- لا Transaction موحدة ظاهرة بين الخطوات.
- `decided_by` لا يظهر بوضوح في Patch الحالي.
- إرسال الإشعار خارج Outbox.
- قائمة أنواع الجداول ثابتة ومحدودة.

## 5. تدفق الصلاحيات الحالي

```text
Request
  -> requireAdminOrDevice
  -> x-app-user-id
  -> verify active app_users
  -> merge ROLE_CAPABILITIES + role_capabilities + user_capabilities
  -> explicit user allow/deny
  -> execute route
```

المشكلة: ليست كل المسارات تستخدم `requireCapability`; بعض المسارات تستخدم `requireAdmin` العام، وبعض منطق تيليجرام يفحص الدور مباشرة داخل الملف.

## 6. تدفق الصوت الحالي والمستهدف

### الحالي المرصود

```text
Voice received
  -> acknowledgment
  -> download/store/transcribe
  -> text routed into command/session logic
  -> بعض المسارات تعرض ملخصًا قبل التنفيذ
```

### المستهدف الملزم

```text
Voice received
  -> store original
  -> transcription record
  -> intent + entities
  -> operation draft
  -> show understood text and fields
  -> user confirm/edit/cancel
  -> executeOperation(idempotency_key)
  -> domain record + audit + outbox
```

لا يسمح بتنفيذ حركة مالية حساسة مباشرة من ناتج التفريغ.

## 7. تدفق الصورة والملف المستهدف

```text
Image/File
  -> content hash
  -> file registry
  -> malware/type/size checks
  -> OCR/vision/parser
  -> extracted draft
  -> confidence + field warnings
  -> user confirmation
  -> linked domain operation
```

كل ملف يحتاج:

- `file_id`.
- `content_hash`.
- `owner_user_id`.
- `source_channel`.
- `source_reference`.
- `entity_type/entity_id`.
- `storage_status`.
- `scan_status`.
- `access_policy`.

## 8. التصميم المستهدف العام

```text
Telegram Adapter ─┐
                  ├── Command DTO
Website Adapter ──┘
                         |
                         v
                 Operation Service
        execute / approve / reject / post / reverse
                         |
          ┌──────────────┼──────────────┐
          v              v              v
     Domain Table    Audit Event    Notification Outbox
          |
          v
    Accounting/Inventory/Reports
```

## 9. عقد العملية المستهدف

```json
{
  "operation_id": "uuid",
  "operation_type": "sales.invoice.post",
  "source": "web|telegram",
  "source_reference": "message/file/request id",
  "actor_user_id": "uuid",
  "actor_role": "accountant",
  "status": "draft|pending_review|approved|posted|completed|...",
  "idempotency_key": "stable key",
  "domain_entity_type": "invoice",
  "domain_entity_id": "uuid",
  "accounting_reference": "journal id|null",
  "document_reference": "file/document id|null",
  "before": {},
  "after": {},
  "approved_by": "uuid|null",
  "approved_at": "timestamp|null",
  "error_code": null,
  "retry_count": 0
}
```

## 10. حدود المعاملات المطلوبة

كل تنفيذ حساس يجب أن يضع داخل Transaction واحدة:

1. فحص Idempotency داخل قاعدة البيانات.
2. إنشاء/تحديث سجل العملية.
3. إنشاء/تحديث سجل الدومين.
4. القيود أو حركات المخزون المرتبطة.
5. Audit append-only.
6. Outbox pending.

الإرسال الخارجي، PDF، البريد، وتيليجرام تتم بعد Commit بواسطة Worker أو Retry endpoint.

## 11. مصدر الحقيقة المقترح لكل وحدة

| الوحدة | مصدر الحقيقة |
|---|---|
| العميل | `customers` |
| الموظف | `employees` مع ربط `app_users` و`user_channels` |
| أمر البيع | `sales_orders` |
| الفاتورة | `sales_invoices` أو جدول الفواتير الحالي بعد توحيده |
| التحصيل | `collection_events` + allocations |
| القيد | `journal_entries` و`journal_entry_lines` |
| الاستيراد | `imports` ثم جدول الدومين الناتج |
| المهمة | `operational_tasks` |
| العملية العامة | `operational_records` فقط عندما لا يوجد جدول دومين متخصص |
| الاعتماد | `approvals` مرتبط بالسجل الأصلي |
| الإشعار | `notification_outbox` |
| التدقيق | `audit_log` كحدث غير قابل للتعديل، لا كسجل أصلي |
| الملف | File registry + Storage |

## 12. قاعدة الانتقال

لا ينقل أي مسار من تخزينه الحالي إلى الخدمة الموحدة قبل:

- اختبار يثبت السلوك الحالي المقبول.
- تحديد جدول مصدر الحقيقة.
- تعريف Idempotency.
- تعريف انتقالات الحالات.
- تعريف أثر المحاسبة والمخزون.
- خطة Backfill للسجلات القديمة.
- خطة Rollback دون حذف بيانات إنتاج.