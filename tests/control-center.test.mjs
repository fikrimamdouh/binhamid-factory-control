import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateControlReadiness } from '../api/_lib/control-readiness.js';

const base=()=>({
  database:{ready:true,schemaVersion:'015'},
  runtime:{cloudConfigured:true,telegramConfigured:true},
  environment:{ready:true,missingRequired:[]},
  auditRows:[{id:'a1',created_at:new Date().toISOString()}],
  users:[{id:'u1',role:'admin',active:true},{id:'u2',role:'accountant',active:true}],
  snapshot:{
    day:'2026-07-17',todayBatch:{id:'b1'},existingAlerts:[],
    reconciliation:{difference:0},imports:{failed:[]},collections:{unallocated:0},
    debtors:{overLimit:[]},fuel:{duplicates:0,unassigned:0},
    cost:{unclassified:[]},maintenance:{critical:[]},sync:{staleHours:1},
    backup:{lastSuccessful:{id:'x'},ageHours:1},notifications:{failed:0}
  }
});

test('control readiness returns ready only when all hard controls pass',()=>{
  const result=evaluateControlReadiness(base());
  assert.equal(result.status,'ready');
  assert.equal(result.score,100);
  assert.equal(result.blockers.length,0);
  assert.equal(result.warnings.length,0);
});

test('control readiness blocks handover for financial, backup and governance failures',()=>{
  const input=base();
  input.snapshot.reconciliation.difference=125;
  input.snapshot.backup={lastSuccessful:null,ageHours:null};
  input.snapshot.debtors.overLimit=[{customerCode:'C1'}];
  input.auditRows=[];
  const result=evaluateControlReadiness(input),codes=new Set(result.blockers.map(row=>row.code));
  assert.equal(result.status,'blocked');
  for(const code of ['SALES_RECONCILIATION_DIFFERENCE','BACKUP_STALE','CREDIT_LIMIT_BREACHES','AUDIT_LOG_EMPTY'])assert.ok(codes.has(code),`missing ${code}`);
  assert.ok(result.score<100);
});

test('control readiness distinguishes operational warnings from blockers',()=>{
  const input=base();
  input.snapshot.todayBatch=null;
  input.snapshot.fuel.duplicates=2;
  input.snapshot.maintenance.critical=[{id:'m1'}];
  const result=evaluateControlReadiness(input),codes=new Set(result.warnings.map(row=>row.code));
  assert.equal(result.status,'conditional');
  for(const code of ['TODAY_REPORT_MISSING','FUEL_DUPLICATES','CRITICAL_MAINTENANCE'])assert.ok(codes.has(code),`missing ${code}`);
  assert.equal(result.blockers.length,0);
});

test('control center stays consolidated in the existing Vercel router',async()=>{
  const routerPath=['..','api','router.js'].join('/');
  const router=await readFile(new URL(routerPath,import.meta.url),'utf8');
  const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  const page=await readFile(new URL('../control-center.html',import.meta.url),'utf8');
  assert.match(router,/control-center/);
  assert.ok(vercel.rewrites.some(item=>item.source==='/api/control-center'&&item.destination.includes('route=control-center')));
  assert.equal(Object.keys(vercel.functions).length,1);
  for(const marker of ['مركز الرقابة والإدارة','/api/control-center','sessionStorage','طباعة'])assert.match(page,new RegExp(marker));
});
