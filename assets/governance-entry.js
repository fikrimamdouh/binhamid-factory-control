(function(){
  'use strict';
  function link(href,text,accent=false){const anchor=document.createElement('a');anchor.href=href;anchor.target='_top';anchor.textContent=text;if(accent)anchor.className='accent';return anchor;}
  function install(){
    if(document.getElementById('bhGovernanceEntry'))return;
    const style=document.createElement('style');style.id='bhGovernanceEntryStyle';style.textContent='.bh-gov-entry{position:fixed;left:18px;bottom:18px;z-index:99990;display:grid;gap:7px}.bh-gov-entry a{display:block;text-decoration:none;border-radius:11px;padding:10px 13px;background:#173746;color:#fff;font:800 12px system-ui;box-shadow:0 8px 25px #17374644;text-align:center}.bh-gov-entry a.accent{background:#b8892f;color:#fff}@media print{.bh-gov-entry{display:none}}';document.head.appendChild(style);
    const box=document.createElement('nav');box.id='bhGovernanceEntry';box.className='bh-gov-entry';box.append(link('/control-center.html','مركز الرقابة'),link('/governance.html','الحوكمة والتسليم'),link('/mix-designs.html','تكلفة الخلطات',true),link('/device-access.html','ربط الجهاز'));document.body.appendChild(box);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();
