(function(){
'use strict';
/* شريط تنقل موحّد لصفحات الإدارة المستقلة — مبني بنفس ألوان وخط
   وهيكل الشريط العلوي وشريط التابات في البرنامج الرئيسي (legacy.html)
   حرفيًا، حتى يبان وكأنه نفس البرنامج مش شريط مضاف من برّه.
   إضافة صفحة جديدة لاحقًا: زوّد سطر واحد في مصفوفة LINKS بس. */
const VERSION='2026.07.19-admin-nav-v2-matched';
const LINKS=[
  ['🏠','البرنامج الرئيسي','/'],
  ['🚪','البوابة','/control-center.html'],
  ['💰','الحسابات','/accounting.html'],
  ['🧪','الخلطات والأسعار','/mix-designs.html'],
  ['⚖️','الحوكمة','/governance.html'],
  ['🕐','الحضور والسائقين','/attendance-admin.html'],
  ['🔗','ربط جهاز بمستخدم','/device-access.html']
];
function style(){
  if(document.getElementById('bh-admin-nav-style'))return;
  const el=document.createElement('style');
  el.id='bh-admin-nav-style';
  el.textContent=`
    :root{--bh-gold:#B4893A;--bh-gold-pale:#F5EDDF;--bh-navy:#14425F;--bh-navy-dk:#0C2A3D;--bh-line:#E2DCD1;--bh-muted:#6E6E6E}
    .bh-admin-top{background:linear-gradient(180deg,var(--bh-navy) 0%,var(--bh-navy-dk) 100%);color:#fff;
      padding:10px 16px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:9001;
      box-shadow:0 2px 12px rgba(0,0,0,.18);font-family:'IBM Plex Sans Arabic',system-ui,-apple-system,sans-serif}
    .bh-admin-top img{height:34px;width:auto;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
    .bh-admin-top .t{flex:1;min-width:0}
    .bh-admin-top .t b{display:block;font-family:'Reem Kufi','IBM Plex Sans Arabic',sans-serif;font-size:15px;font-weight:600}
    .bh-admin-top .t span{font-size:11px;color:#9EC2D8;display:block}
    .bh-admin-nav{display:flex;gap:2px;background:#fff;border-bottom:2px solid var(--bh-line);
      overflow-x:auto;position:sticky;top:54px;z-index:9000;scrollbar-width:none;padding:0 6px;
      font-family:'IBM Plex Sans Arabic',system-ui,-apple-system,sans-serif}
    .bh-admin-nav::-webkit-scrollbar{display:none}
    .bh-admin-nav button{background:none;border:none;border-bottom:3px solid transparent;flex:none;
      padding:12px 14px;font-family:inherit;font-size:13px;font-weight:600;color:var(--bh-muted);
      cursor:pointer;white-space:nowrap;transition:.15s}
    .bh-admin-nav button:hover{color:var(--bh-navy);background:var(--bh-gold-pale)}
    .bh-admin-nav button.on{color:var(--bh-navy);border-bottom-color:var(--bh-gold)}
    .bh-admin-nav button .ic{margin-inline-end:5px}
    @media(max-width:640px){.bh-admin-nav button{padding:10px 9px;font-size:11.5px}.bh-admin-top .t span{display:none}}
  `;
  document.head.appendChild(el);
}
function currentPath(){
  let p=location.pathname||'/';
  if(p.length>1&&p.endsWith('/'))p=p.slice(0,-1);
  return p||'/';
}
function build(){
  if(document.getElementById('bhAdminNav'))return;
  style();
  const here=currentPath();
  const top=document.createElement('div');
  top.className='bh-admin-top';
  top.innerHTML='<img src="/assets/branding/binhamid-factory-logo.png" alt=""><div class="t"><b>مصنع بن حامد للبلوك والخرسانة الجاهزة</b><span>نظام العهد والإقرارات والمسؤوليات الوظيفية</span></div>';
  const nav=document.createElement('nav');
  nav.id='bhAdminNav';
  nav.className='bh-admin-nav';
  nav.innerHTML=LINKS.map(([icon,label,href])=>{
    const path=href==='/'?'/':href.replace(/\/index\.html$/,'/');
    const active=(here===path)||(href==='/'&&(here==='/'||here==='/index.html'));
    return '<button type="button" data-href="'+href+'"'+(active?' class="on"':'')+'><span class="ic">'+icon+'</span>'+label+'</button>';
  }).join('');
  nav.addEventListener('click',event=>{
    const button=event.target.closest('button[data-href]');
    if(button)location.href=button.dataset.href;
  });
  document.body.insertBefore(nav,document.body.firstChild);
  document.body.insertBefore(top,nav);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);
else build();
console.info('[BinHamid]',VERSION,'loaded');
})();
