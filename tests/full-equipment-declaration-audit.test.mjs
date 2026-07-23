import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

function rosterHarness(vehicles,operations={}){
  const source=read('assets/employee-declaration-sync.js').replace(
    /\}\)\(\);\s*$/,
    'window.__rosterTest={mergeCloudVehicles,reconciliationFresh,markReconciliation};})();'
  );
  const values=new Map();
  const context={
    D:{emp:[],veh:vehicles},
    OPS:operations,
    console:{info(){},warn(){},error(){}},
    document:{addEventListener(){}},
    localStorage:{
      getItem:key=>values.has(key)?values.get(key):null,
      setItem:(key,value)=>values.set(key,String(value))
    },
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    setTimeout(){return 1;},
    clearTimeout(){},
    Date,
    JSON,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    WeakSet
  };
  context.window=context;
  context.window.addEventListener=()=>{};
  context.window.dispatchEvent=()=>{};
  vm.runInNewContext(source,context);
  return{context,values};
}

test('canonical equipment projection collapses ERP aliases and clears a stale driver',()=>{
  const vehicles=[
    {id:'plate-BAB3223',plate:'BAB-3223',acct:'',type:'قديم',drv:'stale-driver'},
    {id:'erp-110400001',plate:'3223',acct:'110400001',type:'مضخة خرسانة',drv:'stale-driver'},
    {id:'plate-ONLY1',plate:'ONLY-1',acct:'',type:'قلاب',drv:''}
  ];
  const operations={fuel:[{vehicleId:'erp-110400001'}],maintenance:[{vehicle_external_id:'erp-110400001'}]};
  const{context}=rosterHarness(vehicles,operations);
  const result=context.__rosterTest.mergeCloudVehicles([
    {
      canonical_external_id:'plate-BAB3223',
      diesel_external_id:'plate-BAB3223',
      erp_external_id:'erp-110400001',
      asset_type:'vehicle',
      plate_no:'BAB-3223',
      asset_no:'110400001',
      asset_name:'مضخة خرسانة',
      employee_external_id:'',
      operational_status:'in_service',
      diesel_expected:true
    },
    {
      canonical_external_id:'plate-ONLY1',
      diesel_external_id:'plate-ONLY1',
      erp_external_id:null,
      asset_type:'vehicle',
      plate_no:'ONLY-1',
      asset_no:'',
      asset_name:'قلاب',
      employee_external_id:'',
      operational_status:'in_service',
      diesel_expected:true
    }
  ]);

  assert.equal(result.total,2);
  assert.equal(result.removed,1);
  const canonical=context.D.veh.find(row=>row.id==='plate-BAB3223');
  assert.ok(canonical);
  assert.equal(canonical.drv,'');
  assert.equal(canonical.acct,'110400001');
  assert.ok(canonical.vehicleAliases.includes('erp-110400001'));
  assert.equal(context.OPS.fuel[0].vehicleId,'plate-BAB3223');
  assert.equal(context.OPS.maintenance[0].vehicle_external_id,'plate-BAB3223');
});

test('canonical roster signals do not cause cross-tab reconciliation feedback',()=>{
  const bridge=read('assets/employee-declaration-sync.js');
  const management=read('api/_lib/routes/employee-management.js');
  assert.match(bridge,/source:'canonical-roster-sync'/);
  assert.match(bridge,/detail\.source==='canonical-roster-sync'/);
  assert.match(bridge,/ROLE_RECONCILE_TTL_MS=5\*60\*1000/);
  assert.match(bridge,/markReconciliation\(TELEGRAM_RECONCILE_KEY\)/);
  assert.match(bridge,/markReconciliation\(ROLE_RECONCILE_KEY\)/);
  assert.doesNotMatch(bridge,/function claimRoleReconciliation/);
  assert.match(management,/if\(result\.changed>0\|\|result\.missing>0\)await audit/);
});

test('declaration roles accept canonical role codes and use the direct issue workspace',()=>{
  const legacy=read('legacy.html');
  const index=read('index.html');
  const master=read('master-data.html');
  assert.match(legacy,/mechanic\|workshop\|maintenance/);
  assert.match(legacy,/block_sales\|concrete_sales/);
  assert.match(legacy,/window\.bh4DieselExpected=bh4DieselExpected/);
  assert.match(index,/target==='declarations'/);
  assert.match(index,/win\.go\('print'\)/);
  assert.match(master,/href="\/\?open=declarations">إصدار الإقرارات/);
});

test('blank employee vehicle ids cannot resolve to an unrelated canonical asset',()=>{
  const master=read('master-data.html');
  assert.match(master,/function assetById\(id\)\{const wanted=clean\(id\);if\(!wanted\)return null/);
  assert.match(master,/roleLabel=\{employee:'عامل \/ موظف'/);
});
