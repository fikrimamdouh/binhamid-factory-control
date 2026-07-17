(function(){
  'use strict';
  const VERSION='2026.07.17-cloud-device-autolink-v1',TOKEN_KEY='binhamid_cloud_access_token',DEVICE_KEY='binhamid_cloud_device_id',PLACEHOLDER='device-session';
  function deviceId(){let value='';try{value=localStorage.getItem(DEVICE_KEY)||'';}catch{}if(!/^dev-[A-Za-z0-9-]{8,150}$/.test(value)){value='dev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);try{localStorage.setItem(DEVICE_KEY,value);}catch{}}return value;}
  function installPlaceholder(){try{localStorage.setItem(TOKEN_KEY,PLACEHOLDER);}catch{}try{document.cookie='bh_cloud_token='+PLACEHOLDER+'; path=/; max-age=15552000; SameSite=Strict'+(location.protocol==='https:'?'; Secure':'');}catch{}}
  installPlaceholder();
  window.bhCloudDeviceReady=fetch('/api/device/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:deviceId()})}).then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||data.message||'تعذر إنشاء جلسة الجهاز');window.BinHamidCloudDeviceSession={version:VERSION,ready:true,deviceId:data.deviceId,expiresAt:data.expiresAt};console.info('[BinHamid]',VERSION,'ready');return data;}).catch(error=>{window.BinHamidCloudDeviceSession={version:VERSION,ready:false,error:error.message};console.error('[BinHamid]',VERSION,error);throw error;});
})();
