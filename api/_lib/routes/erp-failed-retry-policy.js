import { json, method } from '../http.js';

export const ERP_FAILED_RETRY_REVISION='2026.08.03-all-undated-sales-cash-v2';

export const ERP_FAILED_RETRY_POLICIES=Object.freeze({
  ERP_RANGE_UNDATED_ROWS:Object.freeze({
    autoRetry:true,
    maxAttemptsPerRevision:1,
    strategy:'latest-file-per-report-date',
    reason:'The production importer can now assign the date encoded in Daily-Report-YYYY-MM-DD to undated sales and cash rows.'
  }),
  ERP_SYNC_NOT_DAILY_REPORT:Object.freeze({
    autoRetry:false,
    reason:'The workbook has no recognized daily-report data and requires source-file review.'
  }),
  ERP_TRANSACTION_CONFLICT:Object.freeze({
    autoRetry:false,
    reason:'Conflicting invoice or payment data requires accounting review.'
  }),
  ERP_PAYMENT_MIGRATION_REQUIRED:Object.freeze({
    autoRetry:false,
    reason:'Database migration readiness must be confirmed before another upload.'
  }),
  ERP_SYNC_XLSX_REQUIRED:Object.freeze({
    autoRetry:false,
    reason:'The file is not a valid XLSX workbook.'
  }),
  ERP_SYNC_FILE_REQUIRED:Object.freeze({
    autoRetry:false,
    reason:'The source file is empty or missing.'
  }),
  ERP_SYNC_AUTH_REQUIRED:Object.freeze({
    autoRetry:false,
    reason:'The computer synchronization credentials require repair.'
  })
});

export function erpFailedRetryPolicy(req,res){
  if(!method(req,res,['GET']))return;
  return json(res,200,{
    ok:true,
    revision:ERP_FAILED_RETRY_REVISION,
    defaultPolicy:{autoRetry:false,maxAttemptsPerRevision:0,strategy:'manual-review'},
    dailyFilenamePattern:'^Daily-Report-(20\\d{2}-\\d{2}-\\d{2})',
    policies:ERP_FAILED_RETRY_POLICIES
  });
}
