import { requireCapability } from '../permissions.js';
import { readiness } from '../config.js';
import { json, method, errorResponse } from '../http.js';
import { select } from '../supabase.js';

const REQUIRED=['app_users','user_channels','telegram_groups','telegram_messages','employees','vehicles','customers','bot_sessions','maintenance_orders','approvals','audit_log','work_sites','employee_assignments','attendance_events','driver_events','operational_records','sales_orders','sales_order_updates','inventory_items','inventory_movements','purchase_requests','supplier_quotes','collection_events','quality_cases','operational_tasks','notification_outbox'];

export async function databaseReadiness(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'system.diagnostics');
    const results=await Promise.all(REQUIRED.map(async table=>{try{await select(table,'select=*&limit=1');return{table,ready:true};}catch(error){return{table,ready:false,error:error.message};}}));
    const missing=results.filter(x=>!x.ready);
    json(res,200,{ok:missing.length===0,ready:missing.length===0,total:results.length,available:results.filter(x=>x.ready).map(x=>x.table),missing});
  }catch(error){errorResponse(res,error);}
}

export async function status(req,res){
  if(!method(req,res,['GET']))return;
  const pdfUrl=String(process.env.PDF_API_URL||''),pdfKey=String(process.env.PDF_API_KEY||'');
  let pdfHost='';try{pdfHost=pdfUrl?new URL(pdfUrl).host:'';}catch(_){pdfHost='رابط غير صالح';}
  const pdfDiagnostics={
    urlSet:Boolean(pdfUrl),keySet:Boolean(pdfKey),host:pdfHost,
    provider:/browser-rendering\/pdf/i.test(pdfUrl)?'cloudflare':/gotenberg|forms\/chromium/i.test(pdfUrl)?'gotenberg':pdfUrl?'json':'',
    accountPlaceholderStillPresent:/\/accounts\/ACCOUNT_ID\//i.test(pdfUrl),
    accountIdLooksValid:/\/accounts\/[0-9a-f]{32}\//i.test(pdfUrl),
    keyLooksLikeGlobalApiKey:pdfKey.length>0&&pdfKey.length<=37&&/^[0-9a-f]+$/i.test(pdfKey)
  };
  json(res,200,{ok:true,version:'2026.07.21-fleet-attendance-status',...readiness(),placesConfigured:Boolean(process.env.GOOGLE_PLACES_API_KEY||process.env.PLACES_DIRECTORY_KEY),fleetAttendanceStatus:true,cronConfigured:Boolean(process.env.CRON_SECRET),pdfConfigured:Boolean(process.env.PDF_API_URL&&process.env.PDF_API_KEY),pdfDiagnostics,webhookVersion:3,conversationHistory:true,directOperationsSchema:4});
}
