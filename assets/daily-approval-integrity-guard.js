(function(){
  'use strict';
  const VERSION='2026.07.17-daily-approval-integrity-v1';
  const ACTIVE_KEY='binhamid_active_import_id';
  const originalFetch=window.fetch.bind(window);
  let lastCommit=null;

  const activeImportId=()=>{
    try{return String(window.BinHamidActiveImportId||sessionStorage.getItem(ACTIVE_KEY)||'').trim();}
    catch{return String(window.BinHamidActiveImportId||'').trim();}
  };
  const responseFrom=(original,data)=>new Response(JSON.stringify(data),{
    status:original.status,
    statusText:original.statusText,
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
  const notifyKey=data=>`binhamid_daily_notified:${String(data?.reportDate||'')}:${String(data?.importId||data?.originalName||'')}`;

  window.fetch=async function(input,options={}){
    const url=typeof input==='string'?input:String(input?.url||'');
    if(url.includes('/api/daily-report')&&String(options?.method||'GET').toUpperCase()==='POST'){
      let payload;try{payload=JSON.parse(String(options.body||'{}'));}catch{return originalFetch(input,options);}
      const importId=activeImportId();
      if(importId&&!payload.importId)payload.importId=importId;
      const response=await originalFetch(input,{...options,body:JSON.stringify(payload)});
      const data=await response.clone().json().catch(()=>null);
      if(data&&payload.action==='commit'&&response.ok){lastCommit=data;window.BinHamidLastDailyCommit=data;}
      // The legacy UI treats a duplicate preview as a hard stop. For a retry after
      // successful server posting, allow it to continue to commit; the server then
      // returns the same batch and journals idempotently.
      if(data&&payload.action==='preview'&&response.ok&&data.duplicate){
        return responseFrom(response,{...data,duplicate:false,valid:true,recoveryDuplicate:true});
      }
      return response;
    }
    if(url.includes('/api/telegram/notify')&&String(options?.method||'GET').toUpperCase()==='POST'){
      let payload;try{payload=JSON.parse(String(options.body||'{}'));}catch{return originalFetch(input,options);}
      const key=notifyKey(payload);
      try{if(localStorage.getItem(key)==='1')return new Response(JSON.stringify({ok:true,duplicate:true}),{status:200,headers:{'Content-Type':'application/json'}});}catch{}
      const response=await originalFetch(input,options);
      if(response.ok)try{localStorage.setItem(key,'1');}catch{}
      return response;
    }
    return originalFetch(input,options);
  };

  function install(){
    if(typeof window.opsOpenModal!=='function'||window.opsOpenModal.__dailyIntegrityGuard)return false;
    const current=window.opsOpenModal;
    const guarded=function(title,html,onSave,label){
      const localSave=async function(){
        try{
          const result=await onSave.apply(this,arguments);
          if(result===false)return false;
          const batch=(window.OPS?.imports||[])[0];
          if(batch&&lastCommit){
            batch.cloudSchemaVersion=19;
            batch.accounting=lastCommit.accounting||null;
            batch.cloudImportId=lastCommit.postedBatchId||lastCommit.importId||lastCommit.existingImportId||batch.cloudImportId||'';
            batch.sourceImportId=activeImportId()||batch.sourceImportId||'';
          }
          return result;
        }catch(error){
          const evidence=lastCommit&&{postedBatchId:lastCommit.postedBatchId||lastCommit.importId||'',accounting:lastCommit.accounting||null,at:new Date().toISOString()};
          try{if(evidence)localStorage.setItem('binhamid_daily_local_recovery',JSON.stringify(evidence));}catch{}
          window.opsToast?.(evidence?'تم الترحيل في الخادم، وتعذر تحديث العرض المحلي. أعد الاعتماد لبناء العرض دون تكرار القيود.':'تعذر الاعتماد ولم تُرحّل حركة جديدة.','err');
          throw error;
        }
      };
      return current.call(this,title,html,localSave,label);
    };
    guarded.__dailyIntegrityGuard=true;
    window.opsOpenModal=guarded;
    window.BinHamidDailyApprovalIntegrityGuard={version:VERSION,installed:true};
    console.info('[BinHamid]',VERSION,'loaded');
    return true;
  }

  const timer=setInterval(()=>{if(install())clearInterval(timer);},250);
  setTimeout(()=>clearInterval(timer),25000);
})();
