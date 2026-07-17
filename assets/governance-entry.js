(function(){
  'use strict';
  function install(){
    if(document.getElementById('bhGovernanceEntry'))return;
    const style=document.createElement('style');style.id='bhGovernanceEntryStyle';style.textContent='.bh-gov-entry{position:fixed;left:18px;bottom:18px;z-index:99990;display:grid;gap:7px}.bh-gov-entry a{display:block;text-decoration:none;border-radius:11px;padding:10px 13px;background:#173746;color:#fff;font:800 12px system-ui;box-shadow:0 8px 25px #17374644;text-align:center}.bh-gov-entry a:last-child{background:#b8892f;color:#fff}@media print{.bh-gov-entry{display:none}}';document.head.appendChild(style);
    const box=document.createElement('nav');box.id='bhGovernanceEntry';box.className='bh-gov-entry';box.innerHTML='<a href="/control-center.html" target="_top">مركز الرقابة</a><a href="/governance.html" target="_top">الحوكمة والتسليم</a>';document.body.appendChild(box);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();
