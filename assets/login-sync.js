// [BinHamid] 2026.07.21-login-sync-v5-balances-always
// المزامنة عند الدخول: السيرفر هو المرجع لحظة تسجيل الدخول.
// عند نجاح الدخول برمز تليجرام، يُسحب المحتوى السحابي ويُعتمد رقم نسخته،
// فتنتهي أخطاء «توجد نسخة سحابية أحدث» (409) التي كانت توقف الحفظ، ويبدأ
// العمل من نسخة مطابقة للسيرفر. بعدها يعمل الحفظ التلقائي المعتاد.
(function(){
  'use strict';
  var VERSION='2026.07.21-login-sync-v5-balances-always';
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
        var incomingLegacy=result.payload.legacy;
        try{
          var runtimeLegacy=typeof D!=='undefined'&&D?D:null;
          var localLegacyRaw=localStorage.getItem(LEGACY_KEY),localLegacy=localLegacyRaw?JSON.parse(localLegacyRaw):null;
          var approvedLegacy=runtimeLegacy&&runtimeLegacy.declarationTextVersion==='2026-07-14-original-plus-portfolio-v1'?runtimeLegacy:(localLegacy&&localLegacy.declarationTextVersion==='2026-07-14-original-plus-portfolio-v1'?localLegacy:null);
          if(approvedLegacy&&approvedLegacy.txt){
            incomingLegacy.txt=approvedLegacy.txt;
            incomingLegacy.txtCustom=false;
            incomingLegacy.declarationTextVersion=approvedLegacy.declarationTextVersion;
          }
        }catch(_){/* لا تعطل سحب باقي البيانات */}
        localStorage.setItem(LEGACY_KEY,JSON.stringify(incomingLegacy));
        counts.clients=(incomingLegacy.cli||[]).length;
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


  // الأرصدة الافتتاحية لم تعد داخل حالة البرنامج بل في جدولها المستقل، لذلك
  // تُجلب هنا صراحةً بعد سحب الحالة وإلا ظهر كل عميل برصيد صفر في الموقع
  // بينما البوت يقرأها صحيحة من الجدول نفسه.
  async function pullOpeningBalances(){
    var result=await api('/api/router?route=opening-balances');
    var rows=result&&Array.isArray(result.rows)?result.rows:[];
    if(!rows.length)return 0;
    var mapped=rows.map(function(row){
      return{
        id:'opb-'+String(row.customer_code),
        clientId:row.client_id||'',
        customerCode:String(row.customer_code||''),
        customerName:String(row.customer_name||''),
        date:row.balance_date||'',
        amount:Number(row.balance)||0,
        previous:Number(row.previous)||0,
        debit:Number(row.debit)||0,
        credit:Number(row.credit)||0,
        cheques:Number(row.cheques)||0,
        difference:Number(row.difference)||0,
        sourceFile:row.source_file||''
      };
    });
    var raw=localStorage.getItem(OPS_KEY);
    var ops=raw?JSON.parse(raw):{};
    ops.customerOpeningBalances=mapped;
    localStorage.setItem(OPS_KEY,JSON.stringify(ops));
    return mapped.length;
  }

  function localBalanceCount(){
    try{var raw=localStorage.getItem(OPS_KEY);if(!raw)return 0;var ops=JSON.parse(raw);return Array.isArray(ops&&ops.customerOpeningBalances)?ops.customerOpeningBalances.length:0;}catch(_){return 0;}
  }
  // الأرصدة مستقلة عن سحب الحالة: تُجلب دائمًا إذا كانت ناقصة محليًا، حتى لو
  // كانت الحالة محدَّثة بالفعل. سابقًا كانت تُتخطى بعد إعادة التحميل فتبقى صفرًا.
  async function ensureBalances(){
    if(!userId()||localBalanceCount())return 0;
    try{
      var count=await pullOpeningBalances();
      if(count){notify('تم تحميل '+count+' رصيد افتتاحي من السيرفر.');if(typeof window.rAll==='function'){try{window.rAll();}catch(_){/**/}}}
      return count;
    }catch(error){console.warn('[login-sync] balances',error&&error.message);notify('تعذر تحميل الأرصدة: '+(error.message||''),true);return 0;}
  }
  window.bhLoadBalances=ensureBalances;

  async function runLoginSync(){
    if(!userId())return;
    if(sessionStorage.getItem(DONE_KEY)==='1'){await ensureBalances();return;}
    sessionStorage.setItem(DONE_KEY,'1');
    banner('جارٍ تحميل أحدث نسخة من السيرفر...');
    try{
      var outcome=await pullFromServer();
      if(outcome.empty){banner('');notify('لا توجد نسخة سحابية بعد — سيُرفع محتوى هذا الجهاز عند أول حفظ.');return;}
      var balanceCount=0;
      try{balanceCount=await pullOpeningBalances();}
      catch(balanceError){console.warn('[login-sync] opening balances',balanceError&&balanceError.message);}
      banner('');
      notify('تمت المزامنة: '+outcome.counts.clients+' عميل و'+balanceCount+' رصيد افتتاحي (نسخة '+outcome.revision+')');
      // إعادة الرسم وحدها لا تكفي: الذاكرة داخل الصفحة ما زالت تحمل النسخة
      // القديمة، وrAll ترسم منها لا من التخزين. لذلك نعيد تحميل الإطار ليقرأ
      // البرنامج التخزين المحدَّث من بدايته — مرة واحدة فقط بعد سحب ناجح.
      if(outcome.counts.clients>0){
        notify('جارٍ عرض البيانات المحدَّثة...');
        setTimeout(function(){location.reload();},900);
        return;
      }
      if(typeof window.rAll==='function'){try{window.rAll();}catch(_){location.reload();}}
    }catch(error){
      banner('');
      sessionStorage.removeItem(DONE_KEY);
      notify('تعذر التحميل من السيرفر: '+(error.message||'خطأ غير معروف'),true);
    }
  }

  window.bhLoginSync=function(){sessionStorage.removeItem(DONE_KEY);return runLoginSync();};

  // يعمل عند نجاح الدخول، وعند فتح الصفحة بجلسة سارية.
  window.addEventListener('binhamid-owner-authenticated',function(){setTimeout(runLoginSync,400);});
  function localClientCount(){
    try{var raw=localStorage.getItem(LEGACY_KEY);if(!raw)return 0;var parsed=JSON.parse(raw);return Array.isArray(parsed&&parsed.cli)?parsed.cli.length:0;}catch(_){return 0;}
  }
  // جهاز فارغ أمام سحابة مليانة = يجب السحب فورًا قبل أي محاولة حفظ.
  function start(){
    if(!userId())return;
    setTimeout(ensureBalances,2500);
    if(!localClientCount())sessionStorage.removeItem(DONE_KEY);
    runLoginSync();
    setTimeout(function(){if(userId()&&!localClientCount()){sessionStorage.removeItem(DONE_KEY);runLoginSync();}},4000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  console.info('[BinHamid]',VERSION,'ready');
})();
