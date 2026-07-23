import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('Excel validation does not report the same source rows from two parsers as file duplicates',async()=>{
  const source=await readFile(new URL('../assets/import-file-validation.js',import.meta.url),'utf8');
  const window={
    XLSX:{},
    BinHamidDailySummaryParser:{parseWorkbook:()=>({})},
    opsImportDailySummary(){},
    opsImportDailyMovement(){}
  };
  const timers=[];
  const context={window,crypto:{subtle:{}},console,setTimeout(){return 1;},setInterval(callback){timers.push(callback);return 1;},clearInterval(){}};
  vm.runInNewContext(source,context);
  timers[0]();
  const api=window.BinHamidImportFileValidation;
  const sale={sheet:'ورقة1',row:2,invoice:'18443',customerCode:'13187',customer:'عميل',item:'بلك',quantity:300,amount:840};
  const collection={sheet:'ورقة1',row:38,treasuryCode:'101',customerCode:'12520',customer:'عميل',receipt:'487',amount:2000,method:'نقدي'};
  const plan=api.composePlan({sales:[sale],collections:[collection],stock:[],warnings:[]},{sales:[{...sale,amount:840.0000}],collections:[{...collection}],warnings:[]});
  const quality=api.buildQuality(plan,{name:'daily.xlsx'},'hash');
  assert.equal(quality.accepted,2);
  assert.equal(quality.duplicate,0);
  assert.equal(quality.breakdown.sales.accepted,1);
  assert.equal(quality.breakdown.collections.accepted,1);
});
