(function(){
  'use strict';
  const VERSION='2026.07.17-import-review-guard-v1';
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
      window.BinHamidActiveImportId=importId;
      try{sessionStorage.setItem(ACTIVE_KEY,importId);}catch{}
      try{return await original.apply(this,arguments);}
      finally{
        if(window.BinHamidActiveImportId===importId)window.BinHamidActiveImportId='';
        try{if(sessionStorage.getItem(ACTIVE_KEY)===importId)sessionStorage.removeItem(ACTIVE_KEY);}catch{}
      }
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

  const timer=setInterval(()=>{if(install())clearInterval(timer);},200);
  setTimeout(()=>clearInterval(timer),20000);
})();
