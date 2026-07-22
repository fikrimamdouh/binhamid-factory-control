import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const telegram=read('assets/telegram-pdf-declarations.js');
const loginSync=read('assets/login-sync.js');
const syncGuard=read('assets/sync-integrity-guard.js');
const stateApi=read('api/state.js');
const permissions=read('api/_lib/permissions.js');
const reportRoute=read('api/_lib/routes/reports-telegram.js');
const legacy=read('legacy.html');
const index=read('index.html');

test('Telegram receives the snapshot captured at the exact native print call',()=>{
  assert.match(telegram,/window\.print=function\(\)/);
  assert.match(telegram,/snapshot=clonePrintSheet/);
  assert.match(telegram,/request\?'telegram':'print'/);
  assert.match(telegram,/settle\(request,'resolve',snapshot\)/);
  assert.match(telegram,/لم تستدعِ دالة الطباعة الأصلية window\.print/);
  assert.doesNotMatch(telegram,/setTimeout\([^\n]*(?:350|450)/);
});

test('stale print captures are rejected before the next document starts',()=>{
  assert.match(telegram,/if\(captureRequest\)settle\(captureRequest,'reject'/);
  assert.match(telegram,/requestAnimationFrame\(function\(\)\{requestAnimationFrame/);
  assert.match(telegram,/زر الطباعة لم يُنشئ ورقة جديدة/);
  assert.doesNotMatch(telegram,/يوجد مستند آخر قيد التجهيز/);
});

test('print documents use a central registry and document-ready events',()=>{
  assert.match(telegram,/data-print-document/);
  assert.match(telegram,/bhRegisterPrintDocument/);
  assert.match(telegram,/bhPrintDocumentRegistry/);
  assert.match(telegram,/binhamid-document-ready/);
  assert.match(telegram,/new CustomEvent\('document-ready'/);
  assert.match(telegram,/HISTORY_KEY/);
  assert.doesNotMatch(telegram,/KNOWN_PRINTERS|PRINTERS=\[/);
});

test('all current legacy print buttons are covered by registry migration',()=>{
  const buttons=[...legacy.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)].map(match=>match[0]);
  const printable=buttons.filter(tag=>/onclick\s*=\s*["'][^"']*print/i.test(tag)||/طباعة|اطبع/.test(tag));
  assert.ok(printable.length>0,'expected at least one printable button in legacy.html');
  for(const tag of printable){
    assert.doesNotMatch(tag,/data-bh-no-telegram/i,'printable button explicitly excluded from Telegram');
    assert.ok(/data-print-document/i.test(tag)||/onclick\s*=\s*["'][^"']*print/i.test(tag)||/طباعة|اطبع/.test(tag),'print button is not discoverable by registry migration');
  }
  assert.match(telegram,/legacyPrintCandidate/);
  assert.match(telegram,/registerPrintDocument\(button/);
});

test('logos and images are absolute or embedded before PDF conversion',()=>{
  assert.match(telegram,/absoluteUrl/);
  assert.match(telegram,/absoluteCss/);
  assert.match(telegram,/inlineSnapshotImages/);
  assert.match(telegram,/blobToDataUrl/);
  assert.match(telegram,/image\.setAttribute\('src',await blobToDataUrl/);
  assert.match(reportRoute,/<base href=/);
});

test('Telegram sending has an independent capability',()=>{
  assert.match(permissions,/reports\.send_telegram/);
  assert.match(reportRoute,/requireCapability\(req,'reports\.send_telegram'\)/);
  assert.doesNotMatch(reportRoute,/requireCapability\(req,'daily_report\.view'\)/);
});

test('login synchronization is single-flight and never starts an automatic retry download',()=>{
  assert.match(loginSync,/syncPromise=null/);
  assert.match(loginSync,/if\(syncPromise\)return syncPromise/);
  assert.match(loginSync,/pullMeta\(\)/);
  assert.match(loginSync,/revisionBefore===remoteRevision/);
  assert.doesNotMatch(loginSync,/retryTimer/);
  assert.doesNotMatch(loginSync,/setTimeout\(function\(\)\{if\(userId\(\)&&!localClientCount/);
  assert.match(loginSync,/binhamid-cloud-state-pulled/);
});

test('revision conflicts never force-save without a merge and expose safe recovery',()=>{
  assert.doesNotMatch(stateApi,/saveArgs\(null\)/);
  assert.doesNotMatch(stateApi,/resolved by retry/);
  assert.match(stateApi,/REVISION_REQUIRED/);
  assert.match(stateApi,/REVISION_CONFLICT/);
  assert.match(syncGuard,/REVISION_CONFLICT_LOCKED/);
  assert.match(syncGuard,/if\(existing\)return syntheticConflict/);
  assert.match(syncGuard,/سحب النسخة الحديثة بأمان/);
  assert.match(syncGuard,/binhamid_conflict_backup_/);
});

test('delayed customer and employee table synchronization is visible',()=>{
  assert.match(stateApi,/masterSync/);
  assert.match(stateApi,/deferredChunks/);
  assert.match(stateApi,/status:deferredChunks\|\|failedChunks\?'delayed':'complete'/);
  assert.match(syncGuard,/binhamid-master-sync-status/);
  assert.match(syncGuard,/مزامنة جداول العملاء والموظفين متأخرة/);
  assert.match(index,/sync-integrity-guard\.js\?v=20260722-2/);
});
