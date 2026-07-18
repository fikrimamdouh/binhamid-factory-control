(function internalFuelControl(){
  'use strict';

  const CONTROL=Object.freeze({
    excludedVehicle:'Renault',
    excludedDriver:'فكري ممدوح',
    priceVariancePct:10,
    volumeVariancePct:50,
    rapidRefillHours:24
  });

  function normalize(value){
    if(typeof window.opsNormArabic==='function')return window.opsNormArabic(value);
    return String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');
  }

  function excluded(vehicleName,driverName){
    return normalize(vehicleName).includes(normalize(CONTROL.excludedVehicle))&&normalize(driverName).includes(normalize(CONTROL.excludedDriver));
  }

  function lockRules(){
    const settings=(typeof OPS!=='undefined'&&OPS&&OPS.settings)?OPS.settings:null;
    if(!settings)return;
    settings.fuelExcludedVehicle=CONTROL.excludedVehicle;
    settings.fuelExcludedDriver=CONTROL.excludedDriver;
    settings.fuelPriceVariancePct=CONTROL.priceVariancePct;
    settings.fuelVolumeVariancePct=CONTROL.volumeVariancePct;
    settings.fuelRapidRefillHours=CONTROL.rapidRefillHours;
  }

  function hideSettings(root=document){
    root.querySelectorAll?.('.ops-card h3').forEach(function(title){
      if(title.textContent.trim()==='إعدادات رقابة الديزل')title.closest('.ops-card')?.remove();
    });
  }

  function install(){
    lockRules();
    window.opsFuelExcludedIdentity=excluded;

    const previous=window.opsDieselControlData;
    if(typeof previous==='function'&&!previous.__binhamidInternalFuelRules){
      const guarded=function(rows){lockRules();return previous.call(this,rows);};
      guarded.__binhamidInternalFuelRules=true;
      window.opsDieselControlData=guarded;
    }

    hideSettings();
  }

  install();
  new MutationObserver(function(records){
    for(const record of records){
      if(record.addedNodes.length){lockRules();hideSettings(document);break;}
    }
  }).observe(document.documentElement,{childList:true,subtree:true});

  window.BINHAMID_INTERNAL_FUEL_CONTROL=Object.freeze({active:true});
})();
