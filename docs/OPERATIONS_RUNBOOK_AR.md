# دليل التشغيل الخارجي — مصنع بن حامد

هذا الدليل للخطوات التي تحتاج صلاحية Supabase أو Vercel أو Telegram. لا تسجل أي قيمة سرية في Git أو مخرجات الأوامر.

## 1. تطبيق قاعدة البيانات

نفّذ بالترتيب:

1. `011_cost_centers_and_operational_resilience.sql`
2. `012_daily_report_idempotency_and_validation.sql`
3. `013_fifo_rebuild_and_cost_reversals.sql`
4. `014_fifo_replay_and_maintenance_trigger_guard.sql`

عبر Supabase CLI:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
```

التحقق:

```bash
curl -fsS \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  https://binhamid-factory-control.vercel.app/api/system/database-readiness
```

النتيجة المقبولة:

```json
{
  "ready": true,
  "schemaVersion": "014",
  "latestRequiredVersion": "014",
  "missingTables": [],
  "missingColumns": [],
  "missingMigrations": []
}
```

## 2. متغيرات Vercel

طابق Production وPreview مع `.env.example`.

الأساسية:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`
- `PUBLIC_APP_URL`
- `BINHAMID_ADMIN_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_OWNER_ID`
- `CRON_SECRET`

حسب الوظيفة:

- `OPENAI_API_KEY`
- `SUPABASE_DB_URL`
- `RESTORE_DATABASE_URL`
- `BACKUP_ENCRYPTION_KEY`
- متغيرات `GPS_*`

بعد الإضافة نفّذ Redeploy واحدًا ثم افحص:

```bash
curl -fsS https://binhamid-factory-control.vercel.app/api/system/status
```

## 3. Telegram Webhook

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{}' \
  https://binhamid-factory-control.vercel.app/api/telegram/register

curl -fsS \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  https://binhamid-factory-control.vercel.app/api/telegram/status
```

تحقق من أن الرابط ينتهي بـ`/api/telegram/webhook-v3` ولا توجد رسالة خطأ حديثة.

## 4. التقرير اليومي

ابدأ بـ`action=preview`. لا تعتمد قبل `valid=true` و`reconciliationDifference=0`.

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  --data @daily-report-preview.json \
  https://binhamid-factory-control.vercel.app/api/daily-report
```

إعادة نفس الطلب بعد الاعتماد يجب أن تعيد `duplicate=true` و`existingImportId`.

### تقرير رجعي وFIFO

Dry Run لعميل متأثر:

```bash
curl -fsS \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  "https://binhamid-factory-control.vercel.app/api/daily-report/fifo?customerCode=CUSTOMER_CODE"
```

إعادة البناء بعد المراجعة:

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"customerCode":"CUSTOMER_CODE","reason":"اعتماد تقرير رجعي بعد المراجعة","confirm":true}' \
  https://binhamid-factory-control.vercel.app/api/daily-report/fifo
```

التوزيعات السابقة لا تُحذف؛ تتحول إلى `active=false` ويرتبط التشغيل بسجل `fifo_rebuild_runs`.

## 5. محرك التكلفة

Dry Run:

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"action":"calculate","period":"2026-07","dryRun":true}' \
  https://binhamid-factory-control.vercel.app/api/costs
```

التشغيل الفعلي يستخدم `dryRun=false`. الاعتماد يحتاج `runId`. لا تعتمد فترة بها `unclassifiedCost` دون مراجعة.

إعادة فتح أمر صيانة مغلق تنشئ قيد تعديل سالبًا مرتبطًا بالقيد السابق عبر `reversed_entry_id`.

## 6. النسخ الاحتياطي

على Runner يحتوي `pg_dump` و`psql`:

```bash
npm install --ignore-scripts
npm run backup
```

تحقق من `checksumSha256` و`schemaVersion` و`storagePath`. احتفظ بملف `*.manifest.json` مع النسخة.

## 7. اختبار الاستعادة

ممنوع استخدام قاعدة الإنتاج كهدف:

```bash
export ALLOW_RESTORE_TEST_DATABASE=true
export RESTORE_ENVIRONMENT=staging
npm run restore:test -- /secure/path/binhamid-production-....sql.gz.enc
```

النجاح يتطلب Schema Version لا يقل عن `014`، وعدم وجود جداول حرجة مفقودة. النتيجة في `.restore-work/restore-result.json`.

## 8. GPS

```text
GPS_PROVIDER=traccar
GPS_API_BASE_URL=https://gps.example.com
GPS_API_TOKEN=<Vercel Secret>
```

`MockGpsAdapter` ممنوع خارج الاختبارات.

## 9. تحقق ما بعد النشر

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run check
npx --yes vercel@56.2.0 build --yes
```

ثم افحص:

- `/api/system/database-readiness`
- `/api/telegram/status`
- `/api/dashboard`
- `/api/daily-report`
- `/api/daily-report/fifo`
- `/api/costs?action=report&period=2026-07`
- `/api/resilience`

نجاح Build وحده لا يثبت نجاح دورة العمل.
