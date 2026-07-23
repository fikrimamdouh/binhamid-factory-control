const SAFE_SERVER_ERROR_CODES = new Set([
  'DAILY_REPORT_STORAGE_FAILED',
  'DAILY_REPORT_ACCOUNT_CONFIGURATION_MISSING',
  'DAILY_REPORT_COMMIT_TIMEOUT',
  'DAILY_REPORT_DATABASE_COMMIT_FAILED'
]);

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}
export function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { error: 'الطريقة غير مسموحة' });
  return false;
}
export async function body(req, limit = 4_200_000) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('حجم الطلب أكبر من الحد المسموح'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('صيغة JSON غير صحيحة'), { status: 400 }); }
}
export function errorResponse(res, error) {
  console.error(error);
  const status = Number(error?.status || error?.statusCode || 500);
  const code=String(error?.code||'').replace(/[^A-Z0-9_-]/gi,'').slice(0,120)||undefined;
  const safeServerMessage=Boolean(code&&SAFE_SERVER_ERROR_CODES.has(code));
  json(res, status, {
    error: status >= 500 && !safeServerMessage ? 'تعذر تنفيذ العملية على الخادم' : error.message,
    code,
    detail: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
