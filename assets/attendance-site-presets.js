(function(){
  'use strict';
  if(window.__BH_ATTENDANCE_SITE_PRESETS_INSTALLED__)return;
  window.__BH_ATTENDANCE_SITE_PRESETS_INSTALLED__=true;
  const VERSION='2026.07.22-attendance-site-presets-v1';
  const PRESETS={
    FACTORY_MAIN:{code:'FACTORY_MAIN',name:'مصنع بن حامد والمكتب',address:'المكتب على أول الشارع والمصنع في الخلف — https://maps.app.goo.gl/HZ877vVfkm7tp9e17',radiusM:1000},
    STATION_MAIN:{code:'STATION_MAIN',name:'محطة الحصينية',address:'محطة الحصينية — https://maps.app.goo.gl/qSukur3khpuMS5PK9',radiusM:250}
  };
  const clean=value=>String(value??'').trim();
  const $=id=>document.getElementById(id);
  function headers(){const token=clean(localStorage.getItem('binhamid_cloud_access_token')),userId=clean(localStorage.getItem('binhamid_cloud_app_user_id'));return{'Content-Type':'application/json',...(token&&token!=='device-session'?{Authorization:`Bearer ${token}`} :{}),...(userId?{'X-App-User-Id':userId}:{})};}
  async function request(payload){const response=await fetch('/api/router?route=attendance-site-presets',{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers(),body:JSON.stringify(payload)}),data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||data.message||`HTTP ${response.status}`),{status:response.status,code:data.code||''});return data;}
  function notify(message,bad=false){if(typeof window.toast==='function')window.toast(message,bad);else console[bad?'error':'info']('[Attendance site presets]',message);}
  function currentPosition(){return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(new Error('GPS غير متاح في هذا المتصفح'));navigator.geolocation.getCurrentPosition(position=>resolve(position.coords),error=>reject(new Error(error.message||'تعذر قراءة الموقع')),{enableHighAccuracy:true,maximumAge:0,timeout:20000});});}
  async function useCurrentAsPreset(code){const preset=PRESETS[code];if(!preset)return;try{const coords=await currentPosition(),existing=(window.DATA?.sites||[]).find(site=>clean(site.code)===code);$('siteId').value=existing?.id||'';$('siteCode').value=preset.code;$('siteName').value=preset.name;$('siteAddress').value=preset.address;$('siteLat').value=coords.latitude.toFixed(7);$('siteLng').value=coords.longitude.toFixed(7);$('siteRadius').value=String(preset.radiusM);if(typeof window.saveSite!=='function')throw new Error('وظيفة حفظ الموقع غير جاهزة');await window.saveSite(null,true);notify(`تم اعتماد ${preset.name} بنطاق ${preset.radiusM} متر ودقة ${Math.round(coords.accuracy)} متر.`);}catch(error){notify(`${error.message}${error.code?` [${error.code}]`:''}`,true);}}
  async function seedDefaultSites(button){if(button)button.disabled=true;try{await request({action:'seed'});notify('تم حفظ مصنع بن حامد والمكتب ومحطة الحصينية من الروابط المعتمدة.');if(typeof window.loadAll==='function')await window.loadAll(true);}catch(error){notify(`${error.message}${error.code?` [${error.code}]`:''}`,true);}finally{if(button)button.disabled=false;}}
  function decorate(){
    const factoryButton=[...document.querySelectorAll('button')].find(button=>button.textContent.includes('اعتماد موقعي الحالي كمصنع'));
    const stationButton=[...document.querySelectorAll('button')].find(button=>button.textContent.includes('اعتماد موقعي الحالي كمحطة'));
    const seedButton=[...document.querySelectorAll('button')].find(button=>button.textContent.includes('محاولة إنشاء الموقعين'));
    if(factoryButton){factoryButton.textContent='اعتماد موقعي الحالي للمصنع والمكتب — نطاق 1000م';factoryButton.onclick=()=>useCurrentAsPreset('FACTORY_MAIN');}
    if(stationButton){stationButton.textContent='اعتماد موقعي الحالي لمحطة الحصينية — نطاق 250م';stationButton.onclick=()=>useCurrentAsPreset('STATION_MAIN');}
    if(seedButton){seedButton.textContent='حفظ الموقعين من روابط الخرائط المعتمدة';seedButton.onclick=()=>seedDefaultSites(seedButton);}
    const note=factoryButton?.closest('.card')?.querySelector('.note');if(note)note.textContent='المصنع والمكتب موقع واحد بنطاق 1000 متر ليشمل المكتب أول الشارع والمصنع في الخلف. محطة الحصينية موقع مستقل بنطاق 250 متر.';
    window.useCurrentAsPreset=useCurrentAsPreset;
    window.seedDefaultSites=seedDefaultSites;
    return Boolean(factoryButton&&stationButton&&seedButton);
  }
  function install(){if(!decorate())setTimeout(install,250);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  window.addEventListener('binhamid-owner-authenticated',()=>setTimeout(install,250));
  console.info('[BinHamid]',VERSION,'loaded');
})();
