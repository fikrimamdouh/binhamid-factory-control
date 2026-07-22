(function(){
  'use strict';
  if(window.__BH_EMPLOYEE_LINK_TRANSFER_INSTALLED__)return;
  window.__BH_EMPLOYEE_LINK_TRANSFER_INSTALLED__=true;
  const VERSION='2026.07.22-employee-link-transfer-v1';
  const TOKEN_KEY='binhamid_cloud_access_token',USER_KEY='binhamid_cloud_app_user_id';
  const clean=value=>String(value??'').trim();
  const $=id=>document.getElementById(id);
  function headers(){const token=clean(localStorage.getItem(TOKEN_KEY)),userId=clean(localStorage.getItem(USER_KEY));return{'Content-Type':'application/json',...(token&&token!=='device-session'?{Authorization:`Bearer ${token}`} :{}),...(userId?{'X-App-User-Id':userId}:{})};}
  async function api(payload){const response=await fetch('/api/router?route=employee-management',{method:'POST',credentials:'same-origin',cache:'no-store',headers:headers(),body:JSON.stringify(payload)}),data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(data.error||data.message||`HTTP ${response.status}`),{status:response.status,code:data.code||''});return data.result||{};}
  function notify(message,bad=false){if(typeof window.toast==='function')window.toast(message,bad);else console[bad?'error':'info']('[Employee link transfer]',message);}
  function data(){return window.DATA&&typeof window.DATA==='object'?window.DATA:{users:[],employees:[],assignments:[],vehicles:[],sites:[]};}
  function selectedUser(){return data().users.find(row=>clean(row.id)===clean($('assignUser')?.value));}
  function currentAssignment(){const user=selectedUser();return user?data().assignments.find(row=>clean(row.app_user_id)===clean(user.id)):null;}
  function populateCurrentLink(){
    const user=selectedUser(),assignment=currentAssignment();
    if(!user)return;
    if($('assignEmployee'))$('assignEmployee').value=clean(user.employee_external_id||assignment?.employee_external_id);
    if($('assignRole'))$('assignRole').value=clean(user.role)||'employee';
    if($('assignSite'))$('assignSite').value=clean(assignment?.site_id);
    if($('assignVehicle'))$('assignVehicle').value=clean(assignment?.vehicle_external_id);
    if($('assignJob'))$('assignJob').value=clean(assignment?.job_title);
    if($('assignShift'))$('assignShift').value=clean(assignment?.shift_name);
    if($('assignActive'))$('assignActive').value=String(user.active!==false&&assignment?.active!==false);
    const status=$('bhTransferCurrentStatus');
    if(status){const employee=data().employees.find(row=>clean(row.external_id)===clean(user.employee_external_id||assignment?.employee_external_id)),vehicle=data().vehicles.find(row=>clean(row.external_id)===clean(assignment?.vehicle_external_id)),site=data().sites.find(row=>clean(row.id)===clean(assignment?.site_id));status.innerHTML=`<b>الربط الحالي:</b> ${employee?.full_name||'غير مرتبط'}${site?` — ${site.name}`:''}${vehicle?` — ${vehicle.plate_no||vehicle.asset_no||vehicle.external_id}`:''}<br><small>هوية Telegram والدور والمحادثات لن تتغير عند النقل.</small>`;}
  }
  async function transfer(button){
    const user=selectedUser(),employeeExternalId=clean($('assignEmployee')?.value),siteId=clean($('assignSite')?.value);
    if(!user)return notify('اختر مستخدم Telegram الموجود.',true);
    if(!employeeExternalId)return notify('اختر الموظف المرفوع الذي سينتقل إليه الحساب.',true);
    if(!siteId)return notify('اختر موقع العمل.',true);
    if(button)button.disabled=true;
    try{
      const result=await api({action:'transfer_telegram_employee',appUserId:user.id,employeeExternalId,siteId,vehicleExternalId:clean($('assignVehicle')?.value),jobTitle:clean($('assignJob')?.value),shiftName:clean($('assignShift')?.value),active:$('assignActive')?.value!=='false',keepVehicle:true});
      notify(`تم نقل حساب Telegram إلى ${result.employee?.fullName||'الموظف الجديد'} مع الحفاظ على الدور والمحادثات والهوية.`);
      if(typeof window.loadAll==='function')await window.loadAll(true);
    }catch(error){notify(`${error.message}${error.code?` [${error.code}]`:''}`,true);}finally{if(button)button.disabled=false;}
  }
  async function unlinkVehicle(button){const user=selectedUser(),assignment=currentAssignment();if(!user)return notify('اختر مستخدم Telegram أولًا.',true);if(!assignment?.vehicle_external_id&&!clean($('assignVehicle')?.value))return notify('لا توجد مركبة مرتبطة بهذا الموظف.',true);if(button)button.disabled=true;try{await api({action:'unlink_employee_vehicle',appUserId:user.id,employeeExternalId:assignment?.employee_external_id||user.employee_external_id,vehicleExternalId:assignment?.vehicle_external_id||clean($('assignVehicle')?.value)});if($('assignVehicle'))$('assignVehicle').value='';notify('تم فك ربط الموظف من المركبة دون تغيير حساب Telegram أو المهمة.');if(typeof window.loadAll==='function')await window.loadAll(true);}catch(error){notify(`${error.message}${error.code?` [${error.code}]`:''}`,true);}finally{if(button)button.disabled=false;}}
  async function updateTask(button){const user=selectedUser();if(!user)return notify('اختر مستخدم Telegram أولًا.',true);if(button)button.disabled=true;try{await api({action:'update_assignment_task',appUserId:user.id,jobTitle:clean($('assignJob')?.value),shiftName:clean($('assignShift')?.value)});notify('تم تحديث المهمة والوردية دون تغيير الموظف أو حساب Telegram.');if(typeof window.loadAll==='function')await window.loadAll(true);}catch(error){notify(`${error.message}${error.code?` [${error.code}]`:''}`,true);}finally{if(button)button.disabled=false;}}
  async function permanentDelete(employeeExternalId,name,button){if(!confirm(`سيختفي ${name} نهائيًا من قوائم الموظفين ولن تعيده ملفات Excel أو المزامنة. ستبقى السجلات التاريخية فقط. هل تريد المتابعة؟`))return;if(button)button.disabled=true;try{const result=await api({action:'permanent_delete_employee',employeeExternalId,reason:'حذف دائم من صفحة الحضور'});notify(`تم حذف ${name} نهائيًا من القوائم وتعطيل ${result.disabledUsers||0} حساب مرتبط.`);if(typeof window.loadAll==='function')await window.loadAll(true);}catch(error){notify(`${error.message}${error.code?` [${error.code}]`:''}`,true);}finally{if(button)button.disabled=false;}}
  function decorate(){
    const userSelect=$('assignUser'),actions=userSelect?.closest('.card')?.querySelector('.actions');
    if(!userSelect||!actions)return false;
    userSelect.removeEventListener('change',populateCurrentLink);userSelect.addEventListener('change',populateCurrentLink);
    const heading=userSelect.closest('.card')?.querySelector('h2');if(heading)heading.textContent='نقل وربط مستخدمي Telegram بالموظفين المرفوعين';
    const primary=actions.querySelector('button');if(primary){primary.textContent='نقل / تحديث الربط';primary.onclick=function(){transfer(primary);};}
    if(!$('bhTransferCurrentStatus')){const status=document.createElement('div');status.id='bhTransferCurrentStatus';status.className='note';status.style.marginTop='12px';status.innerHTML='<b>اختر مستخدم Telegram:</b> ستظهر بيانات ربطه الحالية هنا.';actions.parentElement.insertBefore(status,actions);}
    if(!$('bhUpdateAssignmentTask')){const task=document.createElement('button');task.id='bhUpdateAssignmentTask';task.type='button';task.className='btn blue';task.textContent='تغيير المهمة فقط';task.onclick=()=>updateTask(task);actions.appendChild(task);}
    if(!$('bhUnlinkEmployeeVehicle')){const unlink=document.createElement('button');unlink.id='bhUnlinkEmployeeVehicle';unlink.type='button';unlink.className='btn red';unlink.textContent='فك ربط المركبة';unlink.onclick=()=>unlinkVehicle(unlink);actions.appendChild(unlink);}
    window.deactivateEmployee=permanentDelete;
    return true;
  }
  function install(){if(!decorate())setTimeout(install,250);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  window.addEventListener('binhamid-owner-authenticated',()=>setTimeout(install,300));
  console.info('[BinHamid]',VERSION,'loaded');
})();
