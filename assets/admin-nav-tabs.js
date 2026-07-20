(function(){
'use strict';
/* يلحق صفحات الإدارة الخارجية (البوابة، الحسابات، الخلطات، الحوكمة،
   الحضور، ربط الجهاز) كأزرار داخل نفس شريط تابات البرنامج الرئيسي
   #tabs — بنفس شكلها وترتيبها بعد التابات الحالية، بدل ما تكون شريط
   عائم منفصل. الضغط عليها يفتح الصفحة بالكامل (target=_top) لأنها
   برامج مستقلة وليست لوحات SPA داخلية. */
const VERSION='2026.07.19-admin-nav-tabs-v1';
const LINKS=[
  ['🚪','البوابة','/control-center.html'],
  ['💰','الحسابات','/accounting.html'],
  ['🧪','الخلطات والأسعار','/mix-designs.html'],
  ['⚖️','الحوكمة','/governance.html'],
  ['🕐','الحضور والسائقين','/attendance-admin.html'],
  ['🔗','ربط جهاز بمستخدم','/device-access.html']
];
function build(){
  const tabs=document.getElementById('tabs');
  if(!tabs||tabs.dataset.bhAdminLinksAdded==='1')return false;
  tabs.dataset.bhAdminLinksAdded='1';
  // مع 17 تبويبًا صار الشريط أعرض من الصفحة وشريط تمريره مخفي بالتصميم،
  // فتختفي تبويبات بلا أي مؤشر. الحل: التفاف على أكثر من سطر مع تصغير
  // الحشو والخط ليتسع الشريط كاملًا داخل الشاشة.
  if(!document.getElementById('bh-admin-tabs-compact')){
    const style=document.createElement('style');
    style.id='bh-admin-tabs-compact';
    style.textContent='.tabs{flex-wrap:wrap;overflow-x:visible;row-gap:0}.tabs button{padding:8px 9px;font-size:12px}.tabs button .ic{margin-inline-end:3px}@media (max-width:760px){.tabs button{padding:7px 7px;font-size:11px}}';
    document.head.appendChild(style);
  }
  for(const[icon,label,href] of LINKS){
    if(tabs.querySelector(`button[data-bh-href="${href}"]`))continue;
    const button=document.createElement('button');
    button.type='button';
    button.dataset.bhHref=href;
    button.innerHTML=`<span class="ic">${icon}</span>${label}`;
    button.onclick=()=>{try{window.top.location.href=href}catch{location.href=href}};
    tabs.appendChild(button);
  }
  return true;
}
let tries=0;
const timer=setInterval(()=>{
  tries++;
  if(build()||tries>20)clearInterval(timer);
},300);
console.info('[BinHamid]',VERSION,'loaded');
})();
