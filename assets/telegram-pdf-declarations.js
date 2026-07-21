// [BinHamid] 2026.07.21-telegram-pdf-declarations-v5-exact-print-registry
// كل زر «إرسال إلى تليجرام» يشغّل زر الطباعة الأصلي نفسه، ويلتقط #sheet
// لحظة استدعاء window.print؛ لذلك الملف المرسل هو نفس الملف الذي جُهز للطباعة.
(function(){
  'use strict';
  if(window.__BH_TELEGRAM_PRINT_DECLARATIONS__)return;
  window.__BH_TELEGRAM_PRINT_DECLARATIONS__=true;

  var VERSION='2026.07.21-telegram-pdf-declarations-v5-exact-print-registry';
  var nativePrint=typeof window.print==='function'?window.print.bind(window):function(){};
  var registry=new Map(),history=[],sequence=0,captureRequest=null,scanTimer=null,scanQueue=[];
  var HISTORY_KEY='binhamid_print_document_history_v1';

  function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
  function el(id){return document.getElementById(id);}
  function toast(message,kind){if(typeof window.opsToast==='function')window.opsToast(message,kind);else if(typeof window.toast==='function')window.toast(message,kind);else console[kind==='err'?'error':'info']('[Telegram PDF]',message);}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]);});}
  function absoluteUrl(value){var raw=clean(value);if(!raw||/^(?:data:|blob:|https?:|\/\/|#|javascript:)/i.test(raw))return raw;try{return new URL(raw,document.baseURI).href;}catch(_){return raw;}}
  function absoluteCss(text){return String(text||'').replace(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi,function(full,quote,value){var raw=clean(value);if(!raw||/^(?:data:|blob:|https?:|\/\/|#)/i.test(raw))return full;try{return 'url("'+new URL(raw,document.baseURI).href.replace(/"/g,'%22')+'")';}catch(_){return full;}});}
  function absoluteSrcset(value){return String(value||'').split(',').map(function(item){var parts=clean(item).split(/\s+/),url=parts.shift()||'';return [absoluteUrl(url)].concat(parts).join(' ');}).join(', ');}
  function blobToDataUrl(blob){return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(String(reader.result||''));};reader.onerror=reject;reader.readAsDataURL(blob);});}

  function collectCss(){
    var css='',links='';
    document.querySelectorAll('style').forEach(function(style){css+=style.textContent+'\n';});
    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function(link){links+='<link rel="stylesheet" href="'+escapeHtml(absoluteUrl(link.getAttribute('href')))+'">';});
    var printBlocks='',index=0;
    while(true){var start=css.indexOf('@media print',index);if(start<0)break;var brace=css.indexOf('{',start);if(brace<0)break;var depth=1,i=brace+1;while(i<css.length&&depth>0){if(css[i]==='{')depth++;else if(css[i]==='}')depth--;i++;}printBlocks+=css.slice(brace+1,i-1)+'\n';index=i;}
    return links+'<style>'+absoluteCss(css+'\n/* قواعد الطباعة مطبقة على PDF */\n'+printBlocks)+'</style>';
  }

  function titleFromSheet(fallback){var sheet=el('sheet'),heading=sheet&&sheet.querySelector('[data-document-title],h1,h2,.doc-title,.title');return clean(heading&&heading.textContent)||clean(fallback)||'نموذج من نظام بن حامد';}
  function titleFromButton(button){var own=clean(button&&button.dataset&&button.dataset.printTitle),modal=button&&button.closest&&button.closest('.mo,.ov,[role="dialog"]'),heading=modal&&modal.querySelector('h1,h2,h3');return own||clean(heading&&heading.textContent)||clean(button&&button.textContent).replace(/طباعة|اطبع/g,'').replace(/^[^\u0600-\u06FF]*/,'').trim()||'النموذج المطبوع';}

  function clonePrintSheet(title){
    var sheet=el('sheet');if(!sheet||!sheet.innerHTML||sheet.innerHTML.length<20)throw new Error('ورقة الطباعة فارغة.');
    var clone=sheet.cloneNode(true),nodes=[clone].concat(Array.from(clone.querySelectorAll('*')));
    nodes.forEach(function(node){['src','href','poster','xlink:href'].forEach(function(attr){if(node.hasAttribute&&node.hasAttribute(attr)){var value=node.getAttribute(attr);if(value)node.setAttribute(attr,absoluteUrl(value));}});if(node.hasAttribute&&node.hasAttribute('srcset'))node.setAttribute('srcset',absoluteSrcset(node.getAttribute('srcset')));if(node.hasAttribute&&node.hasAttribute('style'))node.setAttribute('style',absoluteCss(node.getAttribute('style')));});
    return{id:'print-'+Date.now().toString(36)+'-'+(++sequence),title:titleFromSheet(title),capturedAt:new Date().toISOString(),baseUrl:location.origin+'/',css:collectCss(),root:clone};
  }

  async function inlineSnapshotImages(snapshot){var images=Array.from(snapshot.root.querySelectorAll('img[src]'));await Promise.all(images.map(async function(image){var src=absoluteUrl(image.getAttribute('src'));if(!src||src.startsWith('data:')||src.startsWith('blob:'))return;try{var response=await fetch(src,{credentials:'same-origin',cache:'force-cache'});if(!response.ok)return;image.setAttribute('src',await blobToDataUrl(await response.blob()));image.removeAttribute('srcset');}catch(_){image.setAttribute('src',src);}}));return snapshot;}
  function snapshotHtml(snapshot){return snapshot.css+'<div dir="rtl" data-bh-exact-print-copy="1">'+snapshot.root.innerHTML+'</div>';}
  function saveHistory(entry){history.push(entry);if(history.length>100)history.splice(0,history.length-100);try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(-100)));}catch(_){/**/}}
  try{var stored=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(Array.isArray(stored))history=stored.slice(-100);}catch(_){/**/}
  function emitDocumentReady(snapshot,source){var detail={id:snapshot.id,title:snapshot.title,capturedAt:snapshot.capturedAt,source:source||'print',baseUrl:snapshot.baseUrl};saveHistory(detail);window.dispatchEvent(new CustomEvent('binhamid-document-ready',{detail:detail}));document.dispatchEvent(new CustomEvent('document-ready',{detail:detail}));return detail;}

  window.print=function(){var snapshot;try{snapshot=clonePrintSheet(captureRequest&&captureRequest.title);emitDocumentReady(snapshot,captureRequest?'telegram':'print');}catch(error){if(captureRequest){var request=captureRequest;captureRequest=null;request.reject(error);return;}console.warn('[BinHamid print registry]',error.message);return nativePrint();}if(captureRequest){var active=captureRequest;captureRequest=null;active.resolve(snapshot);return;}return nativePrint();};

  async function sendSnapshot(snapshot,caption,button){
    if(button){button.disabled=true;button.dataset.bhLabel=button.dataset.bhLabel||button.textContent;button.textContent='جارٍ إرسال نفس الملف…';}
    try{await inlineSnapshotImages(snapshot);var response=await fetch('/api/router?route=reports/send-telegram',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({html:snapshotHtml(snapshot),title:snapshot.title,caption:clean(caption)||snapshot.title,baseUrl:snapshot.baseUrl,documentId:snapshot.id,capturedAt:snapshot.capturedAt})});var data=await response.json().catch(function(){return{};});if(!response.ok||!data.ok)throw new Error(data.error||('HTTP '+response.status));toast('تم إرسال نفس ملف «'+snapshot.title+'» المجهز للطباعة إلى تليجرام','ok');if(button){button.textContent='✅ تم الإرسال';setTimeout(function(){button.disabled=false;button.textContent=button.dataset.bhLabel||'📤 إرسال إلى تليجرام';},2200);}return data;}catch(error){toast('تعذر إرسال الإقرار: '+error.message,'err');if(button){button.disabled=false;button.textContent=button.dataset.bhLabel||'📤 إرسال إلى تليجرام';}throw error;}
  }

  function captureByClick(printButton,title){return new Promise(function(resolve,reject){if(captureRequest)return reject(new Error('يوجد مستند آخر قيد التجهيز.'));var timer=setTimeout(function(){if(captureRequest){captureRequest=null;reject(new Error('دالة الطباعة لم تستدعِ window.print؛ لم يُرسل أي ملف قديم.'));}},7000);captureRequest={title:title,resolve:function(snapshot){clearTimeout(timer);resolve(snapshot);},reject:function(error){clearTimeout(timer);reject(error);}};try{printButton.click();}catch(error){clearTimeout(timer);captureRequest=null;reject(error);}});}
  async function sendExactPrintResult(printButton,sendButton){var title=titleFromButton(printButton);if(sendButton){sendButton.disabled=true;sendButton.dataset.bhLabel=sendButton.dataset.bhLabel||sendButton.textContent;sendButton.textContent='جارٍ تجهيز نفس ملف الطباعة…';}try{var snapshot=await captureByClick(printButton,title);await sendSnapshot(snapshot,title,sendButton);}catch(error){toast('تعذر تجهيز نفس نسخة الطباعة: '+error.message,'err');if(sendButton){sendButton.disabled=false;sendButton.textContent=sendButton.dataset.bhLabel||'📤 إرسال إلى تليجرام';}}}
  window.bhSendPrintedButtonToTelegram=sendExactPrintResult;

  function makeDocumentId(button){var explicit=clean(button.dataset.printDocument);if(explicit)return explicit;var handler=clean(button.getAttribute('onclick')).replace(/\s+/g,' ').slice(0,160),base=handler||clean(button.textContent)||'print';var hash=0;for(var i=0;i<base.length;i++)hash=((hash<<5)-hash+base.charCodeAt(i))|0;return'doc-'+Math.abs(hash).toString(36);}
  function legacyPrintCandidate(button){if(!button||button.dataset.bhTelegramSend||button.hasAttribute('data-bh-no-telegram'))return false;var text=clean(button.textContent||button.value),handler=clean(button.getAttribute('onclick'));return!/إعدادات\s*الطباعة/.test(text)&&(/طباعة|اطبع/.test(text)||(/print/i.test(handler)&&!/إرسال/.test(text)));}
  function registerPrintDocument(button,meta){if(!button||button.nodeType!==1)return null;meta=meta||{};var id=clean(meta.id)||makeDocumentId(button),title=clean(meta.title)||titleFromButton(button);button.dataset.printDocument=id;button.dataset.printTitle=title;registry.set(id,{id:id,title:title,button:button});if(button.dataset.bhTelegramPaired)return registry.get(id);button.dataset.bhTelegramPaired='1';var send=document.createElement('button');send.type='button';send.className=button.className;send.dataset.bhTelegramSend='1';send.dataset.printDocumentTarget=id;send.style.marginInlineStart='6px';send.textContent='📤 إرسال إلى تليجرام';send.onclick=function(event){event.preventDefault();event.stopPropagation();sendExactPrintResult(button,send);};button.after(send);return registry.get(id);}
  window.bhRegisterPrintDocument=registerPrintDocument;
  function migrateLegacyButtons(root){var buttons=[];if(root&&root.nodeType===1&&root.matches&&root.matches('button,input[type="button"],input[type="submit"]'))buttons.push(root);if(root&&root.querySelectorAll)buttons=buttons.concat(Array.from(root.querySelectorAll('button,input[type="button"],input[type="submit"]')));if(!root)buttons=Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"]'));buttons.forEach(function(button){if(button.hasAttribute('data-print-document')||legacyPrintCandidate(button))registerPrintDocument(button);});}
  function scheduleScan(root){if(root)scanQueue.push(root);if(scanTimer)return;scanTimer=setTimeout(function(){var roots=scanQueue.splice(0,scanQueue.length);scanTimer=null;roots.forEach(migrateLegacyButtons);},80);}
  window.bhInstallTelegramPrintButtons=function(){migrateLegacyButtons(document);};
  window.bhPrintDocumentRegistry={documents:registry,history:history,register:registerPrintDocument,captureByClick:captureByClick};

  migrateLegacyButtons(document);
  new MutationObserver(function(mutations){mutations.forEach(function(mutation){Array.prototype.forEach.call(mutation.addedNodes||[],function(node){if(node&&node.nodeType===1)scheduleScan(node);});});}).observe(document.documentElement,{childList:true,subtree:true});
  console.info('[BinHamid]',VERSION,'ready');
})();