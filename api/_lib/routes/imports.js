import { requireAdmin } from '../auth.js';
import { json, method, body, errorResponse } from '../http.js';
import { patch, select, downloadObject } from '../supabase.js';

const allowed=['received','processing','ready','failed','opened_in_program','approved','rejected'];

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

export async function file(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const id=String(req.query?.id||'');
    if(!id)throw Object.assign(new Error('رقم الملف مطلوب'),{status:400});
    const rows=await select('imports',`id=eq.${encodeURIComponent(id)}&select=id,file_path,original_name,mime_type&limit=1`);
    const row=rows?.[0];
    if(!row)throw Object.assign(new Error('الملف غير موجود'),{status:404});
    const downloaded=await downloadObject(row.file_path);
    res.statusCode=200;
    res.setHeader('Content-Type',row.mime_type||downloaded.contentType);
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.original_name||'report.xlsx')}`);
    res.setHeader('Cache-Control','private, no-store');
    res.end(downloaded.buffer);
  }catch(error){if(!res.headersSent)errorResponse(res,error);else res.end();}
}
