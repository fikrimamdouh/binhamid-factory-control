(function(){
  'use strict';
  if(window.__BH_CANONICAL_DECLARATION_TEXTS_INSTALLED__)return;
  window.__BH_CANONICAL_DECLARATION_TEXTS_INSTALLED__=true;

  const VERSION='2026.07.22-canonical-declaration-texts-v2-explicit-custom-only';
  const MANUAL_SOURCE='manual-v2';
  const BASE_SOURCE='base-v2';
  let saveWrapped=false;
  let textActionsWrapped=false;
  let migrationPersisted=false;
  let explicitTextSave=false;

  function ready(){
    try{return typeof DEF==='object'&&DEF&&typeof D==='object'&&D;}
    catch{return false;}
  }

  function isManualCustom(){
    return Boolean(D?.txtCustom===true&&D?.txtCustomSource===MANUAL_SOURCE);
  }

  function activateBase(){
    if(!ready())return false;
    D.txt={...DEF};
    D.txtCustom=false;
    D.txtCustomSource=BASE_SOURCE;
    try{if(typeof DECLARATION_TEXT_VERSION!=='undefined')D.declarationTextVersion=DECLARATION_TEXT_VERSION;}catch{}
    return true;
  }

  function showEditor(){
    const pane=document.getElementById('p-txt');
    if(pane){pane.hidden=false;pane.removeAttribute('aria-hidden');if(pane.style.display==='none')pane.style.removeProperty('display');}
    document.querySelectorAll('#tabs button,button,a').forEach(node=>{
      const text=String(node.textContent||'').trim();
      const onclick=String(node.getAttribute?.('onclick')||'');
      if(/نصوص\s*البنود|تحرير\s*النصوص|استرجاع\s*النصوص|حفظ\s*النصوص/.test(text)||/go\(\s*['"]txt['"]\s*\)/.test(onclick)){
        node.hidden=false;
        node.removeAttribute('aria-hidden');
        if(node.style.display==='none')node.style.removeProperty('display');
      }
    });
  }

  function persistBaseOnce(originalSave){
    if(migrationPersisted||isManualCustom())return;
    migrationPersisted=true;
    activateBase();
    try{originalSave();}catch(error){console.warn('[BinHamid declaration texts] base migration save failed',error);}
  }

  function wrapSave(){
    if(saveWrapped||!ready())return;
    try{
      if(typeof save!=='function')return;
      const originalSave=save;
      save=function(){
        if(!explicitTextSave&&!isManualCustom())activateBase();
        return originalSave.apply(this,arguments);
      };
      saveWrapped=true;
      persistBaseOnce(originalSave);
    }catch(error){console.warn('[BinHamid declaration texts] save wrapper failed',error);}
  }

  function wrapTextActions(){
    if(textActionsWrapped||!ready())return;
    const originalSaveTxt=typeof window.saveTxt==='function'?window.saveTxt:null;
    const originalFillTxt=typeof window.fillTxt==='function'?window.fillTxt:null;

    window.saveTxt=function(){
      if(!ready())return;
      D.txtCustom=true;
      D.txtCustomSource=MANUAL_SOURCE;
      explicitTextSave=true;
      try{
        if(originalSaveTxt)originalSaveTxt.apply(this,arguments);
        else if(typeof save==='function')save();
        D.txtCustom=true;
        D.txtCustomSource=MANUAL_SOURCE;
        if(typeof save==='function')save();
        if(typeof toast==='function')toast('تم حفظ تعديلك اليدوي على نصوص البنود.');
      }finally{explicitTextSave=false;}
    };

    window.resetTxt=function(){
      if(!ready())return;
      explicitTextSave=true;
      try{
        activateBase();
        if(typeof save==='function')save();
        if(originalFillTxt)originalFillTxt();
        if(typeof rAll==='function')rAll();
        if(typeof toast==='function')toast('تم الرجوع إلى النسخة الأساسية المعتمدة.');
      }finally{explicitTextSave=false;}
    };

    textActionsWrapped=true;
  }

  function install(){
    if(!ready())return false;
    if(!isManualCustom())activateBase();
    wrapSave();
    wrapTextActions();
    showEditor();
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
  console.info('[BinHamid]',VERSION,'loaded — base text is default; custom text requires explicit save');
})();