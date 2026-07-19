import { requireAdmin } from '../auth.js';
import { readiness, validateEnvironment } from '../config.js';
import { json, method, errorResponse } from '../http.js';
import { select } from '../supabase.js';

export const LATEST_REQUIRED_VERSION=25;

export const DATABASE_TABLES=[
  'app_users','user_invitations','user_channels','telegram_groups','telegram_messages','employees','vehicles','customers','bot_sessions','maintenance_orders','approvals','audit_log','work_sites','employee_assignments','attendance_events','driver_events','operational_records','operation_events','sales_orders','sales_order_updates','inventory_items','inventory_movements','purchase_requests','supplier_quotes','collection_events','quality_cases','operational_tasks','notification_outbox','finance_events','hr_requests','employee_daily_reports','operation_status_history','document_registry','migration_history','daily_report_batches','daily_report_sales_lines','daily_report_cash_movements','daily_report_treasury_balances','daily_report_inventory_snapshots','daily_report_import_attempts','cost_ledger','sales_payment_allocations','fifo_rebuild_runs',
  'cost_centers','cost_periods','cost_calculation_runs','cost_allocation_rules','asset_cost_center_assignments','employee_cost_assignments','indirect_cost_allocations','operational_alerts','role_capabilities','user_capabilities','backup_runs','token_rotation_registry','gps_provider_events',
  'financial_periods','financial_period_events','credit_override_requests','unified_assets','asset_source_links','compliance_documents','custody_accounts','custody_transactions','restore_test_runs','handover_acceptance_runs','handover_signoffs',
  'chart_of_accounts','journal_entries','journal_entry_lines','telegram_update_receipts'
];
export const DATABASE_VIEWS=['daily_attendance_summary','driver_daily_summary','factory_daily_margin','cost_unit_monthly_report','control_credit_exposure','control_expiring_documents','control_open_custodies','control_asset_duplicates','general_ledger','trial_balance','accounting_integrity_report'];
export const DATABASE_COLUMN_CHECKS={
  app_users:['nickname'],
  employees:['nickname'],
  user_invitations:['nickname'],
  purchase_requests:['source_event_type','source_event_id'],
  operational_records:['operation_type','lifecycle_status','idempotency_key','source_reference','actor_id','actor_role','before_data','after_data','attempt_count'],
  notification_outbox:['dedupe_key','attempts','attempt_count','last_attempt_at','next_attempt_at','dead_letter_at'],
  imports:['file_hash','file_path','summary','processing_started_at','completed_at','approved_by','approved_at','posted_batch_id','result_summary','last_error_code'],
  daily_report_batches:['report_date','file_hash','content_hash','status','summary','committed_at','file_storage_path','approved_by','validation_errors','validation_warnings','preview_summary'],
  daily_report_sales_lines:['invoice_no','sales_type','customer_code','customer_name','quantity','amount','line_identity'],
  daily_report_cash_movements:['treasury_code','account_code','account_name','debit','credit','is_customer_collection','line_identity'],
  collection_events:['allocated_amount','unallocated_amount'],
  sales_orders:['credit_override_id'],
  sales_payment_allocations:['active','allocation_order','rebuild_run_id','superseded_at','updated_at'],
  cost_ledger:['cost_center_id','period_start','calculation_run_id','allocation_rule_id','source_hash','posted_status','reversed_entry_id'],
  driver_events:['client_event_id','fuel_liters','fuel_amount','receipt_photo_path'],
  unified_assets:['external_id','asset_type','operational_status','diesel_expected','assigned_employee_external_id','cost_center_code'],
  compliance_documents:['subject_type','subject_external_id','document_type','expiry_date','verified_at'],
  credit_override_requests:['customer_external_id','requested_amount','current_balance','credit_limit','status','expires_at'],
  handover_acceptance_runs:['reference_no','version_label','status','evidence','blockers'],
  chart_of_accounts:['account_code','account_name_ar','account_type','normal_side','active'],
  journal_entries:['reference_no','entry_date','source_type','source_id','source_batch_id','status','posted_by','posted_at','reversal_of'],
  journal_entry_lines:['journal_entry_id','line_no','account_id','debit','credit','customer_external_id','cost_center_code'],
  telegram_update_receipts:['update_id','status','attempts','retryable','last_error_code','updated_at']
};

async function checkRelation(name,type){try{await select(name,'select=*&limit=1');return{name,type,ready:true};}catch(error){return{name,type,ready:false,error:String(error?.message||error)};}}
async function checkColumns(table,columns){try{await select(table,`select=${columns.join(',')}&limit=1`);return{name:`${table}.${columns.join(',')}`,type:'columns',table,columns,ready:true};}catch(error){return{name:`${table}.${columns.join(',')}`,type:'columns',table,columns,ready:false,error:String(error?.message||error)};}}
async function migrationState(){try{const rows=await select('migration_history','select=version,migration_name,applied_at&order=version.asc&limit=100')||[],found=new Map(rows.map(row=>[Number(row.version),row])),missing=[];for(let version=1;version<=LATEST_REQUIRED_VERSION;version++)if(!found.has(version))missing.push(String(version).padStart(3,'0'));const schemaVersion=rows.length?Math.max(...rows.map(row=>Number(row.version)||0)):0;return{ready:missing.length===0,schemaVersion,missing,rows};}catch(error){return{ready:false,schemaVersion:0,missing:Array.from({length:LATEST_REQUIRED_VERSION},(_,index)=>String(index+1).padStart(3,'0')),rows:[],error:String(error?.message||error)};}}
export async function collectDatabaseReadiness(){
  const [relations,columnResults,migrations]=await Promise.all([Promise.all([...DATABASE_TABLES.map(name=>checkRelation(name,'table')),...DATABASE_VIEWS.map(name=>checkRelation(name,'view'))]),Promise.all(Object.entries(DATABASE_COLUMN_CHECKS).map(([table,columns])=>checkColumns(table,columns))),migrationState()]);
  const checks=[...relations,...columnResults,{name:'migration_history.sequence',type:'migration',ready:migrations.ready,error:migrations.error||null}],missingTables=relations.filter(item=>item.type==='table'&&!item.ready).map(item=>item.name),missingViews=relations.filter(item=>item.type==='view'&&!item.ready).map(item=>item.name),missingColumns=columnResults.filter(item=>!item.ready).map(item=>({table:item.table,columns:item.columns,error:item.error})),missingMigrations=migrations.missing,ready=!missingTables.length&&!missingViews.length&&!missingColumns.length&&!missingMigrations.length;
  return{ready,schemaVersion:String(migrations.schemaVersion).padStart(3,'0'),latestRequiredVersion:String(LATEST_REQUIRED_VERSION).padStart(3,'0'),missingTables,missingViews,missingColumns,missingMigrations,checks,appliedMigrations:migrations.rows};
}
export async function databaseReadiness(req,res){
  if(!method(req,res,['GET']))return;
  try{requireAdmin(req);const database=await collectDatabaseReadiness(),environment=validateEnvironment('runtime');json(res,200,{ok:database.ready,...database,environment:{ready:environment.ready,missingRequired:environment.missingRequired,checks:environment.checks.map(({name,configured,required,description})=>({name,configured,required,description}))},nextStep:database.ready?'قاعدة البيانات متوافقة مع Migration 025.':'شغّل migrations المفقودة بالترتيب ثم أعد الفحص.'});}catch(error){errorResponse(res,error);}
}
export async function status(req,res){
  if(!method(req,res,['GET']))return;
  const base=readiness();
  json(res,200,{ok:true,version:'2026.07.19-schema-25-unified-operation-engine',...base,publicUrlConfigured:Boolean(process.env.PUBLIC_APP_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL),placesConfigured:Boolean(process.env.GOOGLE_PLACES_API_KEY||process.env.PLACES_DIRECTORY_KEY),pdfConfigured:Boolean(process.env.PDF_API_URL||process.env.PDF_SERVICE_URL),webhookVersion:3,directOperationsSchema:25,conversationHistory:true,operationsActions:true,reportsCenter:true,documentVerification:true,notificationOutbox:true,unifiedOperationEngine:true,operationIdempotency:true,operationLifecycle:true,operationEventHistory:true,outboxDeadLetter:true,schedulerWorkflow:true,dailyReportImport:true,dailyReportIdempotency:true,dailyReportCustomerMaster:true,fifoReplay:true,costLedgerFoundation:true,costEngine:true,maintenanceCostReversals:true,granularPermissions:true,backupTooling:true,gpsAdapter:true,financialPeriodClose:true,creditOverrideWorkflow:true,unifiedAssetRegister:true,complianceRegister:true,custodyControl:true,restoreTestRegister:true,handoverAcceptance:true,governanceCenter:true,creditBreachDiscrepancies:true,assetDuplicateControl:true,accountingLedger:true,balancedJournalPosting:true,correctReversalLedger:true,telegramUpdateIdempotency:true,importLifecycle:true,factoryOperationalReset:true,employeeNickname:true,financialDirector:true,administrativeControlCenter:true,vercelFunctionsExpected:6});
}
