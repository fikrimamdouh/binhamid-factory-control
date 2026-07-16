# دليل تدوير الأسرار كل 3 أشهر

قاعدة أساسية: قاعدة البيانات تحفظ اسم السر وتواريخ التدوير فقط. قيمة السر لا تُحفظ داخلها ولا داخل Git.

## ترتيب التدوير

1. أنشئ قيمة جديدة من مزود الخدمة.
2. أضفها إلى Vercel Production وPreview.
3. نفّذ Redeploy.
4. اختبر الوظيفة المرتبطة.
5. ألغِ القيمة القديمة بعد نجاح الاختبار.
6. سجل تاريخ التدوير عبر `/api/resilience` دون إرسال القيمة.

## Supabase Service Role

- أنشئ أو دوّر المفتاح من إعدادات Supabase.
- حدّث `SUPABASE_SERVICE_ROLE_KEY` في Vercel وأسرار GitHub Actions المستخدمة للنسخ.
- اختبر `/api/system/database-readiness` ورفع ملف إلى Storage.
- ألغِ المفتاح القديم بعد نجاح الاختبارات.

## Admin Token

- أنشئ قيمة عشوائية طويلة.
- حدّث `BINHAMID_ADMIN_TOKEN` في Vercel والعميل الإداري المعتمد.
- نفّذ Redeploy واختبر Endpoint إداريًا.
- لا تضع Token في عنوان URL أو سجلات المتصفح.

## Telegram

1. دوّر `TELEGRAM_BOT_TOKEN` عند الحاجة من BotFather.
2. دوّر `TELEGRAM_WEBHOOK_SECRET` محليًا.
3. حدّث Vercel.
4. نفّذ `/api/telegram/register`.
5. افحص `/api/telegram/status`.
6. أرسل رسالة نصية وملف Excel وصورة ورسالة صوتية اختبارية.

## OpenAI

- دوّر `OPENAI_API_KEY` من لوحة OpenAI.
- حدّث Vercel.
- اختبر رسالة صوتية.
- غياب المفتاح يجب أن يعطل التفريغ الصوتي فقط، لا Webhook كاملًا.

## GPS

- دوّر `GPS_API_TOKEN` أو كلمة المرور.
- اختبر الاتصال في بيئة Preview أولًا.
- لا تُظهر بيانات اعتماد المزود في رسائل الخطأ.

## تسجيل إتمام التدوير

```bash
curl -fsS -X POST \
  -H "x-admin-token: $BINHAMID_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"action":"token_rotation_record","secretName":"TELEGRAM_WEBHOOK_SECRET"}' \
  https://binhamid-factory-control.vercel.app/api/resilience
```

الطلب يسجل `last_rotated_at` و`next_due_at` فقط.
