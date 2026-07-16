# دليل تشغيل خارجي — مصنع بن حامد

هذا الدليل يفصل الخطوات التي لا يمكن إثبات تنفيذها من داخل GitHub وحده. لا تسجل أي قيمة سرية في Git أو مخرجات الأوامر.

## 1. تطبيق قاعدة البيانات

نفّذ الملفات بالترتيب داخل Supabase SQL Editor:

1. `supabase/migrations/011_cost_centers_and_operational_resilience.sql`
2. `supabase/migrations/012_daily_report_idempotency_and_validation.sql`

أو من جهاز مرتبط بالمشروع عبر Supabase CLI:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
```

التحقق بعد التطبيق:

```bash
curl -fsS \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  https://binhamid-factory-control.vercel.app/api/system/database-readiness
```

النتيجة المقبولة:

- `ready=true`
- `schemaVersion="012"`
- `latestRequiredVersion="012"`
- جميع قوائم `missing*` فارغة.

## 2. متغيرات Vercel

طابق Production وPreview مع `.env.example`. المتغيرات الأساسية:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `PUBLIC_APP_URL`
- `BINHAMID_ADMIN_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_OWNER_ID`
- `CRON_SECRET`

المتغيرات الاختيارية حسب الوظيفة:

- `OPENAI_API_KEY`
- `SUPABASE_DB_URL`
- `RESTORE_DATABASE_URL`
- `BACKUP_ENCRYPTION_KEY`
- متغيرات `GPS_*`

بعد الإضافة نفّذ Redeploy واحدًا ثم افحص:

```bash
curl -fsS https://binhamid-factory-control.vercel.app/api/system/status
```

لا تنسخ نتيجة تحتوي على أسرار؛ Endpoint الحالة لا يعيد القيم نفسها.

## 3. تسجيل Telegram Webhook

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{}' \
  https://binhamid-factory-control.vercel.app/api/telegram/register
```

ثم:

```bash
curl -fsS \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  https://binhamid-factory-control.vercel.app/api/telegram/status
```

تحقق من أن رابط Webhook ينتهي بـ`/api/telegram/webhook-v3`، ولا توجد رسالة خطأ حديثة.

## 4. اختبار التقرير اليومي

استخدم أولًا `action=preview`. لا تستخدم `commit` قبل أن تكون `valid=true` و`reconciliationDifference=0`.

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data @daily-report-preview.json \
  https://binhamid-factory-control.vercel.app/api/daily-report
```

أعد الطلب نفسه للتحقق من ثبات `idempotencyKey`. بعد الاعتماد، إعادة الطلب يجب أن تعيد `duplicate=true` مع `existingImportId`.

## 5. محرك التكلفة

Dry Run:

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"action":"calculate","period":"2026-07","dryRun":true}' \
  https://binhamid-factory-control.vercel.app/api/costs
```

التشغيل الفعلي يستخدم `dryRun=false`. الاعتماد يحتاج `runId` ناتجًا عن التشغيل. لا تعتمد فترة بها `unclassifiedCost` دون مراجعة.

## 6. النسخ الاحتياطي

على Runner يحتوي `pg_dump` و`psql`:

```bash
npm install --ignore-scripts
npm run backup
```

المخرجات المقبولة تشمل:

- مسار الملف.
- `checksumSha256`.
- `schemaVersion`.
- `storagePath` عند نجاح الرفع.

احتفظ بملف `*.manifest.json` مع النسخة.

## 7. اختبار الاستعادة

ممنوع استخدام قاعدة الإنتاج كهدف.

```bash
export ALLOW_RESTORE_TEST_DATABASE=true
export RESTORE_ENVIRONMENT=staging
npm run restore:test -- /secure/path/binhamid-production-....sql.gz.enc
```

النجاح يتطلب Schema Version لا يقل عن `012` وعدم وجود جداول حرجة مفقودة. النتيجة تحفظ في `.restore-work/restore-result.json`.

## 8. GPS

عند استخدام Traccar:

```text
GPS_PROVIDER=traccar
GPS_API_BASE_URL=https://gps.example.com
GPS_API_TOKEN=<Vercel Secret>
```

لا تستخدم `MockGpsAdapter` في الإنتاج؛ الكود يمنعه خارج الاختبارات.

## 9. تحقق ما بعد النشر

نفّذ بالترتيب:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run check
npx --yes vercel@56.2.0 build --yes
```

ثم افحص:

- `/api/system/database-readiness`
- `/api/telegram/status`
- `/api/dashboard`
- `/api/costs?action=report&period=2026-07`
- `/api/resilience`

لا تعتبر النشر ناجحًا إذا نجح Build فقط وفشلت أي دورة عمل فعلية.
