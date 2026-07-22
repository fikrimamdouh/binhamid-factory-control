(function masterDataWorkspaceGuards(){
'use strict';
if(window.__BH_MASTER_WORKSPACE_GUARDS__)return;
window.__BH_MASTER_WORKSPACE_GUARDS__=true;
const VERSION='2026.07.22-master-workspace-guards-v1';
const TOKEN_KEY='binhamid_cloud_access_token',USER_KEY='binhamid_cloud_app_user_id';
let assets=new Map(),editingAssetId='';
const clean=value=>String(value??'').trim();
function headers(){const token=clean(localStorage.getItem(TOKEN_KEY)),userId=clean(localStorage.getItem(USER_KEY));return{'Content-Type':'application/json',...(token&&token!=='device-session'?{Authorization:`Bearer ${token}`} :{}),...(userId?{'X-App-User-Id':userId}:{})};}
async function refreshAssets(){try{const response=await fetch('/api/router?route=canonical-master-data',{credentials:'same-origin',cache:'no-store',headers:headers()}),data=await response.json();if(!response.ok)return;assets=new Map((data.canonicalAssets||[]).map(row=>[clean(row.canonical_external_id),row]));}catch(error){console.error('[BinHamid master workspace guards] load failed',error);}}
function ensureCurrentErp(){const row=assets.get(editingAssetId),select=document.getElementById('assetErp');if(!row?.erp_external_id||!select)return;if(![...select.options].some(option=>option.value===row.erp_external_id)){const option=document.createElement('option');option.value=row.erp_external_id;option.textContent=`الحالي — ${[row.asset_no,row.plate_no,row.asset_name].filter(Boolean).join(' — ')||row.erp_external_id}`;select.prepend(option);}select.value=row.erp_external_id;}
function applyNewAssetDefaults(){const type=document.getElementById('assetType'),diesel=document.getElementById('assetDiesel');if(!type||!diesel)return;if(type.value==='fixed_asset'){diesel.checked=false;diesel.disabled=true;}else{diesel.disabled=false;if(!editingAssetId)diesel.checked=true;}}
function install(){
  refreshAssets();
  document.addEventListener('click',event=>{
    const edit=event.target.closest?.('[data-edit-asset]');if(edit){editingAssetId=clean(edit.dataset.editAsset);setTimeout(()=>{ensureCurrentErp();applyNewAssetDefaults();},0);return;}
    if(event.target.closest?.('#addAsset,#addAsset2')){editingAssetId='';setTimeout(applyNewAssetDefaults,0);return;}
    if(event.target.closest?.('#saveAsset')){ensureCurrentErp();applyNewAssetDefaults();}
    if(event.target.closest?.('#refresh,#autoLink'))setTimeout(refreshAssets,500);
  },true);
  document.addEventListener('change',event=>{if(event.target?.id==='assetType')setTimeout(applyNewAssetDefaults,0);});
  window.addEventListener('binhamid-owner-authenticated',()=>setTimeout(refreshAssets,250));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
console.info('[BinHamid]',VERSION,'ready');
})();