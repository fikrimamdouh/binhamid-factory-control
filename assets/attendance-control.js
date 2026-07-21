(function(){
  'use strict';
  const VERSION='2026.07.21-employee-attendance-sites-1';
  const TOKEN_KEY='binhamid_cloud_access_token',USER_KEY='binhamid_cloud_app_user_id';
  const PREFERRED_CODES=new Set(['FACTORY_MAIN','FACTORY-MAIN','STATION_MAIN','STATION-MAIN']);
  const state={sites:[],assignments:[],ready:false,loading:false,error:'',rendering:false,wrapped:false};

  const clean=value=>String(value??'').trim();
  function employeeRows(){try{return typeof D!=='undefined'&&Array.isArray(D.emp)?D.emp:[]}catch{return[]}}
  function headers(){
    const token=clean(localStorage.getItem(TOKEN_KEY)),userId=clean(localStorage.getItem(USER_KEY));
    return{'Content-Type':'application/json',...(token&&token!=='device-session'?{Authorization:`Bearer ${token}`} :{}),...(userId?{'x-app-user-id':userId}:{})};
  }
  async function api(path,options={}){
    const response=await fetch(path,{...options,headers:{...headers(),...(options.headers||{})}}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||data.message||`HTTP ${response.status}`),{status:response.status,code:data.code||''});
    return data;
  }
  function toastMessage(message,bad=false){
    if(typeof window.toast==='function')return window.toast(message,bad?'err':undefined);
    if(typeof window.opsToast==='function')return window.opsToast(message,bad?'err':undefined);
    console[bad?'error':'info']('[Employee attendance site]',message);
  }
  function availableSites(){
    const active=(state.sites||[]).filter(site=>site&&site.active!==false&&site.id);
    const preferred=active.filter(site=>PREFERRED_CODES.has(clean(site.code).toUpperCase()));
    return preferred.length>=2?preferred:active;
  }
  function siteLabel(site){
    const code=clean(site?.code).toUpperCase(),name=clean(site?.name);
    if(code.includes('FACTORY'))return name||'المصنع';
    if(code.includes('STATION'))return name||'المحطة';
    return name||code||'موقع عمل';
  }
  function currentSiteId(employee){return clean(employee?.attendanceSiteId||employee?.workSiteId||employee?.siteId)}
  function persistLocal(){
    try{if(typeof window.save==='function')window.save();else if(typeof save==='function')save();}catch(error){console.error('[Employee attendance site] local save failed',error);}
  }
  function migrateExistingAssignments(data){
    const employees=employeeRows(),byExternal=new Map(employees.map(employee=>[clean(employee.id||employee.external_id),employee])),siteById=new Map((data.sites||[]).map(site=>[clean(site.id),site]));
    let changed=false;
    for(const assignment of data.assignments||[]){
      const employee=byExternal.get(clean(assignment.employee_external_id)),site=siteById.get(clean(assignment.site_id));
      if(!employee||!site||currentSiteId(employee))continue;
      employee.attendanceSiteId=site.id;employee.attendanceSiteCode=site.code||'';employee.attendanceSiteName=site.name||'';changed=true;
    }
    for(const cloudEmployee of data.employees||[]){
      const employee=byExternal.get(clean(cloudEmployee.external_id)),site=siteById.get(clean(cloudEmployee.attendance_site_id));
      if(!employee||!site||currentSiteId(employee))continue;
      employee.attendanceSiteId=site.id;employee.attendanceSiteCode=site.code||'';employee.attendanceSiteName=site.name||'';changed=true;
    }
    if(changed)persistLocal();
  }
  async function load(){
    if(state.loading)return;
    state.loading=true;state.error='';
    try{
      const data=await api('/api/admin/attendance',{cache:'no-store'});
      state.sites=Array.isArray(data.sites)?data.sites:[];
      state.assignments=Array.isArray(data.assignments)?data.assignments:[];
      state.ready=true;migrateExistingAssignments(data);
    }catch(error){
      state.error=error.message||'تعذر تحميل مواقع الحضور';
      console.warn('[Employee attendance site]',error);
    }finally{
      state.loading=false;renderEmployeeSites();
    }
  }
  async function assign(employee,siteId,select){
    const previous={id:currentSiteId(employee),code:clean(employee.attendanceSiteCode),name:clean(employee.attendanceSiteName)},site=state.sites.find(row=>clean(row.id)===clean(siteId));
    employee.attendanceSiteId=clean(siteId);
    employee.attendanceSiteCode=site?.code||'';
    employee.attendanceSiteName=site?.name||'';
    persistLocal();
    if(select)select.disabled=true;
    try{
      const result=await api('/api/admin/attendance',{method:'POST',body:JSON.stringify({action:'assign_employee_site',employeeExternalId:employee.id||employee.external_id,siteId:clean(siteId)})});
      const suffix=result.linkedUsers?` وتم تحديث ${result.linkedUsers} حساب Telegram مرتبط`:' وسيُستخدم تلقائيًا عند ربط حساب Telegram';
      toastMessage(site?`تم تحديد ${siteLabel(site)} للموظف ${employee.name||''}${suffix}`:`تم إلغاء موقع الحضور للموظف ${employee.name||''}`);
    }catch(error){
      employee.attendanceSiteId=previous.id;employee.attendanceSiteCode=previous.code;employee.attendanceSiteName=previous.name;persistLocal();
      if(select)select.value=previous.id;
      toastMessage(`لم يُحفظ موقع الحضور: ${error.message}`,true);
    }finally{if(select)select.disabled=false;}
  }
  function employeeIdFromRow(row,index,visible){
    const button=row.querySelector('[onclick*="empForm"]'),onclick=button?.getAttribute('onclick')||'',match=onclick.match(/empForm\(\s*['"]([^'"]+)['"]/);
    if(match)return match[1];
    const name=clean(row.cells?.[0]?.textContent);
    return clean(visible.find(employee=>clean(employee.name)===name)?.id||visible[index]?.id);
  }
  function ensureHeader(){
    const header=document.querySelector('#p-emp table thead tr');
    if(!header||header.querySelector('#bhEmployeeAttendanceSiteHeader'))return;
    const th=document.createElement('th');th.id='bhEmployeeAttendanceSiteHeader';th.textContent='موقع الحضور';
    header.insertBefore(th,header.lastElementChild);
  }
  function ensureNote(){
    const pane=document.getElementById('p-emp'),card=pane?.querySelector('.card');
    if(!card||document.getElementById('bhEmployeeAttendanceSiteNote'))return;
    const note=document.createElement('div');note.id='bhEmployeeAttendanceSiteNote';note.className='note';
    note.style.marginBottom='13px';
    note.innerHTML='<b>موقع الحضور:</b> اختر المصنع أو المحطة بجانب الموظف. الاختيار محفوظ مع سجل الموظف ويُستخدم تلقائيًا للتحقق من الحضور والانصراف عبر Telegram.';
    const table=card.querySelector('.tw');card.insertBefore(note,table);
  }
  function renderEmployeeSites(){
    if(state.rendering)return;
    const body=document.getElementById('tEmp');
    if(!body)return;
    state.rendering=true;
    try{
      ensureHeader();ensureNote();
      const all=employeeRows(),filter=clean(document.getElementById('fEmp')?.value),visible=filter?all.filter(employee=>clean(employee.role)===filter):all,sites=availableSites(),rows=[...body.querySelectorAll(':scope > tr')];
      if(rows.length===1&&!rows[0].querySelector('[onclick*="empForm"]')){
        const cell=rows[0].cells?.[0];if(cell)cell.colSpan=Math.max(cell.colSpan||0,9);
        return;
      }
      rows.forEach((row,index)=>{
        if(row.querySelector('.bh-employee-site-cell'))return;
        const employeeId=employeeIdFromRow(row,index,visible),employee=all.find(item=>clean(item.id||item.external_id)===clean(employeeId));
        if(!employee)return;
        const cell=document.createElement('td');cell.className='bh-employee-site-cell';cell.style.minWidth='165px';
        const select=document.createElement('select');select.className='bh-employee-site-select';select.setAttribute('aria-label',`موقع حضور ${employee.name||''}`);
        select.style.cssText='min-width:150px;padding:6px 8px;font-size:12px;border-color:#d8ccb3;background:#fff;';
        const empty=document.createElement('option');empty.value='';empty.textContent=state.error?'تعذر تحميل المواقع':'— غير محدد —';select.appendChild(empty);
        for(const site of sites){const option=document.createElement('option');option.value=site.id;option.textContent=siteLabel(site);select.appendChild(option);}
        select.value=currentSiteId(employee);
        select.disabled=state.loading||Boolean(state.error);
        select.addEventListener('change',()=>assign(employee,select.value,select));
        cell.appendChild(select);
        const actionCell=row.lastElementChild;row.insertBefore(cell,actionCell);
      });
    }finally{state.rendering=false;}
  }
  function wrapEmployeeRenderer(){
    if(state.wrapped||typeof window.rEmp!=='function')return;
    state.wrapped=true;
    const original=window.rEmp;
    window.rEmp=function(){const result=original.apply(this,arguments);queueMicrotask(renderEmployeeSites);return result;};
  }
  function installAdminLink(){
    const pane=document.getElementById('p-comms');
    if(!pane||document.getElementById('bhAttendanceAdminLink'))return;
    const host=document.getElementById('bhCommsRoot')||pane,bar=document.createElement('div');
    bar.id='bhAttendanceAdminLink';
    bar.style.cssText='display:flex;gap:8px;align-items:center;justify-content:space-between;margin:0 0 12px;padding:12px 14px;border:1px solid #d6dedf;border-radius:13px;background:#f5f8f7;color:#173746;';
    bar.innerHTML='<div><b>إدارة الحضور والسائقين</b><small style="display:block;color:#637980;margin-top:3px">ربط الموظف بموقع العمل والمركبة ومراجعة الحضور والحركة والديزل</small></div><button type="button" style="border:0;border-radius:10px;padding:10px 13px;background:#173746;color:white;font-weight:800;white-space:nowrap">فتح الإدارة</button>';
    bar.querySelector('button').onclick=function(){window.open('/attendance-admin.html','_blank','noopener');};
    host.prepend(bar);
  }
  function install(){
    installAdminLink();wrapEmployeeRenderer();renderEmployeeSites();
    if(!state.ready&&!state.loading)load();
  }
  install();
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
  console.info('[BinHamid]',VERSION,'loaded');
})();