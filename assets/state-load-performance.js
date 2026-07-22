// [BinHamid] 2026.07.22-state-load-performance-v3-session-gated-meta
// يمنع تنزيل app_state الكامل عند الإقلاع، ولا يطلب Revision قبل توفر جلسة مستخدم معتمدة.
(function(){
  'use strict';
  if(window.__BH_STATE_LOAD_PERFORMANCE__)return;
  window.__BH_STATE_LOAD_PERFORMANCE__=true;
  var VERSION='2026.07.22-state-load-performance-v3-session-gated-meta';
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
    result.headers=headers;result.credentials='same-origin';result.cache='no-store';return result;
  }
  function deferredMetadata(){
    var revision=Number(localStorage.getItem('binhamid_cloud_revision')||0);
    return new Response(JSON.stringify({revision:revision,payload:null,hasState:revision>0,metaOnly:true,deferredAuth:true}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  async function authorizedSessionReady(){
    var token=clean(localStorage.getItem('binhamid_cloud_access_token'));
    if(token&&token!=='device-session')return true;
    try{
      var session=window.bhCloudDeviceReady?await window.bhCloudDeviceReady:null;
      return Boolean(session&&session.bound===true);
    }catch(_){return false;}
  }
  async function fetchRevisionMetadata(input,options){
    if(!await authorizedSessionReady()){
      console.info('[BinHamid state-load] revision metadata deferred until an approved user session is ready');
      return deferredMetadata();
    }
    var response=await previousFetch('/api/state?meta=1',authenticatedOptions(input,options));
    if(response.status===401||response.status===403){
      console.info('[BinHamid state-load] revision metadata deferred because the cloud session is not authorized');
      return deferredMetadata();
    }
    return response;
  }

  window.fetch=function(input,options){
    var info=requestInfo(input,options||{}),withinBoot=Date.now()-startedAt<20000;
    if(!bootStateRequestHandled&&withinBoot&&info.method==='GET'&&info.url&&info.url.origin===location.origin&&info.url.pathname==='/api/state'&&!info.url.search){
      bootStateRequestHandled=true;
      console.info('[BinHamid state-load] automatic full state request replaced with session-gated revision metadata');
      return fetchRevisionMetadata(input,options||{});
    }
    return previousFetch(input,options);
  };
  console.info('[BinHamid]',VERSION,'ready');
})();