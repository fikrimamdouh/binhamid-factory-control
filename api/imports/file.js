import { requireAdmin } from '../_lib/auth.js';
import { method, errorResponse } from '../_lib/http.js';
import { select, downloadObject } from '../_lib/supabase.js';
export default async function handler(req,res){
  if(!method(req,res,['GET']))return;
  try{requireAdmin(req);const id=String(req.query?.id||'');if(!id)throw Object.assign(new Error('رقم الملف مطلوب'),{status:400});const rows=await select('imports',`id=eq.${encodeURIComponent(id)}&select=id,file_path,original_name,mime_type&limit=1`);const row=rows?.[0];if(!row)throw Object.assign(new Error('الملف غير موجود'),{status:404});const file=await downloadObject(row.file_path);res.statusCode=200;res.setHeader('Content-Type',row.mime_type||file.contentType);res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.original_name||'report.xlsx')}`);res.setHeader('Cache-Control','private, no-store');res.end(file.buffer);}catch(error){if(!res.headersSent)errorResponse(res,error);else res.end();}
}
