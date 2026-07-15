(function(){
  'use strict';

  const FIXED='data-bh-navigation-fixed';
  const ACTIVE_KEY='binhamid_active_dynamic_page';

  function setActive(value){
    try{sessionStorage.setItem(ACTIVE_KEY,value||'');}catch{}
  }

  function isCommunicationCenterActive(){
    try{return sessionStorage.getItem(ACTIVE_KEY)==='comms';}catch{return false;}
  }

  function activateCommunicationCenter(){
    const pane=document.getElementById('p-comms');
    if(!pane)return false;

    document.querySelectorAll('.pane').forEach(item=>item.classList.remove('on'));
    pane.hidden=false;
    pane.style.display='';
    pane.classList.add('on');

    document.querySelectorAll('#tabs button').forEach(button=>button.classList.remove('on'));
    const tab=document.getElementById('bhCommsTab');
    if(tab)tab.classList.add('on');

    setActive('comms');
    return true;
  }

  function runWithoutLegacyCommsNavigation(callback,context,event){
    const originalGo=window.go;
    if(typeof originalGo==='function'){
      window.go=function(page){
        if(String(page||'')==='comms')return false;
        return originalGo.apply(this,arguments);
      };
    }
    try{return callback.call(context,event);}
    finally{
      if(typeof originalGo==='function')window.go=originalGo;
    }
  }

  function wrapButton(button){
    if(!button||button.hasAttribute(FIXED))return;
    button.setAttribute(FIXED,'1');

    const original=button.onclick;
    button.onclick=function(event){
      if(event){event.preventDefault();event.stopPropagation();}
      setActive('comms');

      if(typeof original==='function'){
        try{runWithoutLegacyCommsNavigation(original,this,event);}
        catch(error){console.error('[BinHamid comms navigation]',error);}
      }

      activateCommunicationCenter();
      queueMicrotask(activateCommunicationCenter);
      [50,180,500,1200,2500].forEach(delay=>setTimeout(()=>{
        if(isCommunicationCenterActive())activateCommunicationCenter();
      },delay));
      return false;
    };
  }

  function patch(){
    wrapButton(document.getElementById('bhCommsTab'));
    wrapButton(document.getElementById('bhCloudBadge'));
    if(isCommunicationCenterActive())activateCommunicationCenter();
  }

  document.addEventListener('click',function(event){
    const button=event.target&&event.target.closest?event.target.closest('#tabs button'):null;
    if(button&&button.id!=='bhCommsTab')setActive('');
  },true);

  addEventListener('pageshow',()=>setTimeout(patch,0));
  addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&isCommunicationCenterActive())setTimeout(activateCommunicationCenter,0);
  });

  const observer=new MutationObserver(patch);
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});
  patch();

  window.bhOpenCommunicationCenter=function(){
    setActive('comms');
    const button=document.getElementById('bhCommsTab')||document.getElementById('bhCloudBadge');
    if(button)button.click();
    else activateCommunicationCenter();
  };
})();