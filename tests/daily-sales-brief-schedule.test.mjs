import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('daily sales brief is scheduled twice, secured by GitHub OIDC, and routed centrally',async()=>{
  const[workflow,runner,route,router]=await Promise.all([
    read('.github/workflows/daily-sales-brief.yml'),
    read('scripts/send-daily-sales-brief.mjs'),
    read('api/_lib/routes/daily-sales-brief.js'),
    read('api/router.js')
  ]);
  assert.match(workflow,/cron: '0 5 \* \* \*'/);
  assert.match(workflow,/cron: '0 15 \* \* \*'/);
  assert.match(workflow,/id-token: write/);
  assert.match(runner,/binhamid-daily-sales-brief/);
  assert.match(route,/token\.actions\.githubusercontent\.com/);
  assert.match(route,/telegram_sales_brief_sent/);
  assert.match(route,/role=in\.\(admin,manager\)/);
  assert.match(route,/config\.telegramOwnerId/);
  assert.match(route,/slot==='morning'/);
  assert.match(router,/'daily-sales-brief\/send':dailySalesBrief\.sendDailySalesBrief/);
});
