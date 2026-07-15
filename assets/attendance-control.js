(function(){
  'use strict';
  function install(){
    const pane=document.getElementById('p-comms');
    if(!pane||document.getElementById('bhAttendanceAdminLink'))return;
    const host=document.getElementById('bhCommsRoot')||pane;
    const bar=document.createElement('div');
    bar.id='bhAttendanceAdminLink';
    bar.style.cssText='display:flex;gap:8px;align-items:center;justify-content:space-between;margin:0 0 12px;padding:12px 14px;border:1px solid #d6dedf;border-radius:13px;background:#f5f8f7;color:#173746;';
    bar.innerHTML='<div><b>إدارة الحضور والسائقين</b><small style="display:block;color:#637980;margin-top:3px">ربط الموظف بموقع العمل والمركبة ومراجعة الحضور والحركة والديزل</small></div><button type="button" style="border:0;border-radius:10px;padding:10px 13px;background:#173746;color:white;font-weight:800;white-space:nowrap">فتح الإدارة</button>';
    bar.querySelector('button').onclick=function(){window.open('/attendance-admin.html','_blank','noopener');};
    host.prepend(bar);
  }
  install();
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
})();
