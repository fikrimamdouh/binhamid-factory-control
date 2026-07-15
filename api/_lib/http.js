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
  json(res, status, { error: status >= 500 ? 'تعذر تنفيذ العملية على الخادم' : error.message, detail: process.env.NODE_ENV === 'development' ? error.message : undefined });
}
