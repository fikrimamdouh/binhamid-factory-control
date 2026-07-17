import { requireAdmin } from '../auth.js';
import { json, method, body, errorResponse } from '../http.js';
import { downloadObject, patch, select } from '../supabase.js';

const allowed=['received','processing','ready','failed','opened_in_program','approved','rejected'];
const clean=value=>String(value??'').trim();
const safeAsciiName=value=>clean(value).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,180)||'import-file';
const encodedName=value=>encodeURIComponent(clean(value).slice(0,240)||'import-file').replace(/['()]/g,escape);
const queryParams=req=>new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;

export async function status(req,res){
  if(!method(req,res,['POST']))return;
  try{
    requireAdmin(req);
    const input=await body(req);
    if(!allowed.includes(input.status))throw Object.assign(new Error('الحالة غير صحيحة'),{status:400});
    const rows=await patch('imports',`id=eq.${encodeURIComponent(input.id)}`,{status:input.status,updated_at:new Date().toISOString()});
    json(res,200,{ok:true,import:rows?.[0]});
  }catch(error){errorResponse(res,error);}
}

export async function download(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const id=clean(req.query?.id||queryParams(req).get('id'));
    if(!/^[0-9a-f-]{36}$/i.test(id))throw Object.assign(new Error('معرّف الملف غير صحيح'),{status:400});
    const record=(await select('imports',`id=eq.${encodeURIComponent(id)}&select=id,original_name,mime_type,file_path,status&limit=1`))?.[0];
    if(!record)throw Object.assign(new Error('الملف غير موجود في مركز الوارد'),{status:404});
    if(!record.file_path)throw Object.assign(new Error('لا توجد نسخة أصلية محفوظة لهذا السجل'),{status:404});
    const downloaded=await downloadObject(record.file_path),filename=clean(record.original_name)||'import-file';
    res.statusCode=200;
    res.setHeader('Content-Type',record.mime_type||downloaded.contentType||'application/octet-stream');
    res.setHeader('Content-Length',String(downloaded.buffer.length));
    res.setHeader('Content-Disposition',`attachment; filename="${safeAsciiName(filename)}"; filename*=UTF-8''${encodedName(filename)}`);
    res.setHeader('Cache-Control','no-store, private, max-age=0');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.end(downloaded.buffer);
  }catch(error){errorResponse(res,error);}
}
