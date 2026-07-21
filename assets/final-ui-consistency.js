// [BinHamid] 2026.07.21-final-ui-consistency-v4-balances-attendance-only
// يثبت الأرصدة ومسار الحضور فقط. كل الطباعة والإرسال إلى تليجرام مملوكان
// حصريًا لـ telegram-pdf-declarations.js لمنع تكرار الأزرار أو إرسال ورقة قديمة.
(function(){
  'use strict';
  if(window.__BH_FINAL_UI_CONSISTENCY__)return;
  window.__BH_FINAL_UI_CONSISTENCY__=true;
  var VERSION='2026.07.21-final-ui-consistency-v4-balances-attendance-only';
  var OPS_KEY='binhamid_factory_control_v3';
  var previousFetch=window.fetch.bind(window);
  var installing=false,installTimer=null;
  var balanceCache={key:'',byClientId:new Map(),byCode:new Map(),byName:new Map()};
  var clientCache={ref:null,length:-1,byId:new Map(),byCode:new Map(),byName:new Map()};

  function clean(value){return String(value??'').trim();}
  function code(value){return clean(value).replace(/[٠-٩]/g,function(d){return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));}).replace(/\.0+$/,'').replace(/\s+/g,'').toUpperCase();}
  function norm(value){return clean(value).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');}
  function money(value){return Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}

  window.fetch=function(input,options){var method=String(options&&options.method||'GET').toUpperCase(),url=typeof input==='string'?input:String(input&&input.url||'');if(method==='GET'&&url.indexOf('/api/admin/attendance')>=0)input='/api/router?route=attendance-safe';return previousFetch(input,options);};

  function localOps(){try{var raw=localStorage.getItem(OPS_KEY);return raw?JSON.parse(raw):null;}catch(_){return null;}}
  function openingRows(){try{if(typeof OPS!=='undefined'&&Array.isArray(OPS.customerOpeningBalances)&&OPS.customerOpeningBalances.length)return OPS.customerOpeningBalances;}catch(_){}var local=localOps();return Array.isArray(local&&local.customerOpeningBalances)?local.customerOpeningBalances:[];}
  function clients(){try{return typeof D!=='undefined'&&Array.isArray(D.cli)?D.cli:[];}catch(_){return[];}}
  function addAmount(map,key,amount){if(!key)return;map.set(key,Number(map.get(key)||0)+Number(amount||0));}
  function balanceKey(rows){var first=rows[0]||{},last=rows[rows.length-1]||{};return[rows.length,first.updatedAt||first.balanceDate||first.id||'',last.updatedAt||last.balanceDate||last.id||'',rows.reduce(function(sum,row){return sum+Number(row.amount??row.balance??0);},0)].join('|');}
  function ensureBalanceIndex(){var rows=openingRows(),key=balanceKey(rows);if(balanceCache.key===key)return balanceCache;var byClientId=new Map(),byCode=new Map(),byName=new Map();rows.forEach(function(row){var amount=Number(row.amount??row.balance??0);addAmount(byClientId,clean(row.clientId),amount);addAmount(byCode,code(row.customerCode||row.customer_code),amount);addAmount(byName,norm(row.customerName||row.customer_name),amount);});balanceCache={key:key,byClientId:byClientId,byCode:byCode,byName:byName};return balanceCache;}
  function ensureClientIndex(){var rows=clients();if(clientCache.ref===rows&&clientCache.length===rows.length)return clientCache;var byId=new Map(),byCode=new Map(),byName=new Map();rows.forEach(function(client){byId.set(clean(client.id),client);[client.code,client.customerCode,client.accountCode].concat(Array.isArray(client.sourceCustomerCodes)?client.sourceCustomerCodes:[]).map(code).filter(Boolean).forEach(function(key){if(!byCode.has(key))byCode.set(key,client);});var name=norm(client.name);if(name&&!byName.has(name))byName.set(name,client);});clientCache={ref:rows,length:rows.length,byId:byId,byCode:byCode,byName:byName};return clientCache;}
  function openingFor(client){if(!client)return 0;var index=ensureBalanceIndex(),id=clean(client.id);if(id&&index.byClientId.has(id))return Number(index.byClientId.get(id)||0);var codes=[client.code,client.customerCode,client.accountCode].concat(Array.isArray(client.sourceCustomerCodes)?client.sourceCustomerCodes:[]).map(code).filter(Boolean);for(var i=0;i<codes.length;i++)if(index.byCode.has(codes[i]))return Number(index.byCode.get(codes[i])||0);var name=norm(client.name);if(name&&index.byName.has(name))return Number(index.byName.get(name)||0);var stored=Number(client.openingBalance);return Number.isFinite(stored)?stored:0;}

  function ensureLedger(){var previous=window.bhClientLedger;if(typeof previous!=='function'||previous.__includesOpeningBalances||previous.__bhOpeningIntegrated)return false;var wrapped=function(clientId,requestedKind){var ledger=previous.apply(this,arguments);if(requestedKind)return ledger;var client=ensureClientIndex().byId.get(clean(clientId)),opening=openingFor(client),net=Number(ledger&&ledger.netBalance||0)+opening;return Object.assign({},ledger,{openingBalance:opening,netBalance:net,remaining:Math.max(0,net),debitBalance:Math.max(0,net),creditBalance:Math.max(0,-net)});};wrapped.__includesOpeningBalances=true;wrapped.__bhOpeningIntegrated=true;window.bhClientLedger=wrapped;return true;}
  function patchCustomerTable(){ensureLedger();if(typeof window.bhClientLedger!=='function')return;var body=document.getElementById('tCli');if(!body)return;var index=ensureClientIndex();Array.prototype.forEach.call(body.querySelectorAll(':scope > tr'),function(row){if(!row.cells||row.cells.length<6)return;var name=norm(row.cells[0]&&row.cells[0].querySelector('b')&&row.cells[0].querySelector('b').textContent),rowCode=code(row.cells[0]&&row.cells[0].querySelector('div')&&row.cells[0].querySelector('div').textContent),client=index.byCode.get(rowCode)||index.byName.get(name);if(!client)return;var ledger=window.bhClientLedger(client.id),cell=row.cells[5],credit=Number(ledger.creditBalance||0)?'<div style="color:#1F7A4C;font-size:11px">دائن '+money(ledger.creditBalance)+'</div>':'',nextClass='mono '+(Number(ledger.remaining||0)?'client-balance-positive':'client-balance-clear'),nextHtml=money(ledger.remaining)+credit;if(cell.className!==nextClass)cell.className=nextClass;if(cell.innerHTML!==nextHtml)cell.innerHTML=nextHtml;});}
  function wrapCustomerRenderers(){if(typeof window.rCli==='function'&&!window.rCli.__bhOpeningIntegrated){var originalRcli=window.rCli;window.rCli=function(){var result=originalRcli.apply(this,arguments);scheduleInstall();return result;};window.rCli.__bhOpeningIntegrated=true;}if(typeof window.rAll==='function'&&!window.rAll.__bhOpeningIntegrated){var originalRall=window.rAll;window.rAll=function(){var result=originalRall.apply(this,arguments);scheduleInstall();return result;};window.rAll.__bhOpeningIntegrated=true;}}
  function syncRuntimeBalances(){var local=localOps(),rows=local&&local.customerOpeningBalances;try{if(Array.isArray(rows)&&rows.length&&typeof OPS!=='undefined'&&(!Array.isArray(OPS.customerOpeningBalances)||!OPS.customerOpeningBalances.length))OPS.customerOpeningBalances=rows;}catch(_){}ensureBalanceIndex();ensureClientIndex();ensureLedger();wrapCustomerRenderers();patchCustomerTable();}
  function install(){if(installing)return;installing=true;try{syncRuntimeBalances();}finally{installing=false;}}
  function scheduleInstall(){if(installTimer)return;installTimer=setTimeout(function(){installTimer=null;install();},80);}

  install();
  new MutationObserver(function(mutations){var needsBalances=false;mutations.forEach(function(mutation){Array.prototype.forEach.call(mutation.addedNodes||[],function(node){if(node&&node.nodeType===1&&(node.id==='tCli'||node.querySelector&&node.querySelector('#tCli')))needsBalances=true;});});if(needsBalances)scheduleInstall();}).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('storage',function(event){if(event.key===OPS_KEY){balanceCache.key='';scheduleInstall();}});
  console.info('[BinHamid]',VERSION,'ready');
})();