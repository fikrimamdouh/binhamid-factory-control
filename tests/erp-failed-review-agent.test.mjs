import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERP_FAILED_RETRY_POLICIES,
  ERP_FAILED_RETRY_REVISION,
  ERP_REVIEWED_SUPERSEDED_FILES
} from '../api/_lib/routes/erp-failed-retry-policy.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('failed ERP agent retries only explicitly repairable failures',()=>{
  assert.match(ERP_FAILED_RETRY_REVISION,/reviewed-july-superseded/);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_RANGE_UNDATED_ROWS.autoRetry,true);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_RANGE_UNDATED_ROWS.maxAttemptsPerRevision,1);
  assert.match(ERP_FAILED_RETRY_POLICIES.ERP_RANGE_UNDATED_ROWS.reason,/day-month-swapped dates/);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_SYNC_NOT_DAILY_REPORT.autoRetry,false);
  assert.equal(ERP_FAILED_RETRY_POLICIES.ERP_TRANSACTION_CONFLICT.autoRetry,false);
});

test('reviewed July failures are archived only by exact SHA-256 evidence',()=>{
  assert.equal(ERP_REVIEWED_SUPERSEDED_FILES.length,4);
  const hashes=new Set(ERP_REVIEWED_SUPERSEDED_FILES.map(row=>row.sha256));
  assert.equal(hashes.size,4);
  for(const row of ERP_REVIEWED_SUPERSEDED_FILES){
    assert.match(row.sha256,/^[0-9a-f]{64}$/);
    assert.equal(row.disposition,'archive-superseded');
    assert.ok(row.reason.length>40);
  }
  assert.ok(hashes.has('71b21730518a0928c9bb271de115b3dee04dead3f13a703bf2df0bf2669fb12a'));
  assert.ok(hashes.has('566b8cba38d1180ed6b91d1d9ec5780d5601afbdaa50ff72a4c3c1fcb1c3e063'));
  assert.ok(hashes.has('171b4d74b4f049e563a371843e88d6dab151adc08b2b7a4993d0975ab41131c6'));
  assert.ok(hashes.has('48ff97eceb9ec35ca51ef9d14b46846f12d4aea25b2e8d2007e1c73a5baf13a0'));
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

test('exact reviewed hashes are archived before filename and retry classification',async()=>{
  const script=await read('tools/erp-failed-review-agent/FailedReviewAgent.ps1');
  const hashGate=script.indexOf('$supersededByHash.ContainsKey($hash)');
  const filenameGate=script.indexOf('$reportDate = Get-ReportDateFromName $file.Name');
  assert.ok(hashGate>0);
  assert.ok(filenameGate>hashGate);
  assert.match(script,/reviewed-superseded/);
  assert.match(script,/production already contains its approved data/);
  assert.match(script,/\$policy\.supersededFiles/);
});

test('failed copies are archived only when a newer processed report supersedes them',async()=>{
  const script=await read('tools/erp-failed-review-agent/FailedReviewAgent.ps1');
  assert.match(script,/\$ProcessedDir = Join-Path \$Root 'Processed'/);
  assert.match(script,/\$processedByDate = @\{\}/);
  assert.match(script,/\$processed\.LastWriteTimeUtc -ge \$file\.LastWriteTimeUtc/);
  assert.match(script,/superseded-by-processed/);
  assert.match(script,/newer successful processed report exists for the same date/);
});

test('central router exposes the public non-sensitive retry policy',async()=>{
  const router=await read('api/router.js');
  assert.match(router,/erp-failed-retry-policy/);
  assert.match(router,/erpFailedRetryPolicy\.erpFailedRetryPolicy/);
});
