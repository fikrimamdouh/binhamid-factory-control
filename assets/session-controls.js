(function(){
  'use strict';
  if(window.__BH_SESSION_CONTROLS_INSTALLED__)return;
  window.__BH_SESSION_CONTROLS_INSTALLED__=true;
  const VERSION='2026.07.21-session-controls-v1';
  const USER_KEY='binhamid_cloud_app_user_id';
  const TOKEN_KEY='binhamid_cloud_access_token';
  const DEVICE_KEY='binhamid_cloud_device_id';
  const LOCAL_CLEAR=[USER_KEY,TOKEN_KEY,DEVICE_KEY,'binhamid_cloud_pending','binhamid_cloud_conflict_lock_v1'];
  const SESSION_CLEAR=['binhamid_admin_token','bh_login_sync_done_v2','bh_logout_busy'];
  let busy=false;

  function deviceId(){try{return String(localStorage.getItem(DEVICE_KEY)||'').trim();}catch{return'';}}
  function clearClientSession(){
    try{for(const key of LOCAL_CLEAR)localStorage.removeItem(key);}catch{}
    try{for(const key of SESSION_CLEAR)sessionStorage.removeItem(key);}catch{}
  }
  async function serverLogout(id){
    if(!/^dev-[A-Za-z0-9-]{8,150}$/.test(id))return;
    const response=await fetch('/api/device/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout',deviceId:id})});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`HTTP ${response.status}`);}
  }
  async function logout(options={}){
    if(busy)return false;
    const ask=options.confirm!==false;
    if(ask&&!window.confirm('سيتم تسجيل الخروج وتجديد جلسة هذا المتصفح. لن تُحذف بيانات العملاء أو الأرصدة أو الموظفين.'))return false;
    busy=true;
    const id=deviceId();
    try{await serverLogout(id);}catch(error){console.warn('[BinHamid logout] server cookie clear failed; continuing with local reset',error?.message||error);}
    clearClientSession();
    try{window.dispatchEvent(new CustomEvent('binhamid-session-logged-out'));}catch{}
    const target=window.top&&window.top!==window?window.top:window;
    target.location.replace('/?renewSession=1');
    return true;
  }
  window.bhLogoutAndRenew=logout;

  function style(){
    if(document.getElementById('bh-session-controls-style'))return;
    const node=document.createElement('style');
    node.id='bh-session-controls-style';
    node.textContent='.bh-session-logout{border:1px solid rgba(255,255,255,.35);background:#8f2d2d;color:#fff;border-radius:9px;padding:7px 11px;font:700 11.5px system-ui,sans-serif;cursor:pointer;white-space:nowrap}.bh-session-logout:hover{background:#b23a3a}.bh-session-logout:disabled{opacity:.55;cursor:not-allowed}@media(max-width:640px){.bh-session-logout{padding:7px 8px;font-size:10.5px}}';
    document.head.appendChild(node);
  }
  function installButton(container){
    if(!container||container.querySelector('.bh-session-logout'))return false;
    style();
    const button=document.createElement('button');
    button.type='button';
    button.className='bh-session-logout';
    button.textContent='تسجيل خروج';
    button.title='تسجيل خروج وتجديد جلسة هذا المتصفح';
    button.addEventListener('click',async()=>{button.disabled=true;try{await logout();}finally{if(document.contains(button))button.disabled=false;}});
    container.appendChild(button);
    return true;
  }
  function scan(){
    installButton(document.querySelector('.topbar'));
    installButton(document.querySelector('.bh-admin-top'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  const observer=new MutationObserver(scan);observer.observe(document.documentElement,{childList:true,subtree:true});
  console.info('[BinHamid]',VERSION,'loaded');
})();
