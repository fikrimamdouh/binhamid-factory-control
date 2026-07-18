import { config } from './config.js';
function fetchRetry(url, options = {}, tries = 3) {
  return (async () => {
    let lastError;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try { return await fetch(url, options); }
      catch (error) {
        lastError = error;
        const signal = String(error?.cause?.code || error?.cause?.message || error?.message || '');
        const transient = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|socket|network|fetch failed|terminated|TLS/i.test(signal);
        if (!transient || attempt === tries) throw error;
        await new Promise(r => setTimeout(r, 350 * attempt));
      }
    }
    throw lastError;
  })();
}

function ensure() {
  if (!config.supabaseUrl || !config.supabaseKey) throw Object.assign(new Error('Supabase غير مضبوط على Vercel'), { status: 503 });
}
function serviceHeaders(extra = {}) {
  const key = String(config.supabaseKey || '').trim();
  const headers = { apikey: key, ...extra };
  // Supabase secret keys (sb_secret_...) are API keys, not JWTs, and must not
  // be sent as Bearer tokens. Legacy service_role keys are JWTs and still
  // require Authorization so PostgREST assumes the service_role database role.
  if (key && !key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}
export async function supabase(path, options = {}) {
  ensure();
  const response = await fetchRetry(`${config.supabaseUrl}${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(),
      ...(options.body && !(options.body instanceof Uint8Array) && !(options.body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint || data?.msg || text || `Supabase ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status === 409 ? 409 : 502, upstreamStatus: response.status, data });
  }
  return data;
}
export const select = (table, query = '') => supabase(`/rest/v1/${table}${query ? `?${query}` : ''}`, { headers: { Prefer: 'count=exact' } });
export const insert = (table, rows, options = {}) => supabase(`/rest/v1/${table}${options.query ? `?${options.query}` : ''}`, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: options.prefer || 'return=representation' } });
export const upsert = (table, rows, onConflict) => supabase(`/rest/v1/${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
export const patch = (table, query, values) => supabase(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: JSON.stringify(values), headers: { Prefer: 'return=representation' } });
export const rpc = (name, args) => supabase(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args), headers: { Prefer: 'return=representation' } });
export const remove = (table, query = '') => supabase(`/rest/v1/${table}${query ? `?${query}` : ''}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });

const storageErrorCode=error=>String(error?.data?.code||error?.data?.error||error?.data?.errorCode||'').trim();
const storageErrorText=error=>`${storageErrorCode(error)} ${String(error?.message||'')}`.trim();
const storageBucketMissing=error=>/NoSuchBucket|Bucket not found|specified bucket does not exist|bucket does not exist/i.test(storageErrorText(error));
const storageBucketExists=error=>Number(error?.upstreamStatus||0)===409||/BucketAlreadyExists|already exists/i.test(storageErrorText(error));

async function createPrivateStorageBucket(bucket){
  try{
    return await supabase('/storage/v1/bucket',{method:'POST',body:JSON.stringify({id:bucket,name:bucket,public:false})});
  }catch(error){
    if(storageBucketExists(error))return{id:bucket,name:bucket,public:false,existing:true};
    throw Object.assign(error,{storageBucket:bucket,storageOperation:'create_bucket',storageCode:storageErrorCode(error)||null});
  }
}

export async function uploadObject(path, buffer, contentType = 'application/octet-stream') {
  ensure();
  const bucket=String(config.storageBucket||'').trim(),encoded=path.split('/').map(encodeURIComponent).join('/');
  const upload=()=>supabase(`/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`, { method: 'POST', body: buffer, headers: { 'Content-Type': contentType, 'x-upsert': 'true' } });
  try{return await upload();}
  catch(error){
    if(!storageBucketMissing(error))throw Object.assign(error,{storageBucket:bucket,storageOperation:'upload',storageCode:storageErrorCode(error)||null});
    await createPrivateStorageBucket(bucket);
    try{return await upload();}
    catch(retryError){throw Object.assign(retryError,{storageBucket:bucket,storageOperation:'upload_after_bucket_create',storageCode:storageErrorCode(retryError)||null});}
  }
}
export async function downloadObject(path) {
  ensure();
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetchRetry(`${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(config.storageBucket)}/${encoded}`, { headers: serviceHeaders() });
  if (!response.ok) throw Object.assign(new Error(`تعذر تنزيل المرفق: ${response.status}`), { status: 502 });
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
