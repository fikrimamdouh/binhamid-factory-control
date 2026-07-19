(function(){
  'use strict';

  const TOKEN_KEY='binhamid_cloud_access_token';
  const ROLES=[
    ['pending','بانتظار الاعتماد'],
    ['admin','مدير النظام'],
    ['manager','مدير المصنع'],
    ['accountant','المحاسب'],
    ['mechanic','الميكانيكي / مسؤول الورشة'],
    ['block_sales','مبيعات البلوك'],
    ['concrete_sales','مبيعات الخرسانة'],
    ['collector','التحصيل'],
    ['driver','السائق'],
    ['employee','الموظف'],
    ['warehouse','مسؤول المخزن'],
    ['fuel_operator','مسؤول الديزل'],
    ['hr','الموارد البشرية'],
    ['procurement','المشتريات'],
    ['quality','الجودة والرقابة']
  ];
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const token=()=>localStorage.getItem(TOKEN_KEY)||'';

  function style(){
    if(document.getElementById('bh-user-role-style'))return;
    const element=document.createElement('style');
    element.id='bh-user-role-style';
    element.textContent=`
      .bh-role-modal{position:fixed;inset:0;z-index:100000;background:rgba(8,25,35,.58);display:grid;place-items:center;padding:18px}
      .bh-role-card{width:min(520px,96vw);background:#fff;border-radius:16px;padding:20px;box-shadow:0 22px 70px rgba(0,0,0,.24)}
      .bh-role-head{display:flex;gap:8px;align-items:center;border-bottom:1px solid #ece5da;padding-bottom:11px}.bh-role-head h3{margin:0;flex:1}
      .bh-role-form{display:grid;gap:11px;margin-top:15px}.bh-role-form label{display:grid;gap:5px;font-size:12px;color:#61737c}
      .bh-role-form input,.bh-role-form select{width:100%;box-sizing:border-box;border:1px solid #ccd6d8;border-radius:9px;padding:10px;font:inherit}
      .bh-role-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:15px}.bh-role-actions button,.bh-role-head button{border:0;border-radius:9px;padding:9px 13px;background:#0d7896;color:#fff;cursor:pointer;font:inherit}.bh-role-actions button.alt,.bh-role-head button{background:#465f6a}
      .bh-role-note{font-size:11px;line-height:1.7;color:#6b7d84;background:#f5f2ec;border-radius:9px;padding:9px}.bh-role-error{background:#fff0f0;color:#8b2525;padding:9px;border-radius:8px}
    `;
    document.head.appendChild(element);
  }

  async function save(externalId,fullName,role,active,nickname){
    const response=await fetch('/api/admin/users',{
      method:'POST',
      headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`}:{})},
      body:JSON.stringify({externalId,fullName,role,active,nickname})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'تعذر حفظ صلاحية المستخدم');
    return data;
  }

  function refreshCurrentPage(){
    setTimeout(()=>{
      const activeButton=document.querySelector('.bh-side button.on');
      if(activeButton&&activeButton.id!=='bhConversationsNav'&&activeButton.id!=='bhOperationsNav'&&activeButton.id!=='bhReportsNav')activeButton.click();
    },300);
  }

  function open(externalId,currentName='',currentRole='pending',currentActive=true,currentNickname=''){
    style();
    const modal=document.createElement('div');
    modal.className='bh-role-modal';
    modal.innerHTML=`<section class="bh-role-card"><div class="bh-role-head"><h3>اعتماد مستخدم Telegram</h3><button data-close>إغلاق</button></div><div class="bh-role-form"><label>Telegram ID<input id="bhRoleExternal" value="${esc(externalId)}" readonly></label><label>اسم الموظف<input id="bhRoleName" maxlength="200" value="${esc(currentName)}"></label><label>الاسم المستعار (اختياري — هذا ما يخاطب البوت الشخص به بدلاً من اسمه الكامل)<input id="bhRoleNickname" maxlength="120" placeholder="مثال: أبو فلاح" value="${esc(currentNickname)}"></label><label>الدور<select id="bhRoleSelect">${ROLES.map(([value,label])=>`<option value="${value}" ${value===currentRole?'selected':''}>${label}</option>`).join('')}</select></label><label><span><input id="bhRoleActive" type="checkbox" ${currentActive!==false?'checked':''} style="width:auto"> الحساب نشط ومسموح له باستخدام البوت</span></label><div class="bh-role-note">تغيير الدور يوقف الجلسات الحساسة القديمة تلقائيًا عند الخطوة التالية. اربط الموقع والوردية والمركبة من شاشة الحضور والسائقين.</div><div id="bhRoleResult"></div></div><div class="bh-role-actions"><button class="alt" data-close>إلغاء</button><button id="bhRoleSave">حفظ الدور</button></div></section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>modal.remove());
    modal.onclick=event=>{if(event.target===modal)modal.remove();};
    modal.querySelector('#bhRoleSave').onclick=async()=>{
      const button=modal.querySelector('#bhRoleSave'),result=modal.querySelector('#bhRoleResult');
      button.disabled=true;result.textContent='';
      try{
        await save(externalId,modal.querySelector('#bhRoleName').value.trim(),modal.querySelector('#bhRoleSelect').value,modal.querySelector('#bhRoleActive').checked,modal.querySelector('#bhRoleNickname').value.trim());
        result.innerHTML='<div class="bh-role-note">تم حفظ الدور بنجاح.</div>';
        setTimeout(()=>{modal.remove();refreshCurrentPage();},600);
      }catch(error){button.disabled=false;result.innerHTML=`<div class="bh-role-error">${esc(error.message)}</div>`;}
    };
  }

  function install(){
    if(window.bhCloudApproveUser&&window.bhCloudApproveUser.__controlledRoles)return;
    const controlled=function(externalId,currentName='',currentRole='pending',currentActive=true,currentNickname=''){return open(String(externalId||''),String(currentName||''),String(currentRole||'pending'),currentActive,String(currentNickname||''));};
    controlled.__controlledRoles=true;
    window.bhCloudApproveUser=controlled;
  }

  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(install,1000);
  install();
})();
