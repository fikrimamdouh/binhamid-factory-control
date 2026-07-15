import { config } from './config.js';
function ensure() {
  if (!config.supabaseUrl || !config.supabaseKey) throw Object.assign(new Error('Supabase غير مضبوط على Vercel'), { status: 503 });
}
export async function supabase(path, options = {}) {
  ensure();
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: config.supabaseKey,
      Authorization: `Bearer ${config.supabaseKey}`,
      ...(options.body && !(options.body instanceof Uint8Array) && !(options.body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint || text || `Supabase ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status === 409 ? 409 : 502, upstreamStatus: response.status, data });
  }
  return data;
}
export const select = (table, query = '') => supabase(`/rest/v1/${table}${query ? `?${query}` : ''}`, { headers: { Prefer: 'count=exact' } });
export const insert = (table, rows, options = {}) => supabase(`/rest/v1/${table}${options.query ? `?${options.query}` : ''}`, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: options.prefer || 'return=representation' } });
export const upsert = (table, rows, onConflict) => supabase(`/rest/v1/${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
export const patch = (table, query, values) => supabase(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: JSON.stringify(values), headers: { Prefer: 'return=representation' } });
export const rpc = (name, args) => supabase(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args), headers: { Prefer: 'return=representation' } });
export async function uploadObject(path, buffer, contentType = 'application/octet-stream') {
  ensure();
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return supabase(`/storage/v1/object/${encodeURIComponent(config.storageBucket)}/${encoded}`, { method: 'POST', body: buffer, headers: { 'Content-Type': contentType, 'x-upsert': 'true' } });
}
export async function downloadObject(path) {
  ensure();
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.storageBucket)}/${encoded}`, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` } });
  if (!response.ok) throw Object.assign(new Error(`تعذر تنزيل المرفق: ${response.status}`), { status: 502 });
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
