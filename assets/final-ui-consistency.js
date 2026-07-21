// [BinHamid] 2026.07.21-final-ui-consistency-v1
// يثبت ثلاث نقاط دون تغيير البيانات: إظهار الأرصدة الافتتاحية في الذاكرة والجدول،
// إرسال نفس نتيجة «طباعة النموذج» إلى Telegram، ومنع خطأ حضور اختياري من إسقاط الصفحة.
(function(){
  'use strict';
  if(window.__BH_FINAL_UI_CONSISTENCY__)return;
  window.__BH_FINAL_UI_CONSISTENCY__=true;
  var VERSION='2026.07.21-final-ui-consistency-v1';
  var OPS_KEY='binhamid_factory_control_v3';
  var previousFetch=window.fetch.bind(window);

  function clean(value){return String(value??'').trim();}
  function code(value){return clean(value).replace(/[٠-٩]/g,function(d){return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));}).replace(/\.0+$/,'').replace(/\s+/g,'').toUpperCase();}
  function norm(value){return clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');}
  function money(value){return Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}

  window.fetch=function(input,options){
    var method=String(options&&options.method||'GET').toUpperCase();
    var url=typeof input==='string'?input:String(input&&input.url||'');
    if(method==='GET'&&url.indexOf('/api/admin/attendance')>=0)input='/api/router?route=attendance-safe';
    return previousFetch(input,options);
  };

  function localOps(){try{var raw=localStorage.getItem(OPS_KEY);return raw?JSON.parse(raw):null;}catch(_){return null;}}
  function openingRows(){var local=localOps(),rows=local&&local.customerOpeningBalances;if(Array.isArray(rows)&&rows.length)return rows;try{return typeof OPS!=='undefined'&&Array.isArray(OPS.customerOpeningBalances)?OPS.customerOpeningBalances:[];}catch(_){return[];}}
  function clients(){try{return typeof D!=='undefined'&&Array.isArray(D.cli)?D.cli:[];}catch(_){return[];}}
  function rowMatchesClient(row,client){
    if(!row||!client)return false;
    if(clean(row.clientId)&&clean(row.clientId)===clean(client.id))return true;
    var rowCode=code(row.customerCode||row.customer_code),clientCodes=[client.code,client.customerCode,client.accountCode].concat(Array.isArray(client.sourceCustomerCodes)?client.sourceCustomerCodes:[]).map(code).filter(Boolean);
    if(rowCode&&clientCodes.includes(rowCode))return true;
    return norm(row.customerName||row.customer_name)&&norm(row.customerName||row.customer_name)===norm(client.name);
  }
  function openingFor(client){var matched=openingRows().filter(function(row){return rowMatchesClient(row,client);});if(matched.length)return matched.reduce(function(sum,row){return sum+Number(row.amount??row.balance??0);},0);var stored=Number(client&&client.openingBalance);return Number.isFinite(stored)?stored:0;}

  function ensureLedger(){
    var previous=window.bhClientLedger;
    if(typeof previous!=='function'||previous.__includesOpeningBalances||previous.__bhOpeningIntegrated)return false;
    var wrapped=function(clientId,requestedKind){
      var ledger=previous.apply(this,arguments);
      if(requestedKind)return ledger;
      var client=clients().find(function(item){return clean(item.id)===clean(clientId);});
      var opening=openingFor(client),net=Number(ledger&&ledger.netBalance||0)+opening;
      return Object.assign({},ledger,{openingBalance:opening,netBalance:net,remaining:Math.max(0,net),debitBalance:Math.max(0,net),creditBalance:Math.max(0,-net)});
    };
    wrapped.__includesOpeningBalances=true;wrapped.__bhOpeningIntegrated=true;window.bhClientLedger=wrapped;return true;
  }

  function patchCustomerTable(){
    ensureLedger();if(typeof window.bhClientLedger!=='function')return;
    var body=document.getElementById('tCli');if(!body)return;var all=clients();
    Array.prototype.forEach.call(body.querySelectorAll(':scope > tr'),function(row){
      if(!row.cells||row.cells.length<6)return;
      var name=clean(row.cells[0]&&row.cells[0].querySelector('b')&&row.cells[0].querySelector('b').textContent);
      var rowCode=code(row.cells[0]&&row.cells[0].querySelector('div')&&row.cells[0].querySelector('div').textContent);
      var client=all.find(function(item){return rowCode&&[item.code,item.customerCode,item.accountCode].concat(Array.isArray(item.sourceCustomerCodes)?item.sourceCustomerCodes:[]).map(code).includes(rowCode);})||all.find(function(item){return norm(item.name)===norm(name);});
      if(!client)return;
      var ledger=window.bhClientLedger(client.id),cell=row.cells[5];
      var credit=Number(ledger.creditBalance||0)?'<div style="color:#1F7A4C;font-size:11px">دائن '+money(ledger.creditBalance)+'</div>':'';
      cell.className='mono '+(Number(ledger.remaining||0)?'client-balance-positive':'client-balance-clear');cell.innerHTML=money(ledger.remaining)+credit;
    });
  }

  function wrapCustomerRenderers(){
    if(typeof window.rCli==='function'&&!window.rCli.__bhOpeningIntegrated){var originalRcli=window.rCli;window.rCli=function(){var result=originalRcli.apply(this,arguments);setTimeout(patchCustomerTable,0);return result;};window.rCli.__bhOpeningIntegrated=true;}
    if(typeof window.rAll==='function'&&!window.rAll.__bhOpeningIntegrated){var originalRall=window.rAll;window.rAll=function(){var result=originalRall.apply(this,arguments);setTimeout(patchCustomerTable,0);return result;};window.rAll.__bhOpeningIntegrated=true;}
  }

  function syncRuntimeBalances(){
    var local=localOps(),rows=local&&local.customerOpeningBalances;
    try{
      if(Array.isArray(rows)&&rows.length&&typeof OPS!=='undefined'){
        var current=Array.isArray(OPS.customerOpeningBalances)?OPS.customerOpeningBalances:[];
        var currentKey=current.length+'|'+current.reduce(function(sum,row){return sum+Number(row.amount??row.balance??0);},0);
        var localKey=rows.length+'|'+rows.reduce(function(sum,row){return sum+Number(row.amount??row.balance??0);},0);
        if(currentKey!==localKey)OPS.customerOpeningBalances=rows;
      }
      clients().forEach(function(client){var value=openingFor(client);if(value||client.openingBalance!==undefined)client.openingBalance=value;});
    }catch(_){ }
    ensureLedger();wrapCustomerRenderers();patchCustomerTable();
  }

  function documentTitle(button){var modal=button.closest('.mo,.ov,[role="dialog"]');var heading=modal&&modal.querySelector('h1,h2,h3');return clean(heading&&heading.textContent)||'النموذج المطبوع';}
  function sendExactPrintResult(printButton,sendButton){
    if(typeof window.bhSendSheetToTelegram!=='function'){if(typeof window.toast==='function')window.toast('خدمة إرسال PDF لم تكتمل بعد. أعد المحاولة بعد لحظة.','err');return;}
    var originalPrint=window.print,title=documentTitle(printButton);sendButton.disabled=true;sendButton.dataset.bhLabel=sendButton.textContent;sendButton.textContent='جارٍ تجهيز نفس النموذج…';window.print=function(){};
    try{printButton.click();}catch(error){window.print=originalPrint;sendButton.disabled=false;sendButton.textContent=sendButton.dataset.bhLabel;throw error;}
    setTimeout(function(){window.print=originalPrint;var floating=document.getElementById('bhTgPdfBar');if(floating)floating.remove();window.bhSendSheetToTelegram(title,title,sendButton);},450);
  }
  function injectDirectTelegramButtons(){
    Array.prototype.forEach.call(document.querySelectorAll('button'),function(button){
      if(button.dataset.bhExactTelegram||button.id==='bhTgPdfBar')return;
      var label=clean(button.textContent);if(!/طباعة\s*النموذج/.test(label))return;
      button.dataset.bhExactTelegram='1';var send=document.createElement('button');send.type='button';send.className=button.className;send.style.marginInlineStart='6px';send.textContent='📤 إرسال إلى تليجرام';send.dataset.bhExactTelegram='1';send.onclick=function(event){event.preventDefault();event.stopPropagation();sendExactPrintResult(button,send);};button.after(send);
    });
  }

  function install(){syncRuntimeBalances();injectDirectTelegramButtons();}
  var timer=setInterval(install,750);setTimeout(function(){clearInterval(timer);install();},30000);
  new MutationObserver(function(){install();}).observe(document.documentElement,{childList:true,subtree:true});
  console.info('[BinHamid]',VERSION,'ready');
})();
