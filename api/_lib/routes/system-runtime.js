import { requireAdmin } from '../auth.js';
import { readiness } from '../config.js';
import { json, method, errorResponse } from '../http.js';
import { select } from '../supabase.js';

const TABLES=['app_users','user_channels','telegram_groups','telegram_messages','employees','vehicles','customers','bot_sessions','maintenance_orders','approvals','audit_log','work_sites','employee_assignments','attendance_events','driver_events','operational_records','sales_orders','sales_order_updates','inventory_items','inventory_movements','purchase_requests','supplier_quotes','collection_events','quality_cases','operational_tasks','notification_outbox','finance_events','hr_requests','employee_daily_reports','operation_status_history','document_registry','migration_history','daily_report_batches','daily_report_sales_lines','daily_report_cash_movements','daily_report_treasury_balances','daily_report_inventory_snapshots','cost_ledger','sales_payment_allocations'];
const VIEWS=['daily_attendance_summary','driver_daily_summary','factory_daily_margin'];
async function check(name,type){try{await select(name,'select=*&limit=1');return{name,type,ready:true};}catch(error){return{name,type,ready:false,error:error.message};}}
async function checkRfqs(){try{await select('purchase_requests','select=source_event_type,source_event_id&limit=1');return{name:'purchase_requests.rfq_projection',type:'columns',ready:true};}catch(error){return{name:'purchase_requests.rfq_projection',type:'columns',ready:false,error:error.message};}}
async function checkMigration(){try{const rows=await select('migration_history','version=eq.10&select=version,migration_name,applied_at&limit=1');if(rows?.[0])return{name:'migration_history.version_10',type:'migration',ready:true};return{name:'migration_history.version_10',type:'migration',ready:false,error:'Migration 010 غير مسجلة'};}catch(error){return{name:'migration_history.version_10',type:'migration',ready:false,error:error.message};}}
export async function databaseReadiness(req,res){
  if(!method(req,res,['GET']))return;
  try{
    requireAdmin(req);
    const results=await Promise.all([...TABLES.map(name=>check(name,'table')),...VIEWS.map(name=>check(name,'view')),checkRfqs(),checkMigration()]),missing=results.filter(item=>!item.ready);
    json(res,200,{ok:missing.length===0,ready:missing.length===0,schemaVersion:10,total:results.length,available:results.filter(item=>item.ready).map(item=>item.name),missing,nextStep:missing.length?'شغّل ملفات قاعدة البيانات من 001 إلى 010 بالترتيب.':'قاعدة البيانات التشغيلية مكتملة، ومستورد التقرير اليومي ومحرك التكلفة الأساسي جاهزان.'});
  }catch(error){errorResponse(res,error);}
}
export async function status(req,res){
  if(!method(req,res,['GET']))return;
  const base=readiness();
  json(res,200,{ok:true,version:'2026.07.16-factory-os-runtime-10',...base,publicUrlConfigured:Boolean(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL),placesConfigured:Boolean(process.env.GOOGLE_PLACES_API_KEY||process.env.PLACES_DIRECTORY_KEY),gpsConfigured:Boolean(process.env.GPS_API_BASE_URL),cronConfigured:Boolean(process.env.CRON_SECRET),pdfConfigured:Boolean(process.env.PDF_API_URL||process.env.PDF_SERVICE_URL),webhookVersion:3,directOperationsSchema:10,conversationHistory:true,operationsActions:true,reportsCenter:true,documentVerification:true,notificationOutbox:true,schedulerWorkflow:true,dailyReportImport:true,costLedgerFoundation:true,vercelFunctionsExpected:6});
}
