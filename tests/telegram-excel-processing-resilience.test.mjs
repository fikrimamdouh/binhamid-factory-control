import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=parts=>fs.readFileSync(new URL(parts.join('/'),import.meta.url),'utf8');

test('Excel processing success is not converted into a processing failure when result or PDF delivery fails',()=>{
  const source=read(['..','api','_lib','bot-files.js']);
  assert.match(source,/async function sendProcessingResult/);
  assert.match(source,/\[telegram excel result reply\]/);
  assert.match(source,/async function sendCumulativeDailyReports/);
  assert.match(source,/\[telegram daily cumulative pdf\]/);
  assert.match(source,/await sendProcessingResult\(chatId,resultText,name\);/);
  assert.match(source,/result\?\.recognizedDaily.*sendCumulativeDailyReports[\s\S]*return result;/);
  assert.match(source,/تمت معالجة ملف .* وحفظ نتيجته، لكن تعذر إرسال تفاصيل القراءة/);
  assert.match(source,/تم حفظ ملف Excel وقراءته، لكن تعذر إنشاء تقريري PDF/);
});

test('Excel failures retain a safe processing stage without exposing internal credentials',()=>{
  const source=read(['..','api','_lib','bot-files.js']);
  assert.match(source,/excelStep\('download'/);
  assert.match(source,/excelStep\('lookup'/);
  assert.match(source,/excelStep\('storage'/);
  assert.match(source,/excelStep\('registry'/);
  assert.match(source,/تعذر تنزيل الملف من Telegram بعد إعادة المحاولة/);
  assert.match(source,/تعذر تسجيل الملف في مركز الوارد بعد حفظ النسخة الأصلية/);
  assert.doesNotMatch(source,/config\.telegramToken.*console/);
  assert.doesNotMatch(source,/config\.supabaseKey.*console/);
});

test('Telegram file downloads enforce the configured size and retry transient file CDN responses',()=>{
  const source=read(['..','api','_lib','telegram.js']);
  assert.match(source,/downloadTelegramFile\(fileId,options=\{\}\)/);
  assert.match(source,/config\.maxImportFileBytes/);
  assert.match(source,/TELEGRAM_FILE_TOO_LARGE/);
  assert.match(source,/\[408,425,429,500,502,503,504\]\.includes\(response\.status\)/);
  assert.match(source,/TELEGRAM_FILE_EMPTY/);
});
