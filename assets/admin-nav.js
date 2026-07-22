(function(){
'use strict';
const VERSION='2026.07.22-admin-nav-v6-employee-transfer';
const LINKS=[
  ['🏠','البرنامج','/','التشغيل'],
  ['⚙️','مركز الإدارة','/control-center.html','الإدارة'],
  ['👥','الموظفون والمعدات','/master-data.html','الإدارة'],
  ['💰','الحسابات','/accounting.html','المالية'],
  ['🧪','الخلطات والأسعار','/mix-designs.html','المالية'],
  ['🕐','الحضور والسائقون','/attendance-admin.html','الموظفون'],
  ['⚖️','الحوكمة','/governance.html','الرقابة']
];
function currentPath(){let p=location.pathname||'/';if(p.length>1&&p.endsWith('/'))p=p.slice(0,-1);return p||'/';}
function ensureScript(id,src,datasetName){if(document.getElementById(id)||document.querySelector(`script[data-${datasetName}]`))return;const script=document.createElement('script');script.id=id;script.src=src;script.async=false;script.dataset[datasetName.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]='1';document.head.appendChild(script);}
function ensureOwnerLogin(){if(window.__BH_OWNER_WEB_LOGIN_INSTALLED__)return;ensureScript('bh-owner-login-loader','/assets/owner-web-login.js?v=20260722-1','bh-owner-login');}
function ensureSessionControls(){if(window.__BH_SESSION_CONTROLS_INSTALLED__)return;ensureScript('bh-session-controls-loader','/assets/session-controls.js?v=20260721-1','bh-session-controls');}
function ensureEmployeeTransfer(){if(currentPath()!=='/attendance-admin.html'||window.__BH_EMPLOYEE_LINK_TRANSFER_INSTALLED__)return;ensureScript('bh-employee-link-transfer-loader','/assets/employee-link-transfer.js?v=20260722-1','bh-employee-link-transfer');}
function style(){if(document.getElementById('bh-admin-nav-style'))return;const el=document.createElement('style');el.id='bh-admin-nav-style';el.textContent=`
    :root{--bh-gold:#B4893A;--bh-gold-pale:#F5EDDF;--bh-navy:#14425F;--bh-navy-dk:#0C2A3D;--bh-line:#E2DCD1;--bh-muted:#6E6E6E}
    .bh-admin-top{background:linear-gradient(180deg,var(--bh-navy) 0%,var(--bh-navy-dk) 100%);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:9001;box-shadow:0 2px 12px rgba(0,0,0,.18);font-family:'IBM Plex Sans Arabic',system-ui,-apple-system,sans-serif}
    .bh-admin-top img{height:34px;width:auto}.bh-admin-top .t{flex:1;min-width:0}.bh-admin-top .t b{display:block;font-size:15px;font-weight:700}.bh-admin-top .t span{font-size:11px;color:#9EC2D8;display:block}
    .bh-admin-nav{display:flex;gap:3px;background:#fff;border-bottom:2px solid var(--bh-line);overflow-x:auto;position:sticky;top:54px;z-index:9000;scrollbar-width:none;padding:0 6px;font-family:'IBM Plex Sans Arabic',system-ui,-apple-system,sans-serif}
    .bh-admin-nav::-webkit-scrollbar{display:none}.bh-admin-nav button{background:none;border:none;border-bottom:3px solid transparent;flex:none;padding:11px 12px;font-family:inherit;font-size:12.5px;font-weight:700;color:var(--bh-muted);cursor:pointer;white-space:nowrap;transition:.15s}
    .bh-admin-nav button:hover{color:var(--bh-navy);background:var(--bh-gold-pale)}.bh-admin-nav button.on{color:var(--bh-navy);border-bottom-color:var(--bh-gold)}.bh-admin-nav button[data-group]:not(:first-child){border-inline-start:1px solid var(--bh-line)}.bh-admin-nav button .ic{margin-inline-end:5px}
    a[href="/device-access.html"],#altLoginToggle,#loginButton{display:none!important}html[data-bh-page="governance"] #login,html[data-bh-page="attendance-admin"] #login,html[data-bh-page="control-center"] #login{display:none!important}
    @media(max-width:640px){.bh-admin-nav button{padding:9px 8px;font-size:11px}.bh-admin-top .t span{display:none}}
  `;document.head.appendChild(el);}
function markPage(){const name=currentPath().replace(/^\//,'').replace(/\.html$/,'')||'home';document.documentElement.dataset.bhPage=name;if(name==='device-access')location.replace('/control-center.html');}
function refreshCurrentPage(){setTimeout(()=>{try{if(typeof window.loadAll==='function'){window.loadAll();return;}if(typeof window.loadData==='function'){window.loadData();return;}const refresh=document.getElementById('refresh');if(refresh&&!refresh.disabled){refresh.click();return;}location.reload();}catch{location.reload();}},120);}
function build(){markPage();ensureOwnerLogin();ensureSessionControls();ensureEmployeeTransfer();if(document.getElementById('bhAdminNav'))return;style();const here=currentPath(),top=document.createElement('div');top.className='bh-admin-top';const logo=document.createElement('img');logo.src='/assets/branding/binhamid-factory-logo.png';logo.alt='';const title=document.createElement('div');title.className='t';title.innerHTML='<b>مصنع بن حامد للبلوك والخرسانة الجاهزة</b><span>تنقل إداري موحد وجلسة آمنة عبر Telegram</span>';top.append(logo,title);const nav=document.createElement('nav');nav.id='bhAdminNav';nav.className='bh-admin-nav';for(const[icon,label,href,group]of LINKS){const path=href==='/'?'/':href.replace(/\/index\.html$/,'/'),active=(here===path)||(href==='/'&&(here==='/'||here==='/index.html')),button=document.createElement('button');button.type='button';button.dataset.href=href;button.dataset.group=group;if(active)button.className='on';const i=document.createElement('span');i.className='ic';i.textContent=icon;button.append(i,document.createTextNode(label));nav.appendChild(button);}nav.addEventListener('click',event=>{const button=event.target.closest('button[data-href]');if(button)location.href=button.dataset.href;});document.body.insertBefore(nav,document.body.firstChild);document.body.insertBefore(top,nav);}
markPage();style();ensureOwnerLogin();ensureSessionControls();ensureEmployeeTransfer();window.addEventListener('binhamid-owner-authenticated',()=>{refreshCurrentPage();ensureEmployeeTransfer();});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();console.info('[BinHamid]',VERSION,'loaded');
})();