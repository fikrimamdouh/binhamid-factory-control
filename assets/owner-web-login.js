(function(){
  'use strict';
  if(window.__BH_OWNER_WEB_LOGIN_INSTALLED__)return;
  window.__BH_OWNER_WEB_LOGIN_INSTALLED__=true;
  const VERSION='2026.07.19-owner-web-login-v3-rate-limit-safe',USER_KEY='binhamid_cloud_app_user_id',TOKEN_KEY='binhamid_cloud_access_token',DEVICE_KEY='binhamid_cloud_device_id';
  const originalFetch=window.fetch.bind(window);
  let requestBusy=false,verifyBusy=false,cooldownUntil=0,cooldownTimer=null;
  const device=()=>{let id=localStorage.getItem(DEVICE_KEY)||'';if(!/^dev-[A-Za-z0-9-]{8,150}$/.test(id)){id='dev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);localStorage.setItem(DEVICE_KEY,id);}return id;};
  const user=()=>String(localStorage.getItem(USER_KEY)||'').trim();
  window.fetch=function(input,options={}){const url=String(typeof input==='string'?input:input?.url||'');if(!url.includes('/api/')||!user())return originalFetch(input,options);const headers=new Headers(options.headers||{});if(!headers.has('X-App-User-Id'))headers.set('X-App-User-Id',user());return originalFetch(input,{credentials:'same-origin',...options,headers});};
  function style(){if(document.getElementById('bhOwnerLoginStyle'))return;document.head.insertAdjacentHTML('beforeend','<style id="bhOwnerLoginStyle">.bh-owner-gate{position:fixed;inset:0;z-index:14000;display:none;place-items:center;padding:20px;background:radial-gradient(circle at 20% 0,#244d58 0,#0a202d 58%,#06151e 100%)}.bh-owner-gate.on{display:grid}.bh-owner-card{width:min(440px,95vw);text-align:center;padding:26px 26px 24px;border-radius:22px;background:#fff;box-shadow:0 26px 80px rgba(0,0,0,.35)}.bh-owner-logo{display:block;width:min(255px,78vw);height:auto;max-height:108px;object-fit:contain;margin:0 auto 10px}.bh-owner-card h2{margin:0;color:#12313e;font-size:22px}.bh-owner-card h2 small{display:block;margin-top:4px;color:#ad7d28;font-size:11px;letter-spacing:1px}.bh-owner-card p{font-size:12px;line-height:1.9;color:#62747b;margin:12px 0 17px}.bh-owner-code{display:none}.bh-owner-code.on{display:block}.bh-owner-card input{box-sizing:border-box;width:100%;border:1px solid #d7e0e1;border-radius:10px;padding:12px;text-align:center;letter-spacing:5px;font:700 20px Arial;color:#12313e}.bh-owner-actions{display:flex;gap:8px;justify-content:center;margin-top:15px}.bh-owner-actions button{border:0;border-radius:10px;padding:10px 14px;font:700 12px inherit;cursor:pointer}.bh-owner-actions button:disabled{opacity:.55;cursor:not-allowed}.bh-owner-primary{background:#176448;color:#fff}.bh-owner-secondary{background:#edf2f3;color:#31515b}.bh-owner-message{min-height:20px;font-size:11px;color:#a13a3a;margin-top:10px}.bh-owner-message.ok{color:#176448}</style>');}
  function gate(){return document.getElementById('bhOwnerGate');}
  function show(){style();if(!gate())document.body.insertAdjacentHTML('beforeend','<section class="bh-owner-gate" id="bhOwnerGate" role="dialog" aria-modal="true"><div class="bh-owner-card"><img class="bh-owner-logo" src="/assets/branding/binhamid-factory-logo.png" alt="مصنع بن حامد للبلوك والخرسانة الجاهزة"><h2>نظام الرقابة والتشغيل<small>BIN HAMID FACTORY</small></h2><p id="bhOwnerText">دخول آمن للمالك. أرسل رمزًا مؤقتًا إلى حساب Telegram المعتمد ثم اكتبه هنا.</p><div id="bhOwnerCodeBox" class="bh-owner-code"><input id="bhOwnerCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••"></div><div class="bh-owner-actions"><button class="bh-owner-secondary" id="bhOwnerCancel">إلغاء</button><button class="bh-owner-primary" id="bhOwnerSend">إرسال رمز إلى Telegram</button></div><div class="bh-owner-message" id="bhOwnerMessage"></div></div></section>');const box=gate();box.classList.add('on');document.getElementById('bhOwnerCancel').onclick=()=>box.classList.remove('on');const button=document.getElementById('bhOwnerSend');if(!document.getElementById('bhOwnerCodeBox').classList.contains('on')){button.textContent='إرسال رمز إلى Telegram';button.onclick=requestCode;}refreshCooldown();}
  function message(text,ok=false){const box=document.getElementById('bhOwnerMessage');if(box){box.textContent=text||'';box.className='bh-owner-message'+(ok?' ok':'');}}
  function sendButton(){return document.getElementById('bhOwnerSend');}
  function retrySeconds(response,data){const header=Number(response.headers.get('Retry-After')||0),body=Number(data.retryAfterSeconds||data.retry_after||0);return Math.max(5,Math.min(600,header||body||60));}
  function refreshCooldown(){
    clearTimeout(cooldownTimer);
    const button=sendButton();if(!button)return;
    const left=Math.ceil((cooldownUntil-Date.now())/1000);
    if(left>0){button.disabled=true;button.textContent=`إعادة المحاولة بعد ${left}ث`;cooldownTimer=setTimeout(refreshCooldown,1000);return;}
    if(!requestBusy&&!verifyBusy){button.disabled=false;if(!document.getElementById('bhOwnerCodeBox')?.classList.contains('on'))button.textContent='إرسال رمز إلى Telegram';}
  }
  async function requestCode(){
    if(requestBusy)return;
    const left=Math.ceil((cooldownUntil-Date.now())/1000);if(left>0){message(`انتظر ${left} ثانية قبل طلب رمز جديد.`);refreshCooldown();return;}
    requestBusy=true;const button=sendButton();if(button)button.disabled=true;
    try{
      message('جارٍ إرسال الرمز إلى Telegram...');
      const r=await originalFetch('/api/auth/request',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:device()})}),d=await r.json().catch(()=>({}));
      if(r.status===429){const seconds=retrySeconds(r,d);cooldownUntil=Date.now()+seconds*1000;throw new Error(`تم طلب رموز عدة مرات. انتظر ${seconds} ثانية ثم أعد المحاولة مرة واحدة.`);}
      if(!r.ok)throw new Error(d.error||'تعذر إرسال الرمز');
      document.getElementById('bhOwnerCodeBox').classList.add('on');document.getElementById('bhOwnerText').textContent='وصل الرمز إلى Telegram. صالح لخمس دقائق.';button.textContent='تأكيد الدخول';button.onclick=verify;message('تم الإرسال إلى حساب المالك.',true);document.getElementById('bhOwnerCode').focus();
    }catch(error){message(error.message||'تعذر إرسال الرمز');}
    finally{requestBusy=false;refreshCooldown();}
  }
  async function verify(){
    if(verifyBusy)return;
    verifyBusy=true;const button=sendButton();if(button)button.disabled=true;
    try{
      const code=document.getElementById('bhOwnerCode').value.trim();if(!/^\d{6}$/.test(code))throw new Error('اكتب رمز Telegram المكوّن من 6 أرقام.');
      message('جارٍ التحقق من الرمز...');
      const r=await originalFetch('/api/auth/verify',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:device(),code})}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'الرمز غير صحيح');
      localStorage.setItem(USER_KEY,String(d.user?.id||''));localStorage.setItem(TOKEN_KEY,'device-session');message('تم الدخول بنجاح. سيُستكمل حفظ البيانات تلقائيًا.',true);setTimeout(()=>{gate()?.classList.remove('on');window.dispatchEvent(new CustomEvent('binhamid-owner-authenticated',{detail:{userId:String(d.user?.id||'')}}));},250);
    }catch(error){message(error.message||'تعذر التحقق من الرمز');}
    finally{verifyBusy=false;if(button)button.disabled=false;}
  }
  // `device-session` is only a browser-side transport marker. The server validates the signed HttpOnly device cookie and app-user id on every request.
  function restoreCloudMarker(){try{if(user())localStorage.setItem(TOKEN_KEY,'device-session');}catch{}}
  function install(){restoreCloudMarker();style();window.bhCloudLogin=show;const ready=()=>{if(!user())show();};setTimeout(ready,2600);console.info('[BinHamid]',VERSION,'ready');}
  install();
})();
