import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('ERP daily watchdog checks the committed report and alerts on the agreed schedule',async()=>{
  const[workflow,statusRoute,router]=await Promise.all([
    read('.github/workflows/erp-daily-report-watchdog.yml'),
    read('api/_lib/routes/erp-daily-report-status.js'),
    read('api/router.js')
  ]);
  assert.match(workflow,/binhamid-erp-daily-report-watchdog/);
  assert.match(workflow,/cron: '20 5 \* \* \*'/);
  assert.match(workflow,/cron: '0 7 \* \* \*'/);
  assert.match(workflow,/TELEGRAM_OWNER_ID/);
  assert.match(statusRoute,/daily_report_batches/);
  assert.match(statusRoute,/report_date=eq\./);
  assert.match(statusRoute,/WORKFLOW_PATH/);
  assert.match(router,/'erp-daily-report\/status':erpDailyReportStatus\.erpDailyReportStatus/);
});
