import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateMixCost, chooseEffectiveMixPrice, convertMixQuantity, priceBeforeVat } from '../api/_lib/mix-design-costing.js';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('mix unit conversion supports mass, bags and volume with explicit density',()=>{
  assert.equal(convertMixQuantity(2,'ton','kg',{}),2000);
  assert.equal(convertMixQuantity(10,'bag','kg',{bag_weight_kg:50}),500);
  assert.equal(convertMixQuantity(1000,'liter','m3',{}),1);
  close(convertMixQuantity(1,'m3','ton',{density:1600}),1.6);
  close(convertMixQuantity(800,'kg','m3',{density:1600}),0.5);
  assert.throws(()=>convertMixQuantity(1,'m3','kg',{}),error=>error?.code==='MIX_DENSITY_REQUIRED');
  assert.throws(()=>convertMixQuantity(1,'bag','kg',{}),error=>error?.code==='MIX_BAG_WEIGHT_REQUIRED');
});

test('VAT-inclusive material prices are converted to a pre-tax basis',()=>{
  close(priceBeforeVat({price:115,vat_included:true,vat_rate:15}),100);
  close(priceBeforeVat({price:100,vat_included:false,vat_rate:15}),100);
  assert.throws(()=>priceBeforeVat({price:-1}),error=>error?.code==='MIX_PRICE_INVALID');
});

test('effective material price requires exactly one approved active period',()=>{
  const rows=[{id:'a',approved:true,effective_from:'2026-01-01',effective_to:'2026-06-30'},{id:'b',approved:true,effective_from:'2026-07-01',effective_to:null}];
  assert.equal(chooseEffectiveMixPrice(rows,'2026-07-18').id,'b');
  assert.throws(()=>chooseEffectiveMixPrice([], '2026-07-18'),error=>error?.code==='MIX_PRICE_MISSING');
  assert.throws(()=>chooseEffectiveMixPrice([{...rows[1]},{...rows[1],id:'c'}],'2026-07-18'),error=>error?.code==='MIX_PRICE_OVERLAP');
});

test('mix calculation separates materials, wastage, operations and delivery',()=>{
  const result=calculateMixCost({
    design:{id:'mix-1',code:'C30',name:'C30',version_no:2,yield_m3:2},priceDate:'2026-07-18',targetMarginPercent:20,vatRate:15,
    items:[
      {material_id:'cement',quantity:700,unit:'kg',material:{code:'CEM',name_ar:'أسمنت'},price:{id:'p1',price:345,price_unit:'ton',vat_included:true,vat_rate:15,transport_cost:10,handling_cost:5,wastage_percent:2}},
      {material_id:'sand',quantity:1.4,unit:'m3',material:{code:'SAND',name_ar:'رمل',density:1600},price:{id:'p2',price:50,price_unit:'ton',vat_included:false,wastage_percent:1}},
      {material_id:'water',quantity:360,unit:'liter',material:{code:'WATER',name_ar:'مياه'},price:{id:'p3',price:4,price_unit:'m3',vat_included:false,wastage_percent:0}}
    ],
    overheads:[
      {cost_type:'production_labor',amount:12,allocation_basis:'per_m3'},
      {cost_type:'batching_energy',amount:5,allocation_basis:'per_batch'},
      {cost_type:'maintenance',amount:10,allocation_basis:'percentage_material_cost'},
      {cost_type:'delivery',amount:30,allocation_basis:'per_batch'}
    ]
  });
  assert.equal(result.yieldM3,2);
  assert.ok(result.materialCost>0);
  assert.ok(result.wastageCost>0);
  assert.ok(result.overheadCost>29);
  assert.equal(result.deliveryCost,30);
  close(result.recommendedPrice,result.totalCostPerM3/0.8);
  close(result.markupPercent,25);
  close(result.vatInclusivePrice,result.recommendedPrice*1.15);
  assert.equal(result.items.length,3);
  assert.equal(result.reliable,true);
});

test('yield and overhead bases are applied at batch level before dividing per cubic metre',()=>{
  const input={design:{yield_m3:2},priceDate:'2026-07-18',items:[{material_id:'x',quantity:2,unit:'ton',material:{name_ar:'مادة'},price:{price:100,price_unit:'ton',wastage_percent:0}}],overheads:[{cost_type:'production_labor',amount:10,allocation_basis:'per_m3'},{cost_type:'other',amount:20,allocation_basis:'fixed'}],targetMarginPercent:0};
  const result=calculateMixCost(input);
  assert.equal(result.materialCost,200);
  assert.equal(result.overheadCost,40);
  assert.equal(result.totalCostPerM3,120);
});

test('invalid or incomplete mix inputs fail closed',()=>{
  assert.throws(()=>calculateMixCost({design:{yield_m3:1},items:[]}),error=>error?.code==='MIX_ITEMS_REQUIRED');
  assert.throws(()=>calculateMixCost({design:{yield_m3:0},items:[{}]}),error=>error?.code==='MIX_YIELD_INVALID');
  assert.throws(()=>calculateMixCost({design:{yield_m3:1},items:[{quantity:1,unit:'kg',material:{},price:null}]}),error=>error?.code==='MIX_PRICE_MISSING');
  assert.throws(()=>calculateMixCost({design:{yield_m3:1},items:[{quantity:-1,unit:'kg',material:{},price:{price:1,price_unit:'kg'}}]}),error=>error?.code==='MIX_QUANTITY_INVALID');
  assert.throws(()=>calculateMixCost({design:{yield_m3:1},items:[{quantity:1,unit:'kg',material:{},price:{price:1,price_unit:'kg'}}],targetMarginPercent:100}),error=>error?.code==='MIX_MARGIN_INVALID');
});

test('mix schema prevents overlapping approved prices and editing approved designs',()=>{
  const migration=read('supabase/migrations/019_accounting_import_and_telegram_integrity.sql'),engine=read('api/_lib/mix-design-costing.js');
  assert.match(migration,/guard_mix_material_price_overlap/);
  assert.match(migration,/MIX_MATERIAL_PRICE_PERIOD_OVERLAP/);
  assert.match(migration,/guard_approved_mix_design_update/);
  assert.match(migration,/APPROVED_MIX_DESIGN_IMMUTABLE/);
  assert.match(migration,/snapshot jsonb not null/);
  assert.match(engine,/calculation_version:1/);
  assert.match(engine,/status:'superseded'/);
});
