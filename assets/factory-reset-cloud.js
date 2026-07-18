(function(){
  'use strict';
  const CONFIRMATION='RESET_FACTORY_OPERATIONAL_DATA';
  const KEEP=new Set(['binhamid_cloud_device_id','binhamid_cloud_app_user_id','binhamid_cloud_access_token']);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));

  async function preserveLocalBackup(){
    if(typeof window.opsSnapshot==='function')await window.opsSnapshot('قبل إعادة ضبط المصنع السحابية');
  }

  async function clearLocalOperationalData(){
    try{Object.keys(localStorage).filter(key=>key.toLowerCase().includes('binhamid')&&!KEEP.has(key)).forEach(key=>localStorage.removeItem(key));}catch(error){console.warn('[BinHamid reset localStorage]',error);}
    try{
      const names=['binhamid_factory_control_db_v3'];
      if(indexedDB.databases){const rows=await indexedDB.databases();for(const row of rows||[])if(row.name&&row.name.toLowerCase().includes('binhamid'))names.push(row.name);}
      await Promise.all([...new Set(names)].map(name=>new Promise(resolve=>{
        const request=indexedDB.open(name);
        request.onerror=()=>resolve();
        request.onsuccess=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('files')){db.close();return resolve();}
          const tx=db.transaction('files','readwrite');tx.objectStore('files').clear();
          tx.oncomplete=tx.onerror=()=>{db.close();resolve();};
        };
      })));
    }catch(error){console.warn('[BinHamid reset IndexedDB]',error);}
  }

  async function reset(){
    const phrase=prompt('إعادة ضبط المصنع ستزيل الحركات والتنبيهات والملفات التجريبية ورسائل Telegram المحفوظة.\n\nلن تحذف حساب المالك أو ربط البوت أو النسخ الاحتياطية.\n\nللمتابعة اكتب: بدء جديد');
    if(phrase!=='بدء جديد'){window.opsToast?.('تم الإلغاء — لم تُمسح أي بيانات','err');return;}
    try{
      window.opsSetSave?.('حفظ نسخة محلية قبل التهيئة');
      await preserveLocalBackup();
      window.opsSetSave?.('تهيئة البيانات السحابية');
      const response=await fetch('/api/factory-reset',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:CONFIRMATION,reason:'تهيئة بداية تشغيل جديدة من واجهة المصنع'})}),data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'تعذر إكمال إعادة ضبط المصنع');
      await clearLocalOperationalData();
      alert(`تمت إعادة ضبط بيانات التشغيل بنجاح.\n${esc(JSON.stringify(data.result?.counts||{}))}\n\nسيُعاد فتح البرنامج فارغًا. حُفظت النسخة المحلية والنسخ الاحتياطية.`);
      location.reload();
    }catch(error){console.error('[BinHamid factory reset]',error);window.opsSetSave?.('فشل التهيئة','err');window.opsToast?.(`لم تُكمل التهيئة: ${error.message}`,'err');}
  }

  function install(){
    window.opsFactoryReset=reset;
    window.wipe=reset;
    console.info('[BinHamid] cloud factory reset ready');
  }
  install();
})();
