(function(){
'use strict';
const VERSION='2026.07.21-admin-nav-tabs-v2-grouped';
const LINKS=[
  ['⚙️','مركز الإدارة','/control-center.html'],
  ['💰','الحسابات','/accounting.html'],
  ['👥','الموظفون والأصول','/master-data.html']
];
function build(){
  const tabs=document.getElementById('tabs');
  if(!tabs||tabs.dataset.bhAdminLinksAdded==='1')return false;
  tabs.dataset.bhAdminLinksAdded='1';
  if(!document.getElementById('bh-admin-tabs-compact')){
    const style=document.createElement('style');
    style.id='bh-admin-tabs-compact';
    style.textContent='.tabs{flex-wrap:wrap;overflow-x:visible;row-gap:0}.tabs button{padding:8px 9px;font-size:12px}.tabs button .ic{margin-inline-end:3px}.tabs .bh-admin-entry{background:#f8f4ea;border-inline-start:1px solid #e2dcd1}@media (max-width:760px){.tabs button{padding:7px 7px;font-size:11px}}';
    document.head.appendChild(style);
  }
  for(const[icon,label,href] of LINKS){
    if(tabs.querySelector(`button[data-bh-href="${href}"]`))continue;
    const button=document.createElement('button');
    button.type='button';
    button.className='bh-admin-entry';
    button.dataset.bhHref=href;
    const iconNode=document.createElement('span');
    iconNode.className='ic';
    iconNode.textContent=icon;
    button.append(iconNode,document.createTextNode(label));
    button.onclick=()=>{try{window.top.location.href=href}catch{location.href=href}};
    tabs.appendChild(button);
  }
  return true;
}
let tries=0;
const timer=setInterval(()=>{tries++;if(build()||tries>20)clearInterval(timer);},300);
console.info('[BinHamid]',VERSION,'loaded');
})();
