(function(){
'use strict';
/* شريط تنقل موحّد لصفحات الإدارة المستقلة. كل الصفحات تستخدم جلسة المالك
   نفسها الناتجة من رمز Telegram؛ لا يوجد اعتماد إدارة يدوي داخل الواجهة. */
const VERSION='2026.07.21-admin-nav-v3-unified-telegram-session';
const LINKS=[
  ['🏠','البرنامج الرئيسي','/'],
  ['🚪','البوابة','/control-center.html'],
  ['👥','الموظفون والمعدات','/master-data.html'],
  ['💰','الحسابات','/accounting.html'],
  ['🧪','الخلطات والأسعار','/mix-designs.html'],
  ['⚖️','الحوكمة','/governance.html'],
  ['🕐','الحضور والسائقين','/attendance-admin.html']
];
function currentPath(){
  let p=location.pathname||'/';
  if(p.length>1&&p.endsWith('/'))p=p.slice(0,-1);
  return p||'/';
}
function ensureOwnerLogin(){
  if(window.__BH_OWNER_WEB_LOGIN_INSTALLED__||document.querySelector('script[data-bh-owner-login]'))return;
  const script=document.createElement('script');
  script.src='/assets/owner-web-login.js?v=20260721-unified-admin-session';
  script.dataset.bhOwnerLogin='1';
  script.async=false;
  document.head.appendChild(script);
}
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
    a[href="/device-access.html"],#altLoginToggle,#loginButton{display:none!important}
    html[data-bh-page="governance"] #login,
    html[data-bh-page="attendance-admin"] #login,
    html[data-bh-page="control-center"] #login{display:none!important}
    @media(max-width:640px){.bh-admin-nav button{padding:10px 9px;font-size:11.5px}.bh-admin-top .t span{display:none}}
  `;
  document.head.appendChild(el);
}
function markPage(){
  const name=currentPath().replace(/^\//,'').replace(/\.html$/,'')||'home';
  document.documentElement.dataset.bhPage=name;
  if(name==='device-access')location.replace('/control-center.html');
}
function refreshCurrentPage(){
  setTimeout(()=>{
    try{
      if(typeof window.loadAll==='function'){window.loadAll();return;}
      if(typeof window.loadData==='function'){window.loadData();return;}
      const refresh=document.getElementById('refresh');
      if(refresh&&!refresh.disabled){refresh.click();return;}
      location.reload();
    }catch{location.reload();}
  },120);
}
function build(){
  markPage();
  ensureOwnerLogin();
  if(document.getElementById('bhAdminNav'))return;
  style();
  const here=currentPath();
  const top=document.createElement('div');
  top.className='bh-admin-top';
  top.innerHTML='<img src="/assets/branding/binhamid-factory-logo.png" alt=""><div class="t"><b>مصنع بن حامد للبلوك والخرسانة الجاهزة</b><span>جلسة موحدة وآمنة عبر رمز Telegram</span></div>';
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
markPage();
style();
ensureOwnerLogin();
window.addEventListener('binhamid-owner-authenticated',refreshCurrentPage);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);
else build();
console.info('[BinHamid]',VERSION,'loaded');
})();