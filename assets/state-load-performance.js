// [BinHamid] 2026.07.22-state-load-performance-v2-authenticated-meta
// يمنع مركز الاتصال من تنزيل app_state الكامل تلقائيًا عند كل فتح.
// المزامنة الرئيسية تفحص Revision أولًا، وتحافظ على ترويسات جلسة المستخدم عند تحويل الطلب.
(function(){
  'use strict';
  if(window.__BH_STATE_LOAD_PERFORMANCE__)return;
  window.__BH_STATE_LOAD_PERFORMANCE__=true;
  var VERSION='2026.07.22-state-load-performance-v2-authenticated-meta';
  var previousFetch=window.fetch.bind(window),startedAt=Date.now(),bootStateRequestHandled=false;

  function requestInfo(input,options){
    var method=String(options&&options.method||input&&input.method||'GET').toUpperCase();
    var raw=typeof input==='string'?input:String(input&&input.url||'');
    try{var url=new URL(raw,location.origin);return{method:method,url:url};}catch(_){return{method:method,url:null};}
  }
  function clean(value){return String(value||'').trim();}
  function authenticatedOptions(input,options){
    var result=Object.assign({},options||{}),headers=new Headers();
    try{if(input&&typeof input!=='string'&&input.headers)new Headers(input.headers).forEach(function(value,key){headers.set(key,value);});}catch(_){}
    try{new Headers(options&&options.headers||{}).forEach(function(value,key){headers.set(key,value);});}catch(_){}
    var userId=clean(localStorage.getItem('binhamid_cloud_app_user_id'));
    var token=clean(localStorage.getItem('binhamid_cloud_access_token'));
    if(userId&&!headers.has('X-App-User-Id'))headers.set('X-App-User-Id',userId);
    if(token&&token!=='device-session'&&!headers.has('Authorization'))headers.set('Authorization','Bearer '+token);
    result.headers=headers;
    result.credentials='same-origin';
    result.cache='no-store';
    return result;
  }
  async function refreshSessionOnce(){
    try{if(typeof window.bhRefreshOwnerSession==='function')await window.bhRefreshOwnerSession();}catch(_){}
  }
  async function fetchRevisionMetadata(input,options){
    var requestOptions=authenticatedOptions(input,options),response=await previousFetch('/api/state?meta=1',requestOptions);
    if(response.status!==401&&response.status!==403)return response;
    await refreshSessionOnce();
    return previousFetch('/api/state?meta=1',authenticatedOptions(input,options));
  }

  window.fetch=function(input,options){
    var info=requestInfo(input,options||{}),withinBoot=Date.now()-startedAt<20000;
    if(!bootStateRequestHandled&&withinBoot&&info.method==='GET'&&info.url&&info.url.origin===location.origin&&info.url.pathname==='/api/state'&&!info.url.search){
      bootStateRequestHandled=true;
      console.info('[BinHamid state-load] automatic full state request replaced with authenticated revision metadata');
      return fetchRevisionMetadata(input,options||{});
    }
    return previousFetch(input,options);
  };
  console.info('[BinHamid]',VERSION,'ready');
})();