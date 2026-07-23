(function singleMasterWorkspace(){
'use strict';
if(window.__BH_SINGLE_MASTER_WORKSPACE__)return;
window.__BH_SINGLE_MASTER_WORKSPACE__=true;
const VERSION='2026.07.23-single-master-workspace-v1';
function open(kind='employees'){
  const tab=kind==='assets'||kind==='vehicle'||kind==='veh'?'assets':'employees';
  try{window.top.location.assign(`/master-data.html?tab=${tab}`);}catch(_){location.assign(`/master-data.html?tab=${tab}`);}
}
function requestedKind(target){
  const tab=target?.closest?.('.tabs button[data-p]');
  if(tab&&['emp','veh'].includes(String(tab.dataset.p)))return tab.dataset.p;
  const onclick=String(target?.closest?.('[onclick]')?.getAttribute('onclick')||'');
  if(/(?:go\(\s*['"]emp|empForm|opsQuickEmployeeForm|bh14OpenStep\(\s*['"]employee)/.test(onclick))return'emp';
  if(/(?:go\(\s*['"]veh|vehForm|bh14OpenStep\(\s*['"]vehicle)/.test(onclick))return'veh';
  return'';
}
function install(){
  const originalGo=window.go;
  if(typeof originalGo==='function'&&!originalGo.__bhSingleMaster){const wrapped=function(page){if(page==='emp'||page==='veh')return open(page);return originalGo.apply(this,arguments);};wrapped.__bhSingleMaster=true;window.go=wrapped;}
  window.empForm=()=>open('employees');
  window.vehForm=()=>open('assets');
  window.opsQuickEmployeeForm=()=>open('employees');
  window.bhOpenMasterData=open;
  document.querySelectorAll('.tabs button[data-p="emp"],.tabs button[data-p="veh"]').forEach(button=>{button.title='يفتح سجل الموظفين والمركبات الموحد';});
}
document.addEventListener('click',event=>{const kind=requestedKind(event.target);if(!kind)return;event.preventDefault();event.stopImmediatePropagation();open(kind);},true);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
console.info('[BinHamid]',VERSION,'loaded — employee and vehicle edits use one workspace');
})();
