import { json, method } from '../http.js';

export const ERP_FAILED_RETRY_REVISION='2026.08.03-reviewed-july-superseded-v5';

export const ERP_REVIEWED_SUPERSEDED_FILES=Object.freeze([
  Object.freeze({
    sha256:'71b21730518a0928c9bb271de115b3dee04dead3f13a703bf2df0bf2669fb12a',
    reportDate:'2026-07-27',
    disposition:'archive-superseded',
    reason:'All 15 invoices are already posted under the 2026-07-25 batch and all 12 reviewed customer collections are already settled under the 2026-07-26 batch.'
  }),
  Object.freeze({
    sha256:'566b8cba38d1180ed6b91d1d9ec5780d5601afbdaa50ff72a4c3c1fcb1c3e063',
    reportDate:'2026-07-31',
    disposition:'archive-superseded',
    reason:'The approved 2026-07-31 batch already contains the two customer collections totaling 10,700 SAR and the related accounting movements.'
  }),
  Object.freeze({
    sha256:'171b4d74b4f049e563a371843e88d6dab151adc08b2b7a4993d0975ab41131c6',
    reportDate:'2026-07-28',
    disposition:'archive-superseded',
    reason:'The approved 2026-07-28 batch already contains 18 invoices totaling 53,721 SAR and 12 customer collections totaling 24,627 SAR.'
  }),
  Object.freeze({
    sha256:'48ff97eceb9ec35ca51ef9d14b46846f12d4aea25b2e8d2007e1c73a5baf13a0',
    reportDate:'2026-07-19/2026-07-26',
    disposition:'archive-superseded',
    reason:'The reviewed 19-26 July customer collections were reconciled previously; this aggregate undated copy must not be imported again.'
  })
]);

export const ERP_FAILED_RETRY_POLICIES=Object.freeze({
  ERP_RANGE_UNDATED_ROWS:Object.freeze({
    autoRetry:true,
    maxAttemptsPerRevision:1,
    strategy:'latest-file-per-report-date',
    reason:'The production importer now assigns the Daily-Report filename date to undated rows and corrects ERP day-month-swapped dates in named daily workbooks.'
  }),
  ERP_SYNC_NOT_DAILY_REPORT:Object.freeze({
    autoRetry:false,
    reason:'The workbook has no recognized daily-report data. If a newer successful Processed copy exists for the same date, the local review agent archives this failed copy as superseded; otherwise source-file review is required.'
  }),
  ERP_TRANSACTION_CONFLICT:Object.freeze({
    autoRetry:false,
    reason:'Conflicting invoice or payment data requires accounting review unless a newer successful Processed copy already supersedes it.'
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
    supersededFiles:ERP_REVIEWED_SUPERSEDED_FILES,
    policies:ERP_FAILED_RETRY_POLICIES
  });
}
