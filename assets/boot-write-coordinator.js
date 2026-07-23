(function(){
'use strict';
if(window.__BH_BOOT_WRITE_COORDINATOR__)return;
window.__BH_BOOT_WRITE_COORDINATOR__=true;
const VERSION='2026.07.23-boot-write-coordinator-v1';
const bootAt=Date.now(),originalFetch=window.fetch.bind(window),flights=new Map();
let serial=Promise.resolve();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
function requestInfo(input,init={}){
  const url=typeof input==='string'?input:String(input?.url||''),method=String(init.method||input?.method||'GET').toUpperCase();
  let body=init.body??input?.body??null,jsonBody=null;
  if(typeof body==='string'&&body.length<20000){try{jsonBody=JSON.parse(body);}catch{}}
  return{url,method,jsonBody};
}
function classify(info){
  if(info.method==='POST'&&/\/api\/router\?route=canonical-master-data(?:&|$)/.test(info.url)&&info.jsonBody?.action==='reconcile_employee_telegram_links')return{key:'canonical-telegram-reconcile',notBefore:bootAt+35_000,gap:1500,single:true};
  if(info.method==='PUT'&&/\/api\/state(?:\?|$)/.test(info.url)&&/إرسال تغييرات معلقة|عودة الاتصال/.test(String(info.jsonBody?.reason||'')))return{key:'pending-state-push',notBefore:bootAt+18_000,gap:1200,single:false};
  return null;
}
function coordinatedFetch(input,init={}){
  const info=requestInfo(input,init),rule=classify(info);
  if(!rule)return originalFetch(input,init);
  if(rule.single&&flights.has(rule.key))return flights.get(rule.key).then(response=>response.clone());
  const run=serial.then(async()=>{
    const delay=rule.notBefore-Date.now();
    if(delay>0)await wait(delay);
    console.info('[BinHamid boot writes]',rule.key,'started after startup serialization');
    return originalFetch(input,init);
  });
  serial=run.then(()=>wait(rule.gap),()=>wait(rule.gap));
  if(rule.single){flights.set(rule.key,run);run.finally(()=>flights.delete(rule.key));}
  return run.then(response=>response.clone());
}
window.fetch=coordinatedFetch;
console.info('[BinHamid]',VERSION,'ready — heavy startup writes are serialized');
})();
