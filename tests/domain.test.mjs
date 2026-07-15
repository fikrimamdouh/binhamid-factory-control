import test from 'node:test';
import assert from 'node:assert/strict';
import { inferDepartment, classifyFile, extractPlate, isFaultMessage, reportSummary, allowed, routeMessage } from '../api/_lib/domain.js';

test('infers factory departments from Arabic group names',()=>{
  assert.equal(inferDepartment('ورشة مصنع بن حامد'),'workshop');
  assert.equal(inferDepartment('المالية والرواتب'),'finance');
  assert.equal(inferDepartment('مبيعات وتحصيل البلوك'),'block');
  assert.equal(inferDepartment('الخرسانة الجاهزة'),'concrete');
});

test('classifies Excel reports using file and group context',()=>{
  assert.equal(classifyFile('تقرير الديزل.xlsx','workshop',[]),'fuel');
  assert.equal(classifyFile('الحركة اليومية.xlsx','block',[]),'block_daily_movement');
  assert.equal(classifyFile('مسير رواتب يوليو.xlsx','finance',[]),'payroll');
});

test('extracts Arabic and western plate digits',()=>{
  assert.match(extractPlate('عطل في السيارة رقم اللوحة 2345'),/2345/);
  assert.match(extractPlate('المركبة ٢٣٤٥ فيها تسريب'),/2345/);
});

test('detects workshop fault language',()=>{
  assert.equal(isFaultMessage('عندي تسريب زيت والعربية متوقفة'),true);
  assert.equal(isFaultMessage('صباح الخير'),false);
});

test('enforces report and approval roles',()=>{
  assert.equal(allowed('manager','report'),true);
  assert.equal(allowed('manager','approve'),true);
  assert.equal(allowed('mechanic','approve'),false);
});

test('routes natural messages to Arabic factory destinations',()=>{
  assert.equal(routeMessage('عبينا 120 لتر ديزل للسيارة 2345','workshop','mechanic').intent,'fuel');
  assert.equal(routeMessage('استلمنا من عميل البلوك 5000 ريال','block','collector').department,'block');
  assert.equal(routeMessage('مسير رواتب شهر يوليو','finance','accountant').intent,'payroll');
  assert.equal(routeMessage('العربية 2345 فيها تسريب زيت','workshop','mechanic').intent,'maintenance');
});

test('builds manager summary from synchronized state',()=>{
  const today=new Date().toISOString().slice(0,10);
  const result=reportSummary({legacy:{emp:[{}],veh:[{},{}],cli:[{}]},ops:{deliveries:[{date:today,total:100}],collections:[{date:today,amount:40}],fuel:[{date:today,liters:20,totalCost:50}],maintenance:[{status:'open',problem:'متوقف'}]}});
  assert.equal(result.salesToday,100);
  assert.equal(result.collectionsToday,40);
  assert.equal(result.fuelLitersToday,20);
  assert.equal(result.openMaintenance,1);
  assert.equal(result.stoppedVehicles,1);
});
