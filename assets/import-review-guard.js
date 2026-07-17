(function(){
  'use strict';
  const VERSION='2026.07.17-import-review-guard-v3';
  const AUTO_KEY='binhamid_cloud_auto_import';
  const ACTIVE_KEY='binhamid_active_import_id';
  try{localStorage.setItem(AUTO_KEY,'0');}catch{}

  function install(){
    if(typeof window.bhCloudApplyImport!=='function')return false;
    if(window.bhCloudApplyImport.__reviewGuard)return true;
    const original=window.bhCloudApplyImport;
    const guarded=async function(id,type,name){
      const importId=String(id||'').trim();
      if(!importId)throw new Error('رقم عملية الاستيراد غير موجود.');
      // Keep the source import bound to the review modal until the approval layer
      // clears it after POSTED/REJECTED. Clearing it when the modal opens loses the
      // original-file relationship before the user presses Approve.
      window.BinHamidActiveImportId=importId;
      try{sessionStorage.setItem(ACTIVE_KEY,importId);}catch{}
      return original.apply(this,arguments);
    };
    guarded.__reviewGuard=true;
    window.bhCloudApplyImport=guarded;
    window.bhCloudAutoImport=function(){
      try{localStorage.setItem(AUTO_KEY,'0');}catch{}
      window.opsToast?.('الترحيل التلقائي موقوف رقابيًا. افتح الملف من مركز الوارد وراجعه ثم اعتمده.');
      return false;
    };
    window.BinHamidImportReviewGuard={version:VERSION,installed:true,autoImport:false};
    console.info('[BinHamid]',VERSION,'loaded');
    return true;
  }

  function loadDailyIntegrity(){
    if(!window.BinHamidDailyReportSourceOfTruth?.installed)return false;
    if(document.getElementById('binhamid-daily-approval-integrity'))return true;
    const script=document.createElement('script');
    script.id='binhamid-daily-approval-integrity';
    script.src='/assets/daily-approval-integrity-guard.js?v=20260717-2';
    script.async=false;
    script.onerror=()=>console.error('[BinHamid] تعذر تحميل طبقة سلامة اعتماد التقرير اليومي.');
    document.body.appendChild(script);
    return true;
  }

  const timer=setInterval(()=>{if(install())clearInterval(timer);},200);
  const integrityTimer=setInterval(()=>{if(loadDailyIntegrity())clearInterval(integrityTimer);},250);
  setTimeout(()=>{clearInterval(timer);clearInterval(integrityTimer);},25000);
})();
