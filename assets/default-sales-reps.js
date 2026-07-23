(function(){
'use strict';
const VERSION='2026.07.23-default-sales-reps-v6-deferred-once-only';
const TARGET_NAMES=new Set(['مسؤول مبيعات البلوك','مسؤول مبيعات الخرسانة'].map(norm));
const VEHICLE_PLATE='DGD7293',VEHICLE_MAKE='RENAULT';
const TOKEN_KEY='binhamid_cloud_access_token',USER_KEY='binhamid_cloud_app_user_id',SESSION_VERIFIED_KEY='binhamid_owner_session_verified_v1',DONE_KEY='binhamid_permanent_cleanup_dgd7293_done_v1';
const PLATE_FIELDS=['plate','plateNo','plate_no','plateNumber','plate_number','licensePlate','license_plate','registrationNo','registration_no','vehicleNo','vehicle_no','number','no','code','name','id','external_id'];
const MAKE_FIELDS=['make','brand','manufacturer','model','type','description','name'];
let running=false,tries=0,timer=null,vehicleCloudDone=false,cleanupComplete=doneBefore();
function norm(value){return String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ');}
function compact(value){return String(value??'').trim().toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g,'');}
function doneBefore(){try{return localStorage.getItem(DONE_KEY)==='1';}catch{return false;}}
function markDone(){cleanupComplete=true;vehicleCloudDone=true;try{localStorage.setItem(DONE_KEY,'1');}catch{}}
function sessionReady(){const userId=String(localStorage.getItem(USER_KEY)||'').trim();if(!userId)return false;try{return sessionStorage.getItem(SESSION_VERIFIED_KEY)===userId;}catch{return false;}}
function employeeRows(){let result=[];try{if(typeof D!=='undefined'&&D&&Array.isArray(D.emp))result=D.emp;}catch(error){console.error('[BinHamid permanent cleanup] employee roster unavailable',error);}return result;}
function vehicleRows(){let result=[];try{if(typeof D!=='undefined'&&D&&Array.isArray(D.veh))result=D.veh;}catch(error){console.error('[BinHamid permanent cleanup] vehicle roster unavailable',error);}return result;}
function headers(){const token=String(localStorage.getItem(TOKEN_KEY)||'').trim(),userId=String(localStorage.getItem(USER_KEY)||'').trim();return{'Content-Type':'application/json',...(token&&token!=='device-session'?{Authorization:'Bearer '+token}:{}),...(userId?{'X-App-User-Id':userId}:{})};}
function notify(message,bad=false){console[bad?'error':'info']('[BinHamid permanent cleanup]',message);try{if(typeof window.toast==='function')window.toast(message,bad?'err':undefined);else if(typeof window.opsToast==='function')window.opsToast(message,bad?'err':undefined);}catch(error){console.error('[BinHamid permanent cleanup] notification failed',error);}}
async function responseData(response){const text=await response.text().catch(()=>''),type=response.headers.get('content-type')||'';if(type.includes('json')||/^[\s]*[\[{]/.test(text)){try{return JSON.parse(text||'{}');}catch(error){console.error('[BinHamid permanent cleanup] invalid JSON response',error);}}return{text:text.slice(0,500),error:text.slice(0,500)};}
async function deleteEmployeeCloud(employee){const id=String(employee?.id||employee?.external_id||'').trim();if(!id)return{ok:true,localOnly:true};const response=await fetch('/api/router?route=employee-management',{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers(),body:JSON.stringify({action:'permanent_delete_employee',employeeExternalId:id,reason:'حذف نهائي لسجل موظف افتراضي'})}),data=await responseData(response);if(response.ok||response.status===404)return{ok:true};throw Object.assign(new Error(data.error||data.message||data.text||('HTTP '+response.status)),{status:response.status});}
async function deleteVehicleCloud(){const response=await fetch('/api/router?route=permanent-cleanup',{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers(),body:JSON.stringify({action:'delete_vehicle_by_plate',plate:'DGD-7293',make:'Renault'})}),data=await responseData(response);if(response.ok)return data.result||{ok:true};throw Object.assign(new Error(data.error||data.message||data.text||('HTTP '+response.status)),{status:response.status});}
function employeeTarget(employee){return TARGET_NAMES.has(norm(employee?.name||employee?.full_name));}
function vehicleTarget(vehicle){const plates=PLATE_FIELDS.map(field=>compact(vehicle?.[field])).filter(Boolean),make=MAKE_FIELDS.map(field=>compact(vehicle?.[field])).join(' '),plateMatch=plates.some(value=>value===VEHICLE_PLATE);return plateMatch&&(!make||make.includes(VEHICLE_MAKE));}
function removeRows(list,targets){let removed=0;for(const target of targets){const index=list.indexOf(target);if(index>=0){list.splice(index,1);removed++;}}return removed;}
function persistAndRedraw(){try{if(typeof window.save==='function')window.save();else if(typeof save==='function')save();}catch(error){console.error('[BinHamid permanent cleanup] local save failed',error);}try{if(typeof window.rEmp==='function')window.rEmp();if(typeof window.rVeh==='function')window.rVeh();else if(typeof rAll==='function')rAll();}catch(error){console.error('[BinHamid permanent cleanup] roster redraw failed',error);}}
async function run(){
  if(running)return{done:false,retryable:true};
  if(cleanupComplete)return{done:true};
  if(!sessionReady())return{done:false,waitingForSession:true};
  if(typeof D==='undefined'||!D)return{done:false,retryable:true};
  running=true;
  let removedEmployees=0,removedVehicles=0,retryable=false,waitingForSession=false;
  try{
    const employees=employeeRows(),employeeTargets=employees.filter(employeeTarget);
    for(const employee of employeeTargets){
      try{await deleteEmployeeCloud(employee);removedEmployees+=removeRows(employees,[employee]);}
      catch(error){if(error?.status===401||error?.status===403)waitingForSession=true;else{retryable=true;console.warn('[BinHamid permanent cleanup] employee deletion deferred',employee?.name,error?.message||error);}}
    }
    const vehicles=vehicleRows(),vehicleTargets=vehicles.filter(vehicleTarget);
    if(!vehicleCloudDone){
      try{await deleteVehicleCloud();vehicleCloudDone=true;removedVehicles+=removeRows(vehicles,vehicleTargets);}
      catch(error){if(error?.status===401||error?.status===403)waitingForSession=true;else{retryable=true;console.warn('[BinHamid permanent cleanup] vehicle deletion deferred',error?.message||error);}}
    }else removedVehicles+=removeRows(vehicles,vehicleTargets);
    if(removedEmployees||removedVehicles){persistAndRedraw();notify('تم حذف السجلين الافتراضيين وحذف DGD-7293 Renault من المعدات نهائيًا.');}
    if(!retryable&&!waitingForSession)markDone();
    return{done:!retryable&&!waitingForSession,retryable,waitingForSession};
  }finally{running=false;}
}
function schedule(delay=60_000){clearTimeout(timer);if(cleanupComplete||!sessionReady())return;timer=setTimeout(async()=>{let result={done:false,retryable:true};try{result=await run();}catch(error){console.warn('[BinHamid permanent cleanup] deferred retry',error?.message||error);}if(result.done){tries=0;return;}if(result.waitingForSession)return;if(result.retryable&&tries<2){tries++;schedule(5*60*1000);}},delay);}
window.addEventListener('binhamid-owner-session-verified',()=>schedule(60_000));
window.addEventListener('binhamid-owner-authenticated',()=>schedule(60_000));
if(sessionReady())schedule(90_000);
console.info('[BinHamid]',VERSION,'loaded — cleanup is deferred, idempotent and never runs again after confirmation');
})();
