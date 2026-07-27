import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildFuelExtendedReport } from '../api/_lib/fuel-analytics.js';
import { channelKunya, displayName } from '../api/_lib/bot-profile.js';

const sample=[
  {transaction_date:'2026-07-01',plate_key:'ABC123',vehicle_name:'شاحنة 1',vehicle_external_id:'V1',driver_name:'سائق 1',station:'نور',fuel_type:'Diesel',receipt_no:'R1',liters:100,unit_price:1.8,amount:180,prev_odometer:1000,curr_odometer:1200},
  {transaction_date:'2026-07-02',plate_key:'ABC123',vehicle_name:'شاحنة 1',vehicle_external_id:'V1',driver_name:'سائق 1',station:'نور',fuel_type:'Diesel',receipt_no:'R1',liters:110,unit_price:1.82,amount:200.2,prev_odometer:1200,curr_odometer:1410},
  {transaction_date:'2026-07-04',plate_key:'XYZ999',vehicle_name:'شاحنة 2',vehicle_external_id:null,driver_name:'',station:'',fuel_type:'Diesel',receipt_no:'',liters:50,unit_price:3.2,amount:160,prev_odometer:0,curr_odometer:0}
];

test('extended fuel report matches site control concepts',()=>{
  const data=buildFuelExtendedReport(sample,{from:'2026-07-01',to:'2026-07-31',category:'diesel'});
  assert.equal(data.totals.fills,3);
  assert.equal(data.consecutiveRuns.length,1);
  assert.equal(data.consecutiveRuns[0].days,2);
  assert.equal(data.quality.duplicateReceipts.length,1);
  assert.equal(data.quality.missingReceipt,1);
  assert.equal(data.quality.unlinkedVehicle,1);
  assert.equal(data.prices.outliers.length,1);
  assert.ok(data.efficiency[0].avgFill>0);
  assert.ok(data.efficiency[0].kmPerLiter>0);
});

test('known Telegram accounts use kunya instead of account name',()=>{
  assert.equal(channelKunya('111','111'),'أبو مالك');
  assert.equal(channelKunya('6870312376','111'),'أبو فلاح');
  assert.equal(displayName({external_id:'6870312376',full_name:'مانع'},{}),'أبو فلاح');
});

test('Telegram diesel menu exposes the additional site-equivalent reports',()=>{
  const source=fs.readFileSync(new URL('../api/_lib/bot-fuel-reports.js',import.meta.url),'utf8');
  for(const label of ['كفاءة وتكلفة','تحليل سعر اللتر','أيام متتالية','اكتمال البيانات','التوزيع اليومي','ملفات الديزل'])assert.match(source,new RegExp(label));
});
