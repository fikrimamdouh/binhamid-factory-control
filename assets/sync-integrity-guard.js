// [BinHamid] 2026.07.23-sync-integrity-guard-v6-automatic-cloud-recovery
(function(){
  'use strict';
  if(window.__BH_SYNC_INTEGRITY_GUARD__)return;
  window.__BH_SYNC_INTEGRITY_GUARD__=true;
  var VERSION='2026.07.23-sync-integrity-guard-v6-automatic-cloud-recovery';
  var CONFLICT_KEY='binhamid_cloud_conflict_lock_v1',MASTER_KEY='binhamid_master_sync_status_v1',REVISION_KEY='binhamid_cloud_revision';
  var previousFetch=window.fetch.bind(window),pullBusy=false,recoveryTimer=null,recoveryAttempts=0;

  function clean(value){return String(value??'').trim();}
  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(_){return null;}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_){return false;}}
  function remove(key){try{localStorage.removeItem(key);}catch(_){}}
  function authenticated(){return Boolean(clean(localStorage.getItem('binhamid_cloud_app_user_id'))||clean(localStorage.getItem('binhamid_cloud_access_token')));}
  function isStatePut(input,options){var method=String(options&&options.method||'GET').toUpperCase(),url=typeof input==='string'?input:String(input&&input.url||'');return method==='PUT'&&/(?:^|\/)api\/state(?:\?|$)/.test(url);}
  function syntheticConflict(lock){return new Response(JSON.stringify({ok:false,error:'جارٍ تطبيق النسخة السحابية الأحدث تلقائيًا قبل استئناف الحفظ.',code:'REVISION_CONFLICT_LOCKED',remoteRevision:Number(lock&&lock.remoteRevision||0)}),{status:409,headers:{'Content-Type':'application/json'}});}
  function requestHeaders(){var token=clean(localStorage.getItem('binhamid_cloud_access_token')),userId=clean(localStorage.getItem('binhamid_cloud_app_user_id')),headers={'Content-Type':'application/json'};if(token&&token!=='device-session')headers.Authorization='Bearer '+token;if(userId)headers['X-App-User-Id']=userId;return headers;}

  function installPrintIsolation(){
    if(document.getElementById('bhRuntimeNoticePrintIsolation'))return;
    var style=document.createElement('style');style.id='bhRuntimeNoticePrintIsolation';style.textContent='@media print{#bhSyncIntegrityStatus,#bhLoginSyncBanner,[data-bh-runtime-notice]{display:none!important;visibility:hidden!important;opacity:0!important}}';(document.head||document.documentElement).appendChild(style);
  }
  function statusNode(){var node=document.getElementById('bhSyncIntegrityStatus');if(node)return node;node=document.createElement('div');node.id='bhSyncIntegrityStatus';node.className='noprint no-print';node.dataset.bhRuntimeNotice='cloud-conflict';node.style.cssText='position:fixed;bottom:14px;right:14px;z-index:16000;max-width:min(560px,92vw);padding:13px 15px;border-radius:12px;box-shadow:0 7px 28px rgba(0,0,0,.28);font:700 12px/1.7 system-ui,sans-serif;display:none';document.body.appendChild(node);return node;}
  function hide(){var node=document.getElementById('bhSyncIntegrityStatus');if(node)node.style.setProperty('display','none','important');}
  function show(message,kind,persistent){var node=statusNode();node.style.removeProperty('display');node.innerHTML='';var text=document.createElement('div');text.textContent=message;node.appendChild(text);node.style.display='block';node.style.background=kind==='error'?'#8b2525':kind==='warn'?'#f4d58d':'#dff2e8';node.style.color=kind==='warn'?'#382b08':kind==='ok'?'#124c32':'#fff';clearTimeout(node._timer);if(!persistent)node._timer=setTimeout(hide,kind==='warn'?7000:4000);return node;}

  function backupPayload(){return{id:'latest-cloud-conflict',createdAt:new Date().toISOString(),reason:'revision-conflict-before-automatic-cloud-pull',revision:Number(localStorage.getItem(REVISION_KEY)||0),legacy:readJson('binhamid_v1'),ops:readJson('binhamid_factory_control_v3'),pending:readJson('binhamid_cloud_pending')};}
  function preserveRecoveryBackup(){
    return new Promise(function(resolve){
      if(!window.indexedDB)return resolve(false);
      try{
        var request=indexedDB.open('binhamid_recovery_v1',1);
        request.onupgradeneeded=function(){var db=request.result;if(!db.objectStoreNames.contains('backups'))db.createObjectStore('backups',{keyPath:'id'});};
        request.onerror=function(){resolve(false);};
        request.onsuccess=function(){try{var db=request.result,tx=db.transaction('backups','readwrite');tx.objectStore('backups').put(backupPayload());tx.oncomplete=function(){db.close();resolve(true);};tx.onerror=function(){db.close();resolve(false);};}catch(_){resolve(false);}};
      }catch(_){resolve(false);}
    });
  }
  function downloadBackup(){var stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup=backupPayload(),filename='binhamid-conflict-backup-'+stamp+'.json';try{var blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;link.click();setTimeout(function(){URL.revokeObjectURL(link.href);},1000);}catch(_){}return filename;}
  function cleanProgramLocalState(){
    var preserveKeys=['binhamid_cloud_access_token','binhamid_cloud_device_id','binhamid_cloud_app_user_id'],preserved={};
    preserveKeys.forEach(function(key){var value=localStorage.getItem(key);if(value!==null)preserved[key]=value;});
    var keys=[];for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i);if(key&&(/^binhamid_/i.test(key)||/^bh_/i.test(key)))keys.push(key);}
    keys.forEach(function(key){if(!preserveKeys.includes(key))remove(key);});
    Object.keys(preserved).forEach(function(key){try{localStorage.setItem(key,preserved[key]);}catch(_){}});
  }
  function writePulledState(data){
    cleanProgramLocalState();
    if(data.payload.legacy)try{localStorage.setItem('binhamid_v1',JSON.stringify(data.payload.legacy));}catch(error){throw new Error('تعذر حفظ بيانات البرنامج الأساسية بعد تنظيف التخزين المحلي: '+String(error&&error.message||error));}
    if(data.payload.ops)try{localStorage.setItem('binhamid_factory_control_v3',JSON.stringify(data.payload.ops));}catch(error){remove('binhamid_v1');throw new Error('تعذر حفظ بيانات التشغيل بعد تنظيف التخزين المحلي: '+String(error&&error.message||error));}
    localStorage.setItem(REVISION_KEY,String(Number(data.revision)||0));
    remove('binhamid_cloud_pending');remove(CONFLICT_KEY);remove(MASTER_KEY);try{sessionStorage.removeItem('bh_login_sync_done_v2');}catch(_){}
    try{sessionStorage.setItem('bh_restore_try','1');sessionStorage.setItem('binhamid_cloud_pull_applied_once','1');}catch(_){}
  }
  async function safePullLatest(options){
    var manual=Boolean(options&&options.manual);
    if(pullBusy)return;
    if(!authenticated())return renderConflict(readJson(CONFLICT_KEY)||{},'يلزم تأكيد جلسة الدخول لإكمال الاستعادة التلقائية.');
    if(manual&&!confirm('سيتم حفظ نسخة استرداد ثم استبدال بيانات البرنامج المحلية بالنسخة السحابية الأحدث. هل تريد المتابعة؟'))return;
    pullBusy=true;
    try{
      await preserveRecoveryBackup();
      var backupFile=manual?downloadBackup():'';
      show('جارٍ تطبيق النسخة السحابية الأحدث وتنظيف الحالة المحلية القديمة…','warn',true);
      var response=await previousFetch('/api/state?full=1',{method:'GET',credentials:'same-origin',cache:'no-store',headers:requestHeaders()}),data=await response.json().catch(function(){return{};});
      if(!response.ok)throw Object.assign(new Error(data.error||data.message||('HTTP '+response.status)),{status:response.status});
      if(!data.payload)throw new Error('لا توجد نسخة سحابية صالحة للاستعادة.');
      writePulledState(data);recoveryAttempts=0;
      window.dispatchEvent(new CustomEvent('binhamid-cloud-state-pulled',{detail:{revision:Number(data.revision)||0,backupFile:backupFile||null,recoveryDatabase:'binhamid_recovery_v1',localReplaced:true,automatic:!manual}}));
      show('تم تطبيق النسخة السحابية واستؤنف الحفظ.','ok',false);
      setTimeout(function(){location.reload();},250);
    }catch(error){
      renderConflict(readJson(CONFLICT_KEY)||{},'تعذر تطبيق النسخة السحابية تلقائيًا: '+String(error&&error.message||error));
    }finally{pullBusy=false;}
  }
  function renderConflict(lock,message){
    var node=show(message||'تعذر التعافي التلقائي من تعارض النسخة. أعد المحاولة بعد التأكد من الاتصال.','error',true),actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
    var pull=document.createElement('button');pull.type='button';pull.textContent='إعادة الاستعادة السحابية';pull.className='noprint no-print';pull.style.cssText='border:0;border-radius:9px;padding:9px 12px;background:#fff;color:#7b1f1f;font-weight:800;cursor:pointer';pull.onclick=function(){safePullLatest({manual:true});};
    var details=document.createElement('span');details.textContent=Number(lock&&lock.remoteRevision||0)?'Revision السحابي: '+Number(lock.remoteRevision):'';details.style.cssText='align-self:center;font-size:11px;opacity:.85';
    actions.append(pull,details);node.appendChild(actions);return node;
  }
  function scheduleAutomaticRecovery(){
    clearTimeout(recoveryTimer);
    recoveryTimer=setTimeout(function(){
      if(!readJson(CONFLICT_KEY))return;
      if(!authenticated()){
        if(recoveryAttempts++<20)return scheduleAutomaticRecovery();
        return renderConflict(readJson(CONFLICT_KEY)||{},'تعذر تأكيد جلسة الدخول تلقائيًا. سجّل الدخول لإكمال الاستعادة.');
      }
      safePullLatest({automatic:true});
    },recoveryAttempts?600:80);
  }
  function lockConflict(data){var lock={at:new Date().toISOString(),remoteRevision:Number(data&&data.remoteRevision||0),code:clean(data&&data.code)||'REVISION_CONFLICT'};writeJson(CONFLICT_KEY,lock);show('تم اكتشاف نسخة سحابية أحدث — جارٍ تطبيقها تلقائيًا…','warn',true);scheduleAutomaticRecovery();window.dispatchEvent(new CustomEvent('binhamid-cloud-conflict',{detail:lock}));return lock;}
  function showMasterSync(masterSync){if(!masterSync)return;writeJson(MASTER_KEY,{...masterSync,at:new Date().toISOString()});if(masterSync.status==='delayed'){var pending=Number(masterSync.deferredChunks||0)+Number(masterSync.failedChunks||0);show('تم حفظ الحالة الأساسية، لكن مزامنة جداول العملاء والموظفين متأخرة في '+pending+' دفعة. ستُستكمل في الحفظ التالي.','warn',false);}else{show('تم حفظ الحالة واكتملت مزامنة الجداول الرئيسية.','ok',false);}window.dispatchEvent(new CustomEvent('binhamid-master-sync-status',{detail:masterSync}));}

  window.fetch=async function(input,options){if(!isStatePut(input,options))return previousFetch(input,options);var existing=readJson(CONFLICT_KEY);if(existing){scheduleAutomaticRecovery();return syntheticConflict(existing);}var response=await previousFetch(input,options),data=await response.clone().json().catch(function(){return{};});if(response.status===409){lockConflict(data);return response;}if(response.ok){remove(CONFLICT_KEY);showMasterSync(data.masterSync);}return response;};
  window.addEventListener('beforeprint',hide);
  window.addEventListener('binhamid-owner-authenticated',function(){if(readJson(CONFLICT_KEY))scheduleAutomaticRecovery();});
  window.addEventListener('binhamid-cloud-state-pulled',function(){remove(CONFLICT_KEY);hide();});
  window.bhCloudConflictStatus=function(){return readJson(CONFLICT_KEY);};
  window.bhLockCloudConflict=lockConflict;
  window.bhClearCloudConflictAfterPull=function(){remove(CONFLICT_KEY);hide();};
  window.bhPullLatestCloudStateSafely=function(){return safePullLatest({manual:true});};
  window.bhResolveCloudConflictAutomatically=scheduleAutomaticRecovery;
  installPrintIsolation();
  var existing=readJson(CONFLICT_KEY);if(existing){show('جارٍ تطبيق النسخة السحابية الأحدث تلقائيًا…','warn',true);scheduleAutomaticRecovery();}
  console.info('[BinHamid]',VERSION,'ready');
})();
