// [BinHamid] 2026.07.21-telegram-pdf-declarations-v2-all-documents
// إرسال أي مستند مطبوع من البرنامج (إقرار الخرسانة اليومي، إقرار البلوك اليومي،
// حركة المخازن، تقرير المدير...) كملف PDF إلى تليجرام المصنع بضغطة واحدة،
// عبر المسار الموجود reports/send-telegram — دون أي تغيير على منطق الطباعة نفسه.
(function(){
  'use strict';
  var VERSION='2026.07.21-telegram-pdf-declarations-v2-all-documents';

  function el(id){return document.getElementById(id);}
  function toast(message,kind){if(typeof window.opsToast==='function')window.opsToast(message,kind);else if(typeof window.toast==='function')window.toast(message,kind);else alert(message);}

  // نجمع أنماط الصفحة نفسها حتى يخرج الـ PDF بنفس الهوية المطبوعة تمامًا.
  function collectCss(){
    var out='';
    document.querySelectorAll('style').forEach(function(style){out+=style.textContent+'\n';});
    return out;
  }

  function sheetHtml(){
    var sheet=el('sheet');
    if(!sheet||!sheet.innerHTML||sheet.innerHTML.length<20)return '';
    return '<style>'+collectCss()+'</style><div dir="rtl">'+sheet.innerHTML+'</div>';
  }

  function sendSheet(title,caption,button){
    var html=sheetHtml();
    if(!html){toast('لا يوجد مستند مجهز للإرسال. اطبع الإقرار أولًا.','err');return;}
    if(button){button.disabled=true;button.dataset.bhLabel=button.textContent;button.textContent='جارٍ التحويل والإرسال…';}
    fetch('/api/router?route=reports/send-telegram',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({html:html,title:title,caption:caption||title})
    }).then(function(response){
      return response.json().catch(function(){return{};}).then(function(data){
        if(!response.ok||!data.ok)throw new Error(data.error||('HTTP '+response.status));
        toast('📄 تم إرسال «'+title+'» PDF إلى تليجرام','ok');
        if(button)button.textContent='✅ أُرسل لتليجرام';
      });
    }).catch(function(error){
      toast('تعذر إرسال الإقرار: '+error.message,'err');
      if(button){button.disabled=false;button.textContent=button.dataset.bhLabel||'📤 إرسال PDF لتليجرام';}
    });
  }
  window.bhSendSheetToTelegram=sendSheet;

  // شريط عائم يظهر بعد تجهيز أي مستند مطبوع: زر إرسال PDF لتليجرام.
  function showFloatingBar(title){
    var bar=el('bhTgPdfBar');
    if(!bar){
      bar=document.createElement('div');bar.id='bhTgPdfBar';
      bar.style.cssText='position:fixed;bottom:18px;left:18px;z-index:99999;background:#0b2233;color:#fff;padding:10px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;max-width:92vw';
      document.body.appendChild(bar);
    }
    bar.innerHTML='';
    var label=document.createElement('span');label.textContent='«'+title+'»';label.style.cssText='font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40vw';
    var send=document.createElement('button');
    send.type='button';send.textContent='📤 إرسال PDF لتليجرام';
    send.style.cssText='background:#c9a24b;border:0;color:#0b2233;font-weight:700;padding:8px 12px;border-radius:9px;cursor:pointer';
    send.onclick=function(){sendSheet(title,title,send);};
    var close=document.createElement('button');
    close.type='button';close.textContent='✕';close.title='إخفاء';
    close.style.cssText='background:transparent;border:0;color:#fff;cursor:pointer;font-size:15px';
    close.onclick=function(){bar.remove();};
    bar.appendChild(label);bar.appendChild(send);bar.appendChild(close);
    clearTimeout(bar._bhTimer);bar._bhTimer=setTimeout(function(){if(bar.parentNode)bar.remove();},180000);
  }

  // يبني الإقرار في الورقة دون فتح نافذة الطباعة ثم يرسله مباشرة.
  function buildAndSend(kind,batchId,button){
    if(typeof window.opsPrintDailySalesDeclaration!=='function'){toast('دالة الإقرار غير متاحة','err');return;}
    var originalPrint=window.print;
    window.print=function(){};
    try{window.opsPrintDailySalesDeclaration(kind,batchId);}catch(error){window.print=originalPrint;toast('تعذر تجهيز الإقرار: '+error.message,'err');return;}
    setTimeout(function(){window.print=originalPrint;},600);
    var title='إقرار مبيعات '+(kind==='concrete'?'الخرسانة':'البلوك')+' اليومي';
    setTimeout(function(){sendSheet(title,title,button);},350);
  }
  window.bhSendDailyDeclarationPdf=buildAndSend;

  // أزرار الإرسال داخل نافذة «تم تجهيز الإقرارات اليومية» بعد استيراد التقرير اليومي.
  function injectModalButtons(batchId){
    document.querySelectorAll('.ops-btn.gold').forEach(function(printButton){
      var onclick=printButton.getAttribute('onclick')||'';
      var match=onclick.match(/opsPrintDailySalesDeclaration\('(concrete|block)'/);
      if(!match||printButton.dataset.bhTg)return;
      printButton.dataset.bhTg='1';
      var kind=match[1];
      var send=document.createElement('button');
      send.type='button';send.className=printButton.className.replace('gold','blue');
      send.style.marginInlineStart='6px';send.style.marginTop='6px';
      send.textContent='📤 '+(kind==='concrete'?'إرسال الخرسانة PDF لتليجرام':'إرسال البلوك PDF لتليجرام');
      send.onclick=function(){buildAndSend(kind,batchId,send);};
      printButton.after(send);
    });
  }

  function hook(){
    // كل نماذج النظام المطبوعة يجب أن يظهر معها زر الإرسال، لا تقرير واحد فقط:
    // الإقرارات اليومية، إقرار المبيعات، إقرار المستودع، تقرير الديزل، التقرير
    // التنفيذي، تقرير المدير، طلب الصيانة، وزيارة العميل.
    var PRINTERS=['opsPrintReport','opsPrintDailySalesDeclaration','opsPrintSalesDeclaration','opsPrintWarehouseDeclaration','opsPrintDieselReport','opsPrintExecutive','opsPrintManagerReport','opsPrintMaintenanceRequest','opsPrintVisit'];
    var TITLES={
      opsPrintDailySalesDeclaration:'إقرار المبيعات اليومي',
      opsPrintSalesDeclaration:'إقرار المبيعات',
      opsPrintWarehouseDeclaration:'إقرار المستودع',
      opsPrintDieselReport:'تقرير الديزل',
      opsPrintExecutive:'التقرير التنفيذي',
      opsPrintManagerReport:'تقرير المدير',
      opsPrintMaintenanceRequest:'طلب الصيانة',
      opsPrintVisit:'زيارة عميل'
    };
    PRINTERS.forEach(function(name){
      var original=window[name];
      if(typeof original!=='function'||original._bhTgWrapped)return;
      window[name]=function(){
        var result=original.apply(this,arguments);
        try{
          var first=arguments.length?arguments[0]:'';
          var label=(name==='opsPrintReport'&&typeof first==='string'&&first)?first:(TITLES[name]||'المستند');
          showFloatingBar(String(label));
        }catch(_){/* الشريط تحسين لا يعطل الطباعة */}
        return result;
      };
      window[name]._bhTgWrapped=true;
    });
    var originalModal=window.opsOpenImportDeclarations;
    if(typeof originalModal==='function'&&!originalModal._bhTgWrapped){
      window.opsOpenImportDeclarations=function(batchId){
        var result=originalModal.apply(this,arguments);
        try{injectModalButtons(batchId);}catch(_){/* الأزرار تحسين لا يعطل النافذة */}
        return result;
      };
      window.opsOpenImportDeclarations._bhTgWrapped=true;
    }
    return typeof originalPrintReport==='function';
  }

  var attempts=0;
  (function waitAndHook(){
    if(hook()){console.log('[BinHamid] '+VERSION+' ready');return;}
    if(++attempts>200)return;
    setTimeout(waitAndHook,100);
  })();
})();
