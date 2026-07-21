// [BinHamid] 2026.07.21-sync-integrity-guard-v1
// يمنع أي إعادة حفظ قسرية بعد تعارض Revision، ويعرض حالة مزامنة الجداول الرئيسية.
(function(){
  'use strict';
  if(window.__BH_SYNC_INTEGRITY_GUARD__)return;
  window.__BH_SYNC_INTEGRITY_GUARD__=true;
  var VERSION='2026.07.21-sync-integrity-guard-v1';
  var CONFLICT_KEY='binhamid_cloud_conflict_lock_v1',MASTER_KEY='binhamid_master_sync_status_v1';
  var previousFetch=window.fetch.bind(window);

  function clean(value){return String(value??'').trim();}
  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(_){/**/}}
  function remove(key){try{localStorage.removeItem(key);}catch(_){/**/}}
  function isStatePut(input,options){var method=String(options&&options.method||'GET').toUpperCase(),url=typeof input==='string'?input:String(input&&input.url||'');return method==='PUT'&&/(?:^|\/)api\/state(?:\?|$)/.test(url);}
  function syntheticConflict(lock){return new Response(JSON.stringify({ok:false,error:'الحفظ متوقف: توجد نسخة سحابية أحدث. اسحب النسخة الحديثة قبل الحفظ.',code:'REVISION_CONFLICT_LOCKED',remoteRevision:Number(lock&&lock.remoteRevision||0)}),{status:409,headers:{'Content-Type':'application/json'}});}

  function statusNode(){var node=document.getElementById('bhSyncIntegrityStatus');if(node)return node;node=document.createElement('div');node.id='bhSyncIntegrityStatus';node.style.cssText='position:fixed;bottom:14px;right:14px;z-index:16000;max-width:min(460px,90vw);padding:11px 14px;border-radius:11px;box-shadow:0 5px 22px rgba(0,0,0,.25);font:700 12px/1.7 system-ui,sans-serif;display:none';document.body.appendChild(node);return node;}
  function show(message,kind,persistent){var node=statusNode();node.textContent=message;node.style.display='block';node.style.background=kind==='error'?'#8b2525':kind==='warn'?'#f4d58d':'#dff2e8';node.style.color=kind==='warn'?'#382b08':'#fff';if(kind==='ok')node.style.color='#124c32';clearTimeout(node._timer);if(!persistent)node._timer=setTimeout(function(){node.style.display='none';},kind==='warn'?12000:5000);}

  function lockConflict(data){var lock={at:new Date().toISOString(),remoteRevision:Number(data&&data.remoteRevision||0),code:clean(data&&data.code)||'REVISION_CONFLICT'};writeJson(CONFLICT_KEY,lock);show('تعارض نسخة: الحفظ السحابي متوقف لحماية التعديلات. اسحب النسخة الحديثة ثم أعد التعديل.','error',true);window.dispatchEvent(new CustomEvent('binhamid-cloud-conflict',{detail:lock}));return lock;}
  function showMasterSync(masterSync){if(!masterSync)return;writeJson(MASTER_KEY,{...masterSync,at:new Date().toISOString()});if(masterSync.status==='delayed'){var pending=Number(masterSync.deferredChunks||0)+Number(masterSync.failedChunks||0);show('تم حفظ الحالة الأساسية، لكن مزامنة جداول العملاء والموظفين متأخرة في '+pending+' دفعة. ستُستكمل في الحفظ التالي.','warn',false);}else{show('تم حفظ الحالة واكتملت مزامنة جداول العملاء والموظفين.','ok',false);}window.dispatchEvent(new CustomEvent('binhamid-master-sync-status',{detail:masterSync}));}

  window.fetch=async function(input,options){
    if(!isStatePut(input,options))return previousFetch(input,options);
    var existing=readJson(CONFLICT_KEY);if(existing)return syntheticConflict(existing);
    var response=await previousFetch(input,options);
    var data=await response.clone().json().catch(function(){return{};});
    if(response.status===409){lockConflict(data);return response;}
    if(response.ok){remove(CONFLICT_KEY);showMasterSync(data.masterSync);}
    return response;
  };

  window.addEventListener('binhamid-cloud-state-pulled',function(){remove(CONFLICT_KEY);var node=document.getElementById('bhSyncIntegrityStatus');if(node)node.style.display='none';});
  window.bhCloudConflictStatus=function(){return readJson(CONFLICT_KEY);};
  window.bhClearCloudConflictAfterPull=function(){remove(CONFLICT_KEY);};
  var existing=readJson(CONFLICT_KEY);if(existing)setTimeout(function(){show('تعارض نسخة سابق ما زال قائمًا. اسحب النسخة السحابية قبل أي حفظ.','error',true);},300);
  console.info('[BinHamid]',VERSION,'ready');
})();