(function(){
  'use strict';
  if(window.__BH_CANONICAL_DECLARATION_TEXTS_INSTALLED__)return;
  window.__BH_CANONICAL_DECLARATION_TEXTS_INSTALLED__=true;
  const VERSION='2026.07.22-canonical-declaration-texts-v1';
  let saveWrapped=false;

  function canonicalReady(){
    try{return typeof DEF==='object'&&DEF&&typeof D==='object'&&D;}
    catch{return false;}
  }

  function canonicalize(){
    if(!canonicalReady())return false;
    D.txt={...DEF};
    D.txtCustom=false;
    try{if(typeof DECLARATION_TEXT_VERSION!=='undefined')D.declarationTextVersion=DECLARATION_TEXT_VERSION;}catch{}
    return true;
  }

  function hideEditor(){
    const pane=document.getElementById('p-txt');
    if(pane){pane.classList.remove('on');pane.hidden=true;pane.style.display='none';pane.setAttribute('aria-hidden','true');}
    document.querySelectorAll('#tabs button,button,a').forEach(node=>{
      const text=String(node.textContent||'').trim();
      const onclick=String(node.getAttribute?.('onclick')||'');
      if(/نصوص\s*البنود|تحرير\s*النصوص|استرجاع\s*النصوص|حفظ\s*النصوص/.test(text)||/go\(\s*['"]txt['"]\s*\)/.test(onclick)){
        node.hidden=true;
        node.style.display='none';
        node.setAttribute('aria-hidden','true');
      }
    });
  }

  function wrapSave(){
    if(saveWrapped||!canonicalReady())return;
    try{
      if(typeof save!=='function')return;
      const originalSave=save;
      save=function(){canonicalize();return originalSave.apply(this,arguments);};
      saveWrapped=true;
      canonicalize();
      originalSave();
    }catch(error){console.warn('[BinHamid canonical texts] save wrapper failed',error);}
  }

  function disableTextActions(){
    try{
      window.saveTxt=function(){canonicalize();if(typeof save==='function')save();if(typeof fillTxt==='function')fillTxt();if(typeof toast==='function')toast('النصوص الأصلية ثابتة ولا توجد نسخة بديلة.');};
      window.resetTxt=function(){canonicalize();if(typeof save==='function')save();if(typeof fillTxt==='function')fillTxt();if(typeof toast==='function')toast('النصوص الأصلية هي النسخة الوحيدة المعتمدة.');};
    }catch{}
  }

  function install(){
    if(!canonicalReady())return false;
    canonicalize();
    wrapSave();
    disableTextActions();
    hideEditor();
    try{if(typeof fillTxt==='function')fillTxt();if(typeof rAll==='function')rAll();}catch{}
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts+=1;
    if(install()||attempts>=40)clearInterval(timer);
  },250);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0));else setTimeout(install,0);
  window.addEventListener('binhamid-cloud-state-pulled',()=>setTimeout(install,0));
  window.addEventListener('storage',event=>{if(event.key==='binhamid_v1')setTimeout(install,0);});
  console.info('[BinHamid]',VERSION,'loaded');
})();
