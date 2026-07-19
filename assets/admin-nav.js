(function(){
'use strict';
/* شريط تنقل موحّد لكل صفحات الإدارة — يُحقن مرة واحدة أعلى الصفحة.
   إضافة صفحة جديدة لاحقًا: زوّد سطر واحد في مصفوفة LINKS بس. */
const VERSION='2026.07.19-admin-nav-v1';
const LINKS=[
  ['/control-center.html','البوابة'],
  ['/','البرنامج الرئيسي'],
  ['/accounting.html','الحسابات'],
  ['/mix-designs.html','الخلطات والأسعار'],
  ['/governance.html','الحوكمة'],
  ['/attendance-admin.html','الحضور والسائقين'],
  ['/device-access.html','ربط جهاز بمستخدم']
];
function style(){
  if(document.getElementById('bh-admin-nav-style'))return;
  const el=document.createElement('style');
  el.id='bh-admin-nav-style';
  el.textContent=`
    .bh-admin-nav{position:sticky;top:0;z-index:9000;display:flex;align-items:center;gap:2px;
      overflow-x:auto;background:#0b2233;padding:0 10px;font:700 12px system-ui,-apple-system,"Segoe UI",sans-serif;
      box-shadow:0 2px 10px rgba(0,0,0,.18)}
    .bh-admin-nav a{flex:none;display:block;padding:11px 12px;color:#b9c9d1;text-decoration:none;
      border-bottom:3px solid transparent;white-space:nowrap}
    .bh-admin-nav a:hover{color:#fff}
    .bh-admin-nav a.on{color:#fff;border-bottom-color:#d2aa45}
    .bh-admin-nav .bh-admin-nav-brand{flex:none;padding:11px 12px 11px 4px;color:#d2aa45;font-weight:900;border-left:1px solid rgba(255,255,255,.15);margin-left:4px}
    @media(max-width:640px){.bh-admin-nav a{padding:10px 9px;font-size:11px}}
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
  const nav=document.createElement('nav');
  nav.id='bhAdminNav';
  nav.className='bh-admin-nav';
  nav.innerHTML='<span class="bh-admin-nav-brand">بن حامد</span>'+LINKS.map(([href,label])=>{
    const path=href==='/'?'/':href.replace(/\/index\.html$/,'/');
    const active=(here===path)||(href==='/'&&(here==='/'||here==='/index.html'));
    return '<a href="'+href+'"'+(active?' class="on"':'')+'>'+label+'</a>';
  }).join('');
  document.body.insertBefore(nav,document.body.firstChild);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);
else build();
console.info('[BinHamid]',VERSION,'loaded');
})();
