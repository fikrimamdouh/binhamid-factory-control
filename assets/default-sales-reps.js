(function(){
'use strict';
const VERSION='2026.07.22-default-sales-reps-v3-permanent-cleanup';
const TARGET_NAMES=new Set(['مسؤول مبيعات البلوك','مسؤول مبيعات الخرسانة'].map(norm));
const TOKEN_KEY='binhamid_cloud_access_token',USER_KEY='binhamid_cloud_app_user_id';
let running=false,tries=0,timer=null;
function norm(value){return String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ');}
function rows(){try{return typeof D!=='undefined'&&D&&Array.isArray(D.emp)?D.emp:[]}catch{return[]}}
function headers(){const token=String(localStorage.getItem(TOKEN_KEY)||'').trim(),userId=String(localStorage.getItem(USER_KEY)||'').trim();return{'Content-Type':'application/json',...(token&&token!=='device-session'?{Authorization:'Bearer '+token}:{}),...(userId?{'X-App-User-Id':userId}:{})};}
function notify(message,bad=false){console[bad?'error':'info']('[BinHamid placeholder cleanup]',message);try{if(typeof window.toast==='function')window.toast(message,bad?'err':undefined);else if(typeof window.opsToast==='function')window.opsToast(message,bad?'err':undefined);}catch{}}
async function deleteCloud(employee){const id=String(employee?.id||employee?.external_id||'').trim();if(!id)return{ok:true,localOnly:true};const response=await fetch('/api/router?route=employee-management',{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers(),body:JSON.stringify({action:'permanent_delete_employee',employeeExternalId:id,reason:'حذف نهائي لسجل موظف افتراضي'})});const data=await response.json().catch(()=>({}));if(response.ok||response.status===404)return{ok:true};throw Object.assign(new Error(data.error||data.message||('HTTP '+response.status)),{status:response.status});}
function removeLocal(employee){const list=rows(),index=list.indexOf(employee);if(index>=0)list.splice(index,1);}
function persist(){try{if(typeof window.save==='function')window.save();else if(typeof save==='function')save();}catch(error){console.error('[BinHamid placeholder cleanup] local save failed',error);}try{if(typeof window.rEmp==='function')window.rEmp();else if(typeof rAll==='function')rAll();}catch{}}
async function run(){if(running)return false;const list=rows();if(!list.length&&typeof D==='undefined')return false;const targets=list.filter(employee=>TARGET_NAMES.has(norm(employee?.name||employee?.full_name)));if(!targets.length)return true;running=true;let removed=0,retryable=false;try{for(const employee of targets){try{await deleteCloud(employee);removeLocal(employee);removed++;}catch(error){if(error?.status===401||error?.status===403)retryable=true;else console.error('[BinHamid placeholder cleanup]',employee?.name,error);}}if(removed){persist();notify('تم حذف سجلي مسؤولي مبيعات البلوك والخرسانة الافتراضيين نهائيًا.');}return !retryable;}finally{running=false;}}
function schedule(){clearTimeout(timer);timer=setTimeout(async()=>{tries++;const done=await run().catch(error=>{console.error('[BinHamid placeholder cleanup]',error);return false;});if(!done&&tries<20)schedule();else if(!done)notify('تعذر إكمال الحذف السحابي للسجلين الافتراضيين. أعد فتح النظام بعد تأكيد الجلسة.',true);},tries?1500:300);}
window.addEventListener('binhamid-owner-session-verified',schedule);
window.addEventListener('binhamid-owner-authenticated',schedule);
schedule();
console.info('[BinHamid]',VERSION,'loaded — placeholder sales employees will only be removed, never recreated');
})();