// [BinHamid] 2026.07.22-sync-integrity-guard-v2-actionable-conflict
(function(){
  'use strict';
  if(window.__BH_SYNC_INTEGRITY_GUARD__)return;
  window.__BH_SYNC_INTEGRITY_GUARD__=true;
  var VERSION='2026.07.22-sync-integrity-guard-v2-actionable-conflict';
  var CONFLICT_KEY='binhamid_cloud_conflict_lock_v1',MASTER_KEY='binhamid_master_sync_status_v1',REVISION_KEY='binhamid_cloud_revision';
  var previousFetch=window.fetch.bind(window),pullBusy=false;

  function clean(value){return String(value??'').trim();}
  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(_){}}
  function remove(key){try{localStorage.removeItem(key);}catch(_){}}
  function isStatePut(input,options){var method=String(options&&options.method||'GET').toUpperCase(),url=typeof input==='string'?input:String(input&&input.url||'');return method==='PUT'&&/(?:^|\/)api\/state(?:\?|$)/.test(url);}
  function syntheticConflict(lock){return new Response(JSON.stringify({ok:false,error:'الحفظ متوقف: توجد نسخة سحابية أحدث. اسحب النسخة الحديثة قبل الحفظ.',code:'REVISION_CONFLICT_LOCKED',remoteRevision:Number(lock&&lock.remoteRevision||0)}),{status:409,headers:{'Content-Type':'application/json'}});}
  function requestHeaders(){var token=clean(localStorage.getItem('binhamid_cloud_access_token')),userId=clean(localStorage.getItem('binhamid_cloud_app_user_id')),headers={'Content-Type':'application/json'};if(token&&token!=='device-session')headers.Authorization='Bearer '+token;if(userId)headers['X-App-User-Id']=userId;return headers;}

  function statusNode(){var node=document.getElementById('bhSyncIntegrityStatus');if(node)return node;node=document.createElement('div');node.id='bhSyncIntegrityStatus';node.style.cssText='position:fixed;bottom:14px;right:14px;z-index:16000;max-width:min(560px,92vw);padding:13px 15px;border-radius:12px;box-shadow:0 7px 28px rgba(0,0,0,.28);font:700 12px/1.7 system-ui,sans-serif;display:none';document.body.appendChild(node);return node;}
  function hide(){var node=document.getElementById('bhSyncIntegrityStatus');if(node)node.style.display='none';}
  function show(message,kind,persistent){var node=statusNode();node.innerHTML='';var text=document.createElement('div');text.textContent=message;node.appendChild(text);node.style.display='block';node.style.background=kind==='error'?'#8b2525':kind==='warn'?'#f4d58d':'#dff2e8';node.style.color=kind==='warn'?'#382b08':kind==='ok'?'#124c32':'#fff';clearTimeout(node._timer);if(!persistent)node._timer=setTimeout(hide,kind==='warn'?12000:5000);return node;}
  function localBackup(){var stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup={createdAt:new Date().toISOString(),reason:'revision-conflict-before-cloud-pull',revision:Number(localStorage.getItem(REVISION_KEY)||0),legacy:readJson('binhamid_v1'),ops:readJson('binhamid_factory_control_v3')},key='binhamid_conflict_backup_'+stamp;writeJson(key,backup);try{var blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='binhamid-conflict-backup-'+stamp+'.json';link.click();setTimeout(function(){URL.revokeObjectURL(link.href);},1000);}catch(_){}return key;}
  async function safePullLatest(){
    if(pullBusy)return;
    if(!confirm('سيتم حفظ نسخة احتياطية محلية أولًا، ثم استبدال بيانات هذا الجهاز بالنسخة السحابية الأحدث. هل تريد المتابعة؟'))return;
    pullBusy=true;var node=statusNode();
    try{
      var backupKey=localBackup();show('تم حفظ نسخة احتياطية محلية. جارٍ سحب النسخة السحابية الأحدث…','warn',true);
      var response=await previousFetch('/api/state',{method:'GET',credentials:'same-origin',cache:'no-store',headers:requestHeaders()}),data=await response.json().catch(function(){return{};});
      if(!response.ok)throw new Error(data.error||data.message||('HTTP '+response.status));
      if(!data.payload)throw new Error('لا توجد نسخة سحابية صالحة للاستعادة.');
      if(data.payload.legacy)localStorage.setItem('binhamid_v1',JSON.stringify(data.payload.legacy));
      if(data.payload.ops)localStorage.setItem('binhamid_factory_control_v3',JSON.stringify(data.payload.ops));
      localStorage.setItem(REVISION_KEY,String(Number(data.revision)||0));
      remove('binhamid_cloud_pending');remove(CONFLICT_KEY);
      window.dispatchEvent(new CustomEvent('binhamid-cloud-state-pulled',{detail:{revision:Number(data.revision)||0,backupKey:backupKey}}));
      show('تم سحب النسخة الحديثة بنجاح. ستُعاد الصفحة الآن، ثم أعد التعديل المطلوب.','ok',true);
      setTimeout(function(){location.reload();},300);
    }catch(error){show('تعذر سحب النسخة الحديثة: '+String(error&&error.message||error),'error',true);renderConflict(readJson(CONFLICT_KEY)||{});}
    finally{pullBusy=false;}
  }
  function renderConflict(lock){
    var node=show('توجد نسخة سحابية أحدث. الحفظ متوقف لحماية بياناتك. لا تضغط «مزامنة الآن». استخدم السحب الآمن ثم أعد التعديل.','error',true),actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
    var pull=document.createElement('button');pull.type='button';pull.textContent='سحب النسخة الحديثة بأمان';pull.style.cssText='border:0;border-radius:9px;padding:9px 12px;background:#fff;color:#7b1f1f;font-weight:800;cursor:pointer';pull.onclick=safePullLatest;
    var details=document.createElement('span');details.textContent=Number(lock&&lock.remoteRevision||0)?'Revision السحابي: '+Number(lock.remoteRevision):'';details.style.cssText='align-self:center;font-size:11px;opacity:.85';
    actions.append(pull,details);node.appendChild(actions);
  }
  function lockConflict(data){var lock={at:new Date().toISOString(),remoteRevision:Number(data&&data.remoteRevision||0),code:clean(data&&data.code)||'REVISION_CONFLICT'};writeJson(CONFLICT_KEY,lock);renderConflict(lock);window.dispatchEvent(new CustomEvent('binhamid-cloud-conflict',{detail:lock}));return lock;}
  function showMasterSync(masterSync){if(!masterSync)return;writeJson(MASTER_KEY,{...masterSync,at:new Date().toISOString()});if(masterSync.status==='delayed'){var pending=Number(masterSync.deferredChunks||0)+Number(masterSync.failedChunks||0);show('تم حفظ الحالة الأساسية، لكن مزامنة جداول العملاء والموظفين متأخرة في '+pending+' دفعة. ستُستكمل في الحفظ التالي.','warn',false);}else{show('تم حفظ الحالة واكتملت مزامنة الجداول الرئيسية.','ok',false);}window.dispatchEvent(new CustomEvent('binhamid-master-sync-status',{detail:masterSync}));}

  window.fetch=async function(input,options){if(!isStatePut(input,options))return previousFetch(input,options);var existing=readJson(CONFLICT_KEY);if(existing)return syntheticConflict(existing);var response=await previousFetch(input,options),data=await response.clone().json().catch(function(){return{};});if(response.status===409){lockConflict(data);return response;}if(response.ok){remove(CONFLICT_KEY);showMasterSync(data.masterSync);}return response;};
  window.addEventListener('binhamid-cloud-state-pulled',function(){remove(CONFLICT_KEY);hide();});
  window.bhCloudConflictStatus=function(){return readJson(CONFLICT_KEY);};
  window.bhClearCloudConflictAfterPull=function(){remove(CONFLICT_KEY);hide();};
  window.bhPullLatestCloudStateSafely=safePullLatest;
  var existing=readJson(CONFLICT_KEY);if(existing)setTimeout(function(){renderConflict(existing);},300);
  console.info('[BinHamid]',VERSION,'ready');
})();