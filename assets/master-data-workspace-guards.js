(function masterDataWorkspaceGuards(){
'use strict';
if(window.__BH_MASTER_WORKSPACE_GUARDS__)return;
window.__BH_MASTER_WORKSPACE_GUARDS__=true;
const VERSION='2026.07.22-master-workspace-guards-v2-cloud-save-verification';
const TOKEN_KEY='binhamid_cloud_access_token',USER_KEY='binhamid_cloud_app_user_id';
let assets=new Map(),editingAssetId='',editingEmployeeId='',saving=false;
const clean=value=>String(value??'').trim();
const digits=value=>clean(value).replace(/\D/g,'');
const plate=value=>clean(value).toUpperCase().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^A-Z0-9\u0600-\u06FF]/g,'');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const value=id=>clean(document.getElementById(id)?.value);
function headers(){const token=clean(localStorage.getItem(TOKEN_KEY)),userId=clean(localStorage.getItem(USER_KEY));return{'Content-Type':'application/json',...(token&&token!=='device-session'?{Authorization:`Bearer ${token}`} :{}),...(userId?{'X-App-User-Id':userId}:{})};}
function message(text,type=''){const el=document.getElementById('message');if(!el)return;el.className=`notice ${type}`;el.textContent=text;}
function stableId(prefix,current){if(current)return current;const uuid=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;return`${prefix}-web-${uuid}`;}
async function json(response){try{return await response.json();}catch{return{};}}
async function cloudRequest(payload,attempts=3){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    try{
      const response=await fetch('/api/router?route=canonical-master-data',{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers(),body:JSON.stringify(payload),signal:controller.signal}),data=await json(response);
      if(response.ok)return data;
      const error=Object.assign(new Error(data.error||data.message||`تعذر الحفظ السحابي HTTP ${response.status}`),{status:response.status,code:data.code||''});
      if(![408,409,425,429,500,502,503,504].includes(response.status)||attempt===attempts)throw error;
      lastError=error;
    }catch(error){lastError=error;if(attempt===attempts||(!/AbortError|network|fetch|failed|timeout/i.test(`${error.name} ${error.message}`)&&!error.status))throw error;}
    finally{clearTimeout(timer);}
    await sleep(450*attempt);
  }
  throw lastError||new Error('تعذر الحفظ السحابي.');
}
async function cloudRead(){
  const response=await fetch(`/api/router?route=canonical-master-data&verify=${Date.now()}`,{credentials:'same-origin',cache:'no-store',headers:headers()}),data=await json(response);
  if(!response.ok)throw Object.assign(new Error(data.error||'تعذر التأكد من الحفظ السحابي.'),{status:response.status,code:data.code||''});
  assets=new Map((data.canonicalAssets||[]).map(row=>[clean(row.canonical_external_id),row]));
  return data;
}
async function refreshAssets(){try{await cloudRead();}catch(error){console.error('[BinHamid master workspace guards] load failed',error);}}
function ensureCurrentErp(){const row=assets.get(editingAssetId),select=document.getElementById('assetErp');if(!row?.erp_external_id||!select)return;if(![...select.options].some(option=>option.value===row.erp_external_id)){const option=document.createElement('option');option.value=row.erp_external_id;option.textContent=`الحالي — ${[row.asset_no,row.plate_no,row.asset_name].filter(Boolean).join(' — ')||row.erp_external_id}`;select.prepend(option);}select.value=row.erp_external_id;}
function applyNewAssetDefaults(){const type=document.getElementById('assetType'),diesel=document.getElementById('assetDiesel');if(!type||!diesel)return;if(type.value==='fixed_asset'){diesel.checked=false;diesel.disabled=true;}else{diesel.disabled=false;if(!editingAssetId)diesel.checked=true;}}
function employeePayload(){return{action:'save_employee',employeeExternalId:stableId('emp',editingEmployeeId),fullName:value('empName'),nationalId:value('empNational'),employeeNo:value('empNo'),phone:value('empPhone'),role:value('empRole'),workStatus:value('empStatus')||'working',costCenterCode:value('empCenter'),vehicleExternalId:value('empVehicle'),siteId:value('empSite'),site:value('empSiteText'),telegramUserId:value('empTelegram')};}
function assetPayload(){ensureCurrentErp();applyNewAssetDefaults();return{action:'save_asset',assetExternalId:stableId('asset',editingAssetId),assetType:value('assetType')||'vehicle',operationalStatus:value('assetStatus')||'in_service',plateNo:value('assetPlate'),assetNo:value('assetNo'),assetName:value('assetName'),make:value('assetMake'),model:value('assetModel'),employeeExternalId:value('assetEmployee'),costCenterCode:value('assetCenter'),erpExternalId:value('assetErp'),dieselExpected:Boolean(document.getElementById('assetDiesel')?.checked)};}
function employeeMismatches(data,payload){
  const row=(data.canonicalEmployees||[]).find(item=>clean(item.external_id)===payload.employeeExternalId);if(!row)return['السجل غير موجود بعد الحفظ'];const missing=[];
  if(clean(row.full_name)!==payload.fullName)missing.push('الاسم');if(payload.nationalId&&digits(row.national_id)!==digits(payload.nationalId))missing.push('الهوية');if(clean(row.employee_no)!==payload.employeeNo)missing.push('الرقم الوظيفي');if(clean(row.phone)!==payload.phone)missing.push('الجوال');if(clean(row.role)!==payload.role)missing.push('الوظيفة');if(clean(row.work_status)!==payload.workStatus)missing.push('الحالة');if(clean(row.cost_center_code)!==payload.costCenterCode)missing.push('مركز التكلفة');if(clean(row.vehicle_external_id)!==payload.vehicleExternalId)missing.push('السيارة');if(clean(row.telegram?.id)!==payload.telegramUserId)missing.push('Telegram');return missing;
}
function assetMismatches(data,payload){
  const row=(data.canonicalAssets||[]).find(item=>clean(item.canonical_external_id)===payload.assetExternalId);if(!row)return['السجل غير موجود بعد الحفظ'];const missing=[];
  if(clean(row.asset_type)!==payload.assetType)missing.push('نوع الأصل');if((clean(row.operational_status)==='in_service'?'in_service':'stopped')!==payload.operationalStatus)missing.push('الحالة');if(plate(row.plate_no)!==plate(payload.plateNo))missing.push('اللوحة');if(clean(row.asset_no)!==payload.assetNo)missing.push('رقم الأصل');if(clean(row.asset_name)!==payload.assetName)missing.push('الوصف');if(clean(row.make)!==payload.make)missing.push('الماركة');if(clean(row.model)!==payload.model)missing.push('الموديل');if(clean(row.employee_external_id)!==payload.employeeExternalId)missing.push('الموظف');if(clean(row.cost_center_code)!==payload.costCenterCode)missing.push('مركز التكلفة');if(clean(row.erp_external_id)!==payload.erpExternalId)missing.push('ربط ERP');return missing;
}
async function saveAndVerify(kind,button){
  if(saving)return;saving=true;button.disabled=true;const payload=kind==='employee'?employeePayload():assetPayload(),label=kind==='employee'?'الموظف':'الأصل';message(`جاري حفظ ${label} في السحابة والتحقق منه...`);
  try{
    let mismatches=['لم يتم التحقق'];
    for(let attempt=1;attempt<=3;attempt++){
      await cloudRequest(payload,attempt===1?3:2);await sleep(250*attempt);const data=await cloudRead();mismatches=kind==='employee'?employeeMismatches(data,payload):assetMismatches(data,payload);if(!mismatches.length)break;if(attempt<3){message(`تم إرسال الحفظ، وجارٍ تثبيت ${mismatches.join('، ')}...`);await sleep(500*attempt);}
    }
    if(mismatches.length)throw Object.assign(new Error(`وصل الحفظ جزئيًا ولم تتأكد الحقول التالية: ${mismatches.join('، ')}. لم تُغلق النافذة حتى لا تفقد التعديل.`),{code:'CLOUD_SAVE_NOT_CONFIRMED'});
    document.getElementById(kind==='employee'?'employeeModal':'assetModal')?.classList.remove('on');if(kind==='employee')editingEmployeeId=payload.employeeExternalId;else editingAssetId=payload.assetExternalId;message(`تم حفظ ${label} في السحابة والتأكد من جميع البيانات.`, 'ok');setTimeout(()=>document.getElementById('refresh')?.click(),250);
  }catch(error){message(`${error.message}${error.code?` [${error.code}]`:''}`,'error');}
  finally{saving=false;button.disabled=false;}
}
function install(){
  refreshAssets();
  document.addEventListener('click',event=>{
    const editEmployee=event.target.closest?.('[data-edit-employee]');if(editEmployee){editingEmployeeId=clean(editEmployee.dataset.editEmployee);return;}
    if(event.target.closest?.('#addEmployee,#addEmployee2')){editingEmployeeId='';return;}
    const editAsset=event.target.closest?.('[data-edit-asset]');if(editAsset){editingAssetId=clean(editAsset.dataset.editAsset);setTimeout(()=>{ensureCurrentErp();applyNewAssetDefaults();},0);return;}
    if(event.target.closest?.('#addAsset,#addAsset2')){editingAssetId='';setTimeout(applyNewAssetDefaults,0);return;}
    const saveEmployee=event.target.closest?.('#saveEmployee');if(saveEmployee){event.preventDefault();event.stopImmediatePropagation();saveAndVerify('employee',saveEmployee);return;}
    const saveAsset=event.target.closest?.('#saveAsset');if(saveAsset){event.preventDefault();event.stopImmediatePropagation();saveAndVerify('asset',saveAsset);return;}
    if(event.target.closest?.('#refresh,#autoLink'))setTimeout(refreshAssets,500);
  },true);
  document.addEventListener('change',event=>{if(event.target?.id==='assetType')setTimeout(applyNewAssetDefaults,0);});
  window.addEventListener('binhamid-owner-authenticated',()=>setTimeout(refreshAssets,250));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
console.info('[BinHamid]',VERSION,'ready — cloud writes are read back and verified');
})();