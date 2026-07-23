// [BinHamid] 2026.07.21-login-sync-v7-revision-first
// الفتح العادي يفحص رقم النسخة فقط. لا تُسحب الحالة الكاملة ولا تُعاد الصفحة
// إلا إذا كانت النسخة السحابية أحدث فعلًا أو كان الجهاز الحالي بلا بيانات.
(function(){
  'use strict';
  var VERSION='2026.07.21-login-sync-v7-revision-first';
  var USER_KEY='binhamid_cloud_app_user_id',REV_KEY='binhamid_cloud_revision',LEGACY_KEY='binhamid_v1',OPS_KEY='binhamid_factory_control_v3',DONE_KEY='bh_login_sync_done_v2',CONFLICT_KEY='binhamid_cloud_conflict_lock_v1';
  var originalFetch=window.fetch.bind(window),syncPromise=null,balancesPromise=null;

  function userId(){try{return String(localStorage.getItem(USER_KEY)||'').trim();}catch(_){return'';}}
  function localRevision(){try{return Number(localStorage.getItem(REV_KEY)||0);}catch(_){return 0;}}
  function notify(text,isError){try{if(typeof window.toast==='function')return window.toast(text,isError?true:undefined);if(typeof window.opsToast==='function')return window.opsToast(text,isError?'err':undefined);}catch(_){/**/}console.info('[BinHamid login-sync]',text);}
  function banner(text){var id='bhLoginSyncBanner',node=document.getElementById(id);if(!text){if(node)node.remove();return;}if(!node){node=document.createElement('div');node.id=id;node.className='noprint no-print';node.dataset.bhRuntimeNotice='login-sync';node.style.cssText='position:fixed;top:0;left:0;right:0;z-index:15000;padding:10px 14px;text-align:center;font:600 13px system-ui,sans-serif;color:#08202c;background:linear-gradient(90deg,#e9c46a,#f4d58d);box-shadow:0 2px 12px rgba(0,0,0,.2)';document.body.appendChild(node);}node.textContent=text;}
  async function api(path,options){var headers={'Content-Type':'application/json'},uid=userId();if(uid)headers['x-app-user-id']=uid;var response=await originalFetch(path,Object.assign({credentials:'same-origin',headers:headers},options||{})),data=await response.json().catch(function(){return{};});if(!response.ok){var error=new Error(data.error||('HTTP '+response.status));error.status=response.status;error.code=data.code||'';throw error;}return data;}

  async function pullMeta(){return api('/api/state?meta=1');}
  async function pullFromServer(){
    var result=await api('/api/state?full=1');if(!result||!result.payload)return{empty:true,revision:Number(result&&result.revision||0),counts:{clients:0,opening:0}};var counts={clients:0,opening:0};
    try{
      if(result.payload.legacy){localStorage.setItem(LEGACY_KEY,JSON.stringify(result.payload.legacy));counts.clients=(result.payload.legacy.cli||[]).length;}
      if(result.payload.ops){var incomingOps=result.payload.ops;try{var localRaw=localStorage.getItem(OPS_KEY);if(localRaw){var localOps=JSON.parse(localRaw),localOpening=localOps&&Array.isArray(localOps.customerOpeningBalances)?localOps.customerOpeningBalances:[],incomingOpening=Array.isArray(incomingOps.customerOpeningBalances)?incomingOps.customerOpeningBalances:[];if(localOpening.length&&!incomingOpening.length)incomingOps.customerOpeningBalances=localOpening;}}catch(_){/**/}localStorage.setItem(OPS_KEY,JSON.stringify(incomingOps));counts.opening=(incomingOps.customerOpeningBalances||[]).length;}
      localStorage.setItem(REV_KEY,String(result.revision||0));localStorage.removeItem('binhamid_cloud_pending');localStorage.removeItem(CONFLICT_KEY);
      window.dispatchEvent(new CustomEvent('binhamid-cloud-state-pulled',{detail:{revision:Number(result.revision||0),clients:counts.clients}}));
    }catch(error){if(String(error&&error.name)==='QuotaExceededError'){try{localStorage.removeItem('binhamid_cloud_pending');}catch(_){/**/}throw new Error('مساحة المتصفح ممتلئة. امسح بيانات الموقع من إعدادات المتصفح ثم أعد الدخول.');}throw error;}
    return{revision:Number(result.revision||0),counts:counts};
  }

  async function pullOpeningBalances(){var result=await api('/api/router?route=opening-balances'),rows=result&&Array.isArray(result.rows)?result.rows:[];if(!rows.length)return 0;var mapped=rows.map(function(row){return{id:'opb-'+String(row.customer_code),clientId:row.client_id||'',customerCode:String(row.customer_code||''),customerName:String(row.customer_name||''),date:row.balance_date||'',amount:Number(row.balance)||0,previous:Number(row.previous)||0,debit:Number(row.debit)||0,credit:Number(row.credit)||0,cheques:Number(row.cheques)||0,difference:Number(row.difference)||0,sourceFile:row.source_file||''};}),raw=localStorage.getItem(OPS_KEY),ops=raw?JSON.parse(raw):{};ops.customerOpeningBalances=mapped;localStorage.setItem(OPS_KEY,JSON.stringify(ops));return mapped.length;}
  function localBalanceCount(){try{var raw=localStorage.getItem(OPS_KEY);if(!raw)return 0;var ops=JSON.parse(raw);return Array.isArray(ops&&ops.customerOpeningBalances)?ops.customerOpeningBalances.length:0;}catch(_){return 0;}}
  function localClientCount(){try{var raw=localStorage.getItem(LEGACY_KEY);if(!raw)return 0;var parsed=JSON.parse(raw);return Array.isArray(parsed&&parsed.cli)?parsed.cli.length:0;}catch(_){return 0;}}
  function ensureBalances(){
    if(!userId()||localBalanceCount())return Promise.resolve(localBalanceCount());if(balancesPromise)return balancesPromise;
    balancesPromise=(async function(){try{var count=await pullOpeningBalances();if(count){notify('تم تحميل '+count+' رصيد افتتاحي من السيرفر.');if(typeof window.rAll==='function'){try{window.rAll();}catch(_){/**/}}}return count;}catch(error){console.warn('[login-sync] balances',error&&error.message);notify('تعذر تحميل الأرصدة: '+(error.message||''),true);return 0;}finally{balancesPromise=null;}})();return balancesPromise;
  }
  window.bhLoadBalances=ensureBalances;

  async function performLoginSync(force){
    if(!userId())return{skipped:true};
    if(!force&&sessionStorage.getItem(DONE_KEY)==='1'){await ensureBalances();return{unchanged:true,revision:localRevision()};}
    var clientsBefore=localClientCount(),revisionBefore=localRevision(),meta=await pullMeta(),remoteRevision=Number(meta&&meta.revision||0);
    if(!meta||meta.hasState===false||remoteRevision===0){sessionStorage.setItem(DONE_KEY,'1');await ensureBalances();return{empty:true,revision:0};}
    if(clientsBefore>0&&revisionBefore===remoteRevision){sessionStorage.setItem(DONE_KEY,'1');await ensureBalances();console.info('[BinHamid login-sync] revision unchanged',remoteRevision);return{unchanged:true,revision:remoteRevision};}
    banner(clientsBefore?'توجد نسخة سحابية أحدث — جارٍ تحديث البيانات...':'جارٍ تحميل بيانات النظام لأول مرة...');
    try{
      var outcome=await pullFromServer();if(outcome.empty){banner('');sessionStorage.setItem(DONE_KEY,'1');notify('لا توجد نسخة سحابية بعد — سيُرفع محتوى هذا الجهاز عند أول حفظ.');return outcome;}
      var balanceCount=localBalanceCount();if(!balanceCount)try{balanceCount=await pullOpeningBalances();}catch(balanceError){console.warn('[login-sync] opening balances',balanceError&&balanceError.message);}
      sessionStorage.setItem(DONE_KEY,'1');banner('');notify('تمت المزامنة: '+outcome.counts.clients+' عميل و'+balanceCount+' رصيد افتتاحي (نسخة '+outcome.revision+')');
      if(clientsBefore===0||revisionBefore!==Number(outcome.revision||0)){notify('جارٍ تطبيق النسخة المحدَّثة مرة واحدة...');setTimeout(function(){location.reload();},450);return outcome;}
      if(typeof window.rAll==='function'){try{window.rAll();}catch(_){/**/}}
      return outcome;
    }catch(error){banner('');sessionStorage.removeItem(DONE_KEY);notify('تعذر التحميل من السيرفر: '+(error.message||'خطأ غير معروف'),true);throw error;}
  }
  function runLoginSync(force){if(syncPromise)return syncPromise;syncPromise=performLoginSync(Boolean(force)).finally(function(){syncPromise=null;});return syncPromise;}
  window.bhLoginSync=function(){sessionStorage.removeItem(DONE_KEY);return runLoginSync(true);};

  window.addEventListener('binhamid-owner-authenticated',function(){setTimeout(function(){runLoginSync(true).catch(function(){});},250);});
  function start(){if(!userId())return;runLoginSync(false).catch(function(){});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  console.info('[BinHamid]',VERSION,'ready');
})();