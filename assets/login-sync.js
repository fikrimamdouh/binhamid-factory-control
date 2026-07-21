// [BinHamid] 2026.07.21-login-sync-v1
// المزامنة عند الدخول: السيرفر هو المرجع لحظة تسجيل الدخول.
// عند نجاح الدخول برمز تليجرام، يُسحب المحتوى السحابي ويُعتمد رقم نسخته،
// فتنتهي أخطاء «توجد نسخة سحابية أحدث» (409) التي كانت توقف الحفظ، ويبدأ
// العمل من نسخة مطابقة للسيرفر. بعدها يعمل الحفظ التلقائي المعتاد.
(function(){
  'use strict';
  var VERSION='2026.07.21-login-sync-v1';
  var USER_KEY='binhamid_cloud_app_user_id';
  var REV_KEY='binhamid_cloud_revision';
  var LEGACY_KEY='binhamid_v1';
  var OPS_KEY='binhamid_factory_control_v3';
  var DONE_KEY='bh_login_sync_done_v1';
  var originalFetch=window.fetch.bind(window);

  function userId(){try{return String(localStorage.getItem(USER_KEY)||'').trim();}catch(_){return'';}}
  function notify(text,isError){
    try{
      if(typeof window.toast==='function')return window.toast(text,isError?true:undefined);
      if(typeof window.opsToast==='function')return window.opsToast(text,isError?'err':undefined);
    }catch(_){/* التنبيه تحسين لا يعطل المزامنة */}
    console.info('[BinHamid login-sync]',text);
  }

  function banner(text){
    var id='bhLoginSyncBanner',el=document.getElementById(id);
    if(!text){if(el)el.remove();return;}
    if(!el){
      el=document.createElement('div');el.id=id;
      el.style.cssText='position:fixed;top:0;left:0;right:0;z-index:15000;padding:10px 14px;text-align:center;font:600 13px system-ui,sans-serif;color:#08202c;background:linear-gradient(90deg,#e9c46a,#f4d58d);box-shadow:0 2px 12px rgba(0,0,0,.2)';
      document.body.appendChild(el);
    }
    el.textContent=text;
  }

  async function api(path,options){
    var headers={'Content-Type':'application/json'};
    var uid=userId();if(uid)headers['x-app-user-id']=uid;
    var response=await originalFetch(path,Object.assign({credentials:'same-origin',headers:headers},options||{}));
    var data=await response.json().catch(function(){return{};});
    if(!response.ok){var error=new Error(data.error||('HTTP '+response.status));error.status=response.status;throw error;}
    return data;
  }

  // السحب الصامت: بلا تأكيد يدوي وبلا إعادة تحميل قسرية عند الدخول.
  async function pullFromServer(){
    var result=await api('/api/state');
    if(!result||!result.payload)return{empty:true};
    var counts={clients:0,opening:0};
    try{
      if(result.payload.legacy){
        localStorage.setItem(LEGACY_KEY,JSON.stringify(result.payload.legacy));
        counts.clients=(result.payload.legacy.cli||[]).length;
      }
      if(result.payload.ops){
        // الأرصدة تعيش في جدولها المستقل؛ لا نسمح لنسخة سحابية بلا أرصدة
        // بمسح النسخة المحلية إن وُجدت.
        var incomingOps=result.payload.ops;
        try{
          var localRaw=localStorage.getItem(OPS_KEY);
          if(localRaw){
            var localOps=JSON.parse(localRaw);
            var localOpening=localOps&&Array.isArray(localOps.customerOpeningBalances)?localOps.customerOpeningBalances:[];
            var incomingOpening=Array.isArray(incomingOps.customerOpeningBalances)?incomingOps.customerOpeningBalances:[];
            if(localOpening.length&&!incomingOpening.length)incomingOps.customerOpeningBalances=localOpening;
          }
        }catch(_){/* عند أي خلل نكتب الوارد كما هو */}
        localStorage.setItem(OPS_KEY,JSON.stringify(incomingOps));
        counts.opening=(incomingOps.customerOpeningBalances||[]).length;
      }
      // اعتماد رقم النسخة السحابي: هذا ما ينهي تعارض 409 عند أول حفظ.
      localStorage.setItem(REV_KEY,String(result.revision||0));
      localStorage.removeItem('binhamid_cloud_pending');
    }catch(error){
      if(String(error&&error.name)==='QuotaExceededError'){
        try{localStorage.removeItem('binhamid_cloud_pending');}catch(_){/**/}
        throw new Error('مساحة المتصفح ممتلئة. امسح بيانات الموقع من إعدادات المتصفح ثم أعد الدخول.');
      }
      throw error;
    }
    return{revision:result.revision,counts:counts};
  }

  async function runLoginSync(){
    if(!userId())return;
    if(sessionStorage.getItem(DONE_KEY)==='1')return;
    sessionStorage.setItem(DONE_KEY,'1');
    banner('جارٍ تحميل أحدث نسخة من السيرفر...');
    try{
      var outcome=await pullFromServer();
      if(outcome.empty){banner('');notify('لا توجد نسخة سحابية بعد — سيُرفع محتوى هذا الجهاز عند أول حفظ.');return;}
      banner('');
      notify('تمت المزامنة مع السيرفر: '+outcome.counts.clients+' عميل (نسخة رقم '+outcome.revision+')');
      // إعادة رسم الواجهة على البيانات الجديدة دون إعادة تحميل مزعجة.
      if(typeof window.rAll==='function'){try{window.rAll();}catch(_){location.reload();}}
      else location.reload();
    }catch(error){
      banner('');
      sessionStorage.removeItem(DONE_KEY);
      notify('تعذر التحميل من السيرفر: '+(error.message||'خطأ غير معروف'),true);
    }
  }

  window.bhLoginSync=function(){sessionStorage.removeItem(DONE_KEY);return runLoginSync();};

  // يعمل عند نجاح الدخول، وعند فتح الصفحة بجلسة سارية.
  window.addEventListener('binhamid-owner-authenticated',function(){setTimeout(runLoginSync,400);});
  function start(){if(userId())setTimeout(runLoginSync,1200);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  console.info('[BinHamid]',VERSION,'ready');
})();
