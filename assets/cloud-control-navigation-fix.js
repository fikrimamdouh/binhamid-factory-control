(function(){
  'use strict';

  const FIXED='data-bh-navigation-fixed';

  function activateCommunicationCenter(){
    const pane=document.getElementById('p-comms');
    if(!pane)return false;

    document.querySelectorAll('.pane').forEach(item=>item.classList.remove('on'));
    pane.classList.add('on');

    document.querySelectorAll('#tabs button').forEach(button=>button.classList.remove('on'));
    const tab=document.getElementById('bhCommsTab');
    if(tab)tab.classList.add('on');

    pane.hidden=false;
    pane.style.display='';
    return true;
  }

  function wrapButton(button){
    if(!button||button.hasAttribute(FIXED))return;
    button.setAttribute(FIXED,'1');

    const original=button.onclick;
    button.onclick=function(event){
      if(typeof original==='function')original.call(this,event);

      // The legacy go() function does not know the dynamic "comms" page and
      // falls back to the overview after saving. Re-activate the injected pane
      // after the legacy navigation and any synchronous render have finished.
      queueMicrotask(activateCommunicationCenter);
      setTimeout(activateCommunicationCenter,40);
      setTimeout(activateCommunicationCenter,180);
      setTimeout(activateCommunicationCenter,500);
      return false;
    };
  }

  function patch(){
    wrapButton(document.getElementById('bhCommsTab'));
    wrapButton(document.getElementById('bhCloudBadge'));
  }

  const observer=new MutationObserver(patch);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  patch();

  window.bhOpenCommunicationCenter=function(){
    const button=document.getElementById('bhCommsTab')||document.getElementById('bhCloudBadge');
    if(button)button.click();
    else activateCommunicationCenter();
  };
})();
