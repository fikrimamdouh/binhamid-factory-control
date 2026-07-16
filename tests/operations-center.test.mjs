import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('operations center is injected into the application shell',async()=>{
  const index=await read('index.html');
  const ui=await read('assets/cloud-operations.js');
  assert.match(index,/cloud-operations\.js/);
  assert.match(ui,/مركز العمليات المباشر/);
  assert.match(ui,/\/api\/operations/);
  assert.match(ui,/bhOperationsNav/);
});

test('operations center provides KPI, filters, details and export',async()=>{
  const ui=await read('assets/cloud-operations.js');
  for(const marker of ['sales_open','purchase_open','purchase_urgent','tasks_open','quality_open','collections_total','bhOpsDepartment','bhOpsEntity','bhOpsStatus','exportCsv','details'])assert.match(ui,new RegExp(marker));
});

test('operations center does not create another Vercel function',async()=>{
  const router=await read('api/router.js');
  const config=JSON.parse(await read('vercel.json'));
  assert.match(router,/'operations':management\.operations/);
  assert.equal(config.rewrites.find(item=>item.source==='/api/operations')?.destination,'/api/router?route=operations');
});
