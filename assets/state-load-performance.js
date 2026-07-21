// [BinHamid] 2026.07.21-state-load-performance-v1
// يمنع مركز الاتصال من تنزيل app_state الكامل تلقائيًا عند كل فتح.
// المزامنة الرئيسية تفحص Revision أولًا، والسحب الكامل يحدث فقط عند اختلاف النسخة.
(function(){
  'use strict';
  if(window.__BH_STATE_LOAD_PERFORMANCE__)return;
  window.__BH_STATE_LOAD_PERFORMANCE__=true;
  var VERSION='2026.07.21-state-load-performance-v1';
  var previousFetch=window.fetch.bind(window),startedAt=Date.now(),bootStateRequestHandled=false;

  function requestInfo(input,options){
    var method=String(options&&options.method||'GET').toUpperCase();
    var raw=typeof input==='string'?input:String(input&&input.url||'');
    try{var url=new URL(raw,location.origin);return{method:method,url:url};}catch(_){return{method:method,url:null};}
  }

  window.fetch=function(input,options){
    var info=requestInfo(input,options||{}),withinBoot=Date.now()-startedAt<20000;
    if(!bootStateRequestHandled&&withinBoot&&info.method==='GET'&&info.url&&info.url.origin===location.origin&&info.url.pathname==='/api/state'&&!info.url.search){
      bootStateRequestHandled=true;
      console.info('[BinHamid state-load] automatic full state request replaced with revision metadata');
      return previousFetch('/api/state?meta=1',options);
    }
    return previousFetch(input,options);
  };
  console.info('[BinHamid]',VERSION,'ready');
})();