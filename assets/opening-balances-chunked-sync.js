// [BinHamid] 2026.07.21-opening-balances-chunked-sync-v3-quota-safe
// رفع الأرصدة الافتتاحية إلى جدولها المستقل على دفعات صغيرة (250 صفًا)،
// بدل تضمينها في سجل الحالة الموحد الذي تجاوز حجمه مهلة قاعدة البيانات.
// بعد نجاح الرفع الكامل تُستثنى الأرصدة من حمولة المزامنة فيعود الحفظ خفيفًا،
// وتبقى نسخة الجهاز محفوظة محليًا كما هي.
(function(){
  'use strict';
  var VERSION='2026.07.21-opening-balances-chunked-sync-v3-quota-safe';
  var FLAG='bh_opening_externalized_v1';
  var CHUNK=250;

  function el(id){return document.getElementById(id);}
  function toastMsg(message,kind){if(typeof window.toast==='function')window.toast(message,kind);else if(typeof window.opsToast==='function')window.opsToast(message,kind);}
  function localRows(){
    // المصدر الموثوق هو التخزين المحلي (يُكتب قبل كل مزامنة)؛ متغير OPS
    // معرّف بـ let داخل الصفحة فلا يظهر على window.
    try{
      var raw=localStorage.getItem('binhamid_factory_control_v3');
      if(raw){var parsed=JSON.parse(raw);if(parsed&&Array.isArray(parsed.customerOpeningBalances)&&parsed.customerOpeningBalances.length)return parsed.customerOpeningBalances;}
    }catch(_){/* نجرب المصدر الثاني */}
    try{return(0,eval)('typeof OPS!=="undefined"&&OPS&&Array.isArray(OPS.customerOpeningBalances)?OPS.customerOpeningBalances:[]');}catch(_){return[];}
  }

  async function api(pathname,options){
    var uid=String(localStorage.getItem('binhamid_cloud_app_user_id')||'').trim();
    var tk=String(localStorage.getItem('binhamid_cloud_access_token')||'');if(tk==='device-session')tk='';
    var headers={'Content-Type':'application/json'};
    if(tk)headers.Authorization='Bearer '+tk;
    if(uid)headers['x-app-user-id']=uid;
    var deviceId=String(localStorage.getItem('binhamid_cloud_device_id')||'');
    var response=await fetch(pathname,Object.assign({credentials:'same-origin',headers:headers},options||{}));
    var data=await response.json().catch(function(){return{};});
    if(!response.ok||data.ok===false){var error=new Error(data.error||('HTTP '+response.status));error.code=data.code;throw error;}
    return data;
  }

  // تقدّم الرفع: نحفظ عدد الصفوف المرفوعة بنجاح مع بصمة مجموعة البيانات،
  // كي تستأنف أي إعادة محاولة من حيث توقفت بدل إعادة رفع كل الصفوف من الصفر
  // (كان الفشل الجزئي يعيد ٢٩٢٠ صفًا للأبد ويُجمّد الواجهة).
  var PROGRESS_KEY='bh_opening_push_progress_v1';
  var MAX_CONSECUTIVE_FAILURES=3;
  function datasetSignature(rows){
    // بصمة رخيصة تعتمد المحتوى (كود العميل + المبلغ) لا العدد فقط، كي لا تُستأنف
    // مجموعة مختلفة بنفس العدد فتُتخطى صفوف تغيّرت. تغيّر أي صف يُبطل الاستئناف.
    var h=0x811c9dc5;
    for(var i=0;i<rows.length;i++){
      var s=String(rows[i]&&rows[i].customerCode||'')+':'+String(rows[i]&&rows[i].amount||'');
      for(var j=0;j<s.length;j++){h^=s.charCodeAt(j);h=(h*0x01000193)>>>0;}
    }
    return rows.length+'-'+h.toString(16);
  }
  function progressGet(sig){
    try{var raw=localStorage.getItem(PROGRESS_KEY);if(raw){var p=JSON.parse(raw);if(p&&p.sig===sig&&isFinite(p.sent))return Math.max(0,p.sent|0);}}catch(_){/**/}
    return 0;
  }
  function progressSet(sig,sent){try{localStorage.setItem(PROGRESS_KEY,JSON.stringify({sig:sig,sent:sent}));}catch(_){/**/}}
  function progressClear(){try{localStorage.removeItem(PROGRESS_KEY);}catch(_){/**/}}

  async function pushAllChunks(reason){
    var all=localRows();
    if(!all.length)return{skipped:true};
    var total=all.length,sig=datasetSignature(all),start=progressGet(sig);
    // التقدّم مكتمل لهذه المجموعة: لا نعيد رفع أي صف.
    if(start>=total){localStorage.setItem(FLAG,'1');progressClear();return{sent:total,resumed:true};}
    var sent=start;
    toastMsg('جاري رفع '+(total-start)+' رصيد افتتاحي على دفعات...');
    for(var i=start;i<all.length;i+=CHUNK){
      var slice=all.slice(i,i+CHUNK).map(function(row){return{
        customerCode:row.customerCode,customerName:row.customerName,clientId:row.clientId,
        amount:row.amount,previous:row.previous,debit:row.debit,credit:row.credit,
        cheques:row.cheques,difference:row.difference,date:row.date,sourceFile:row.sourceFile||reason||''
      };});
      try{
        await api('/api/router?route=opening-balances',{method:'POST',body:JSON.stringify({rows:slice})});
      }catch(error){
        // نحفظ آخر تقدّم ناجح كي تستأنف المحاولة التالية من هنا لا من الصفر.
        progressSet(sig,sent);
        throw error;
      }
      sent+=slice.length;
      progressSet(sig,sent);
      if(sent<total)toastMsg('رفع الأرصدة: '+sent+' من '+total+'...');
    }
    localStorage.setItem(FLAG,'1');
    progressClear();
    toastMsg('✅ اكتمل رفع '+total+' رصيد افتتاحي إلى السحابة.');
    return{sent:sent};
  }

  var pushing=false,consecutiveFailures=0,aborted=false;
  function ensurePushed(){
    // قاطع الدائرة: بعد اكتمال الرفع (FLAG) أو بلوغ حد الفشل (aborted) لا نعيد المحاولة إطلاقًا.
    if(pushing||aborted||localStorage.getItem(FLAG)==='1')return;
    if(!localRows().length)return;
    pushing=true;
    pushAllChunks('مزامنة تلقائية').then(function(){consecutiveFailures=0;}).catch(function(error){
      consecutiveFailures++;
      if(consecutiveFailures>=MAX_CONSECUTIVE_FAILURES){
        aborted=true;
        console.error('[BinHamid] '+VERSION+' أُوقفت مزامنة الأرصدة بعد فشل متكرر:',error);
        toastMsg('⛔ أُوقفت مزامنة الأرصدة الافتتاحية بعد '+consecutiveFailures+' محاولات فاشلة. التقدّم محفوظ ولم تُفقد بيانات — اضغط «إعادة رفع الأرصدة» أو حدّث الصفحة للاستئناف.','err');
      }else{
        toastMsg('تعذر رفع الأرصدة على دفعات (محاولة '+consecutiveFailures+' من '+MAX_CONSECUTIVE_FAILURES+'): '+error.message,'err');
      }
    }).finally(function(){pushing=false;});
  }
  // الاستدعاء اليدوي يُصفّر القاطع ويستأنف من آخر تقدّم محفوظ.
  window.bhPushOpeningBalances=function(reason){aborted=false;consecutiveFailures=0;return pushAllChunks(reason);};

  // 1) بعد اعتماد ملف أرصدة جديد: الرفع على دفعات تلقائيًا.
  var originalPersist=window.opsPersist;
  function hookPersist(){
    if(typeof window.opsPersist!=='function'||window.opsPersist._bhOpb)return typeof window.opsPersist==='function';
    var inner=window.opsPersist;
    window.opsPersist=async function(reason){
      var text=String(reason||'');
      if(/أرصدة افتتاحية/.test(text)){
        aborted=false;consecutiveFailures=0; // استيراد صريح جديد يُعيد إغلاق القاطع
        try{await pushAllChunks(text);}catch(error){
          toastMsg('تعذر رفع الأرصدة على دفعات: '+error.message,'err');
          if(error.code==='OPENING_TABLE_MISSING')return inner.apply(this,arguments);
        }
      }
      return inner.apply(this,arguments);
    };
    window.opsPersist._bhOpb=true;
    return true;
  }

  // 2) تخفيف حمولة المزامنة: بعد نجاح الرفع الكامل لا تُرسل الأرصدة ضمن الحالة.
  //    (تبقى محليًا كما هي؛ فقط تُستبعد من الحمولة المرسلة للسحابة.)
  var originalFetch=window.fetch;
  window.fetch=function(input,init){
    try{
      var url=typeof input==='string'?input:String(input&&input.url||'');
      if(url.indexOf('/api/state')>=0&&init&&init.method==='PUT'&&typeof init.body==='string'&&localStorage.getItem(FLAG)!=='1'){
        // أول مزامنة تحمل أرصدة: نطلق الرفع بالدفعات فورًا في الخلفية،
        // فتُشال الأرصدة من حمولة المزامنات التالية تلقائيًا بعد اكتماله.
        try{var probe=JSON.parse(init.body);var probeRows=probe&&probe.payload&&probe.payload.ops&&probe.payload.ops.customerOpeningBalances;if(Array.isArray(probeRows)&&probeRows.length)ensurePushed();}catch(_){/**/}
      }
      if(url.indexOf('/api/state')>=0&&init&&init.method==='PUT'&&typeof init.body==='string'&&localStorage.getItem(FLAG)==='1'){
        var parsed=JSON.parse(init.body);
        var opening=parsed&&parsed.payload&&parsed.payload.ops&&parsed.payload.ops.customerOpeningBalances;
        if(Array.isArray(opening)&&opening.length){
          parsed.payload.ops.customerOpeningBalances=[];
          parsed.payload.ops.customerOpeningBalancesExternalized=true;
          init=Object.assign({},init,{body:JSON.stringify(parsed)});
        }
      }
    }catch(_){/* أي خلل في التخفيف لا يعطل المزامنة الأصلية */}
    return originalFetch.call(this,input,init);
  };

  // 3) حماية السحب: نسخة سحابية بلا أرصدة (لأنها في الجدول المستقل) لا تمسح
  //    النسخة المحلية عند التحميل.
  function freeSpace(){
    // طابور المزامنات الفاشلة يخزن نسخًا كاملة (3MB لكل محاولة) من كل فشل
    // سابق حتى امتلأت مساحة المتصفح. بعد نجاح نقل الأرصدة للجدول المستقل،
    // هذه النسخ القديمة بلا قيمة: المزامنة التالية تبني حمولة حديثة أخف.
    try{localStorage.removeItem('binhamid_cloud_pending');}catch(_){/**/}
  }
  function guardPull(){
    var K='binhamid_factory_control_v3';
    var originalSet=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      try{
        if(key===K&&localStorage.getItem(FLAG)==='1'){
          var incoming=JSON.parse(value);
          var localRaw=localStorage.getItem(K);
          if(localRaw&&incoming&&incoming.customerOpeningBalances!==undefined){
            var current=JSON.parse(localRaw);
            var localOpening=current&&Array.isArray(current.customerOpeningBalances)?current.customerOpeningBalances:[];
            var incomingOpening=Array.isArray(incoming.customerOpeningBalances)?incoming.customerOpeningBalances:[];
            if(localOpening.length&&!incomingOpening.length){
              incoming.customerOpeningBalances=localOpening;
              value=JSON.stringify(incoming);
            }
          }
        }
      }catch(_){/* الحماية تحسين ولا تعطل التخزين */}
      try{
        return originalSet.call(this,key,value);
      }catch(quotaError){
        // المساحة ممتلئة: ننظف الطابور القديم ونعيد المحاولة مرة واحدة.
        freeSpace();
        return originalSet.call(this,key,value);
      }
    };
  }
  if(localStorage.getItem(FLAG)==='1')freeSpace();

  guardPull();
  // مُركِّب opsPersist: يلتقط ظهور الدالة بسرعة ثم أي استبدال لها أثناء التحميل،
  // ويتوقف تلقائيًا بعد استقرار الربط — لا مؤقت دائم. يعتمد setTimeout لا setInterval
  // كي لا يخضع لإدارة حارس الأداء (الذي يوقف المؤقتات المتكررة عند الخمول).
  (function rehookLoop(state){
    state=state||{ticks:0,stable:0};
    var hooked=hookPersist();
    var mine=typeof window.opsPersist==='function'&&window.opsPersist._bhOpb===true;
    state.stable=(hooked&&mine)?state.stable+1:0;
    // نتوقف بعد ثبات الربط ٢٠ دورة (~٥ث) أو بعد ٦٠٠ دورة كحد أقصى صارم (~٢٫٥ دقيقة).
    if((mine&&state.stable>=20)||(++state.ticks>=600)){if(mine)console.log('[BinHamid] '+VERSION+' ready');return;}
    setTimeout(function(){rehookLoop(state);},250);
  })();
})();
