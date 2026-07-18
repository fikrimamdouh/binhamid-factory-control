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

  function wrapButton(button){
    if(!button||button.hasAttribute(FIXED))return;
    button.setAttribute(FIXED,'1');

    const original=button.onclick;
    button.onclick=function(event){
      if(event){event.preventDefault();event.stopPropagation();}
      setActive('comms');

      // Do not call the legacy handler here.  It routes to a page that is not
      // part of the original tab map, so a browser error there used to leave
      // every pane hidden.  This extension owns the communication-center tab.
      activateCommunicationCenter();
      [50,180,500].forEach(delay=>setTimeout(()=>{
        if(isCommunicationCenterActive())activateCommunicationCenter();
      },delay));
      try{window.bhCloudView?.('overview');}catch(error){console.error('[BinHamid comms load]',error);}
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
  observer.observe(document.documentElement,{childList:true,subtree:true});
  patch();

  window.bhOpenCommunicationCenter=function(){
    setActive('comms');
    const button=document.getElementById('bhCommsTab')||document.getElementById('bhCloudBadge');
    if(button)button.click();
    else activateCommunicationCenter();
  };
})();
