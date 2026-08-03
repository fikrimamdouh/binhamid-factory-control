import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ERP_FAILED_RETRY_POLICIES, ERP_FAILED_RETRY_REVISION } from '../api/_lib/routes/erp-failed-retry-policy.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('failed ERP agent retries only explicitly repairable failures',()=>{
  assert.match(ERP_FAILED_RETRY_REVISION,/swapped-day-month-and-undated/);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_RANGE_UNDATED_ROWS.autoRetry,true);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_RANGE_UNDATED_ROWS.maxAttemptsPerRevision,1);
  assert.match(ERP_FAILED_RETRY_POLICIES.ERP_RANGE_UNDATED_ROWS.reason,/day-month-swapped dates/);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_SYNC_NOT_DAILY_REPORT.autoRetry,false);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_TRANSACTION_CONFLICT.autoRetry,false);
});

test('local failed-review agent is revision-bound, hash-bound and uses the existing Incoming uploader',async()=>{
  const script=await read('tools/erp-failed-review-agent/FailedReviewAgent.ps1');
  assert.match(script,/Get-FileHash/);
  assert.match(script,/\$hash,\$chosen\.ErrorCode,\$revision/);
  assert.match(script,/maxAttemptsPerRevision/);
  assert.match(script,/Group-Object ReportDate/);
  assert.match(script,/ManualReview\\Superseded/);
  assert.match(script,/Move-Unique -File \$chosen\.File -DestinationDirectory \$IncomingDir/);
  assert.doesNotMatch(script,/x-erp-sync-token/i);
});

test('central router exposes the public non-sensitive retry policy',async()=>{
  const router=await read('api/router.js');
  assert.match(router,/erp-failed-retry-policy/);
  assert.match(router,/erpFailedRetryPolicy\.erpFailedRetryPolicy/);
});
