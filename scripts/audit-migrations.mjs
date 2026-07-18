import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory=resolve('supabase/migrations'),files=readdirSync(directory).filter(name=>/^\d{3}_.+\.sql$/.test(name)).sort(),versions=files.map(name=>Number(name.slice(0,3))),errors=[];
const latest=22;
for(let version=1;version<=latest;version++){if(!versions.includes(version))errors.push(`missing migration ${String(version).padStart(3,'0')}`);}
if(new Set(versions).size!==versions.length)errors.push('duplicate migration version');
if(Math.max(...versions)!==latest)errors.push(`latest migration must be ${String(latest).padStart(3,'0')}`);
for(const file of files){
  const sql=readFileSync(resolve(directory,file),'utf8'),version=Number(file.slice(0,3));
  if(/^\+/m.test(sql))errors.push(`${file}: unexpected leading + character`);
  if(/\bdrop\s+table\b(?!\s+if\s+exists)/i.test(sql))errors.push(`${file}: destructive DROP TABLE without IF EXISTS`);
  if(/\btruncate\b/i.test(sql))errors.push(`${file}: TRUNCATE is not allowed`);
  if(version>=10&&!/migration_history/i.test(sql))errors.push(`${file}: migration_history marker missing`);
  if(version===11){for(const marker of ['cost_centers','cost_periods','cost_calculation_runs','cost_unit_monthly_report','run_cost_period','operational_alerts','role_capabilities','backup_runs','gps_provider_events'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===12){for(const marker of ['daily_report_import_attempts','line_identity','daily_report_sales_identity_uidx','daily_report_cash_identity_uidx','register_daily_report_attempt'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===13){for(const marker of ['fifo_rebuild_runs','rebuild_customer_fifo','preview_customer_fifo_rebuild','maintenance_order_reversal','sales_order_backdated_fifo_trigger'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===14){for(const marker of ['allocate_collection_fifo_core','tg_op=\'UPDATE\'','maintenance trigger INSERT guard'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===15){for(const marker of ['ensure_daily_report_customer','new.customer_name','new.account_name','DAILY_REPORT_CUSTOMER_INACTIVE'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===16){for(const marker of ['financial_periods','credit_override_requests','unified_assets','asset_source_links','compliance_documents','custody_accounts','restore_test_runs','handover_acceptance_runs','control_credit_exposure','unified_assets_plate_idx'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===17){for(const marker of ['close_financial_period','request_credit_override','guard_sales_order_credit','approve_custody_transaction','guard_maintenance_closure','start_handover_acceptance','sign_handover_acceptance'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===18){for(const marker of ['unified_assets_plate_idx','flag_daily_report_credit_breach','daily_report_credit_breach_flag','control_asset_duplicates','CREDIT_LIMIT_EXCEEDED'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===19){for(const marker of ['chart_of_accounts','journal_entries','journal_entry_lines','general_ledger','trial_balance','post_daily_report_accounting','transition_import_status','telegram_update_receipts','claim_telegram_update'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===20){for(const marker of ['reverse_journal_entry','accounting_integrity_report','project_sales_audit_event','project_operational_audit_event','trial_balance'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===21){for(const marker of ["status in ('posted','reversed')",'general_ledger','trial_balance','accounting_integrity_report'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
  if(version===22){for(const marker of ['MIGRATION_021_REQUIRED','create extension if not exists pgcrypto','transition_import_status','telegram_update_receipts','commit_daily_report_acceptance'])if(!sql.includes(marker))errors.push(`${file}: missing ${marker}`);}
}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`MIGRATIONS_OK=${files.length};LATEST=${String(latest).padStart(3,'0')}`);
