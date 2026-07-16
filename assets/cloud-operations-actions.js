(function(){
  'use strict';

  const TOKEN_KEY='binhamid_cloud_access_token';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));

  function token(){
    return localStorage.getItem(TOKEN_KEY)||'';
  }

  async function api(input){
    const response=await fetch('/api/operations',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        ...(token()?{Authorization:`Bearer ${token()}`}:{})
      },
      body:JSON.stringify(input)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'تعذر تنفيذ الإجراء');
    return data;
  }

  function modal(title,html){
    const element=document.createElement('div');
    element.className='bh-ops-modal';
    element.innerHTML=`<div class="bh-ops-modal-card"><div class="bh-ops-modal-head"><h3>${esc(title)}</h3><button data-close>إغلاق</button></div>${html}</div>`;
    document.body.appendChild(element);
    element.querySelector('[data-close]').onclick=()=>element.remove();
    element.onclick=event=>{if(event.target===element)element.remove();};
    return element;
  }

  function addTaskButton(){
    const top=document.querySelector('.bh-ops-top');
    if(!top||document.getElementById('bhOpsNewTask'))return;
    const button=document.createElement('button');
    button.id='bhOpsNewTask';
    button.textContent='مهمة جديدة';
    button.onclick=()=>{
      const dialog=modal('إنشاء مهمة إدارية',`<div class="bh-ops-form"><label>العنوان<input id="bhTaskTitle"></label><label>التفاصيل<textarea id="bhTaskDescription"></textarea></label><label>المسؤول<input id="bhTaskAssignee"></label><label>القسم<select id="bhTaskDepartment"><option value="general">عام</option><option value="sales">المبيعات</option><option value="workshop">الورشة</option><option value="finance">المالية</option><option value="warehouse">المخزن</option><option value="procurement">المشتريات</option><option value="quality">الجودة</option><option value="hr">الموارد البشرية</option><option value="fleet">الأسطول</option></select></label><label>الأولوية<select id="bhTaskPriority"><option value="normal">عادي</option><option value="urgent">عاجل</option><option value="critical">حرج</option></select></label><label>الموعد<input id="bhTaskDue" type="datetime-local"></label><button id="bhTaskSave">حفظ المهمة</button><div id="bhTaskResult"></div></div>`);
      dialog.querySelector('#bhTaskSave').onclick=async()=>{
        try{
          const data=await api({
            action:'create_task',
            title:dialog.querySelector('#bhTaskTitle').value,
            description:dialog.querySelector('#bhTaskDescription').value,
            assignedTo:dialog.querySelector('#bhTaskAssignee').value,
            department:dialog.querySelector('#bhTaskDepartment').value,
            priority:dialog.querySelector('#bhTaskPriority').value,
            dueDate:dialog.querySelector('#bhTaskDue').value
          });
          dialog.querySelector('#bhTaskResult').innerHTML=`<p>تم إنشاء المهمة <b>${esc(data.reference)}</b></p>`;
          setTimeout(()=>{
            dialog.remove();
            document.getElementById('bhOpsRefresh')?.click();
          },700);
        }catch(error){
          dialog.querySelector('#bhTaskResult').innerHTML=`<p class="bh-ops-error">${esc(error.message)}</p>`;
        }
      };
    };
    top.insertBefore(button,top.children[1]||null);
  }

  function enhanceDetails(){
    const card=document.querySelector('.bh-ops-modal-card');
    if(!card||card.dataset.actionsReady)return;
    const reference=card.querySelector('.bh-ops-modal-head h3')?.textContent?.trim();
    if(!reference)return;
    card.dataset.actionsReady='1';
    const box=document.createElement('div');
    box.className='bh-ops-actions';
    box.innerHTML=`<textarea id="bhOperationNote" placeholder="ملاحظة التحديث"></textarea><label><input type="checkbox" id="bhOperationNotify" checked> إرسال التحديث إلى الموظف</label><div>${[
      ['in_progress','بدء التنفيذ'],
      ['waiting','انتظار'],
      ['approved','اعتماد'],
      ['completed','مكتمل'],
      ['rejected','رفض'],
      ['cancelled','إلغاء']
    ].map(([value,label])=>`<button data-op-status="${value}">${label}</button>`).join('')}</div>`;
    card.appendChild(box);
    box.querySelectorAll('[data-op-status]').forEach(button=>{
      button.onclick=async()=>{
        button.disabled=true;
        try{
          await api({
            action:'set_status',
            reference,
            status:button.dataset.opStatus,
            note:box.querySelector('#bhOperationNote').value,
            notify:box.querySelector('#bhOperationNotify').checked
          });
          card.closest('.bh-ops-modal').remove();
          document.getElementById('bhOpsRefresh')?.click();
        }catch(error){
          button.disabled=false;
          alert(error.message);
        }
      };
    });
  }

  function addApprovalPanel(){
    const shell=document.querySelector('.bh-ops-shell');
    if(!shell||document.getElementById('bhOpsApprovalPanel'))return;
    fetch('/api/operations?limit=1',{
      headers:token()?{Authorization:`Bearer ${token()}`}:{ }
    })
      .then(response=>response.json())
      .then(data=>{
        const rows=data.approvals||[];
        if(!rows.length)return;
        const panel=document.createElement('div');
        panel.id='bhOpsApprovalPanel';
        panel.className='bh-ops-card';
        panel.innerHTML=`<h3>اعتمادات معلقة (${rows.length})</h3><div class="bh-ops-table-wrap"><table class="bh-ops-table"><tbody>${rows.map(row=>`<tr><td><b>${esc(row.reference_no)}</b></td><td class="title">${esc(row.summary||row.entity_type)}</td><td>${Number(row.amount||0).toLocaleString('ar-SA')} ر.س</td><td><button data-decision="approved" data-id="${row.id}">اعتماد</button> <button data-decision="rejected" data-id="${row.id}">رفض</button></td></tr>`).join('')}</tbody></table></div>`;
        shell.querySelector('.bh-ops-filter')?.after(panel);
        panel.querySelectorAll('[data-decision]').forEach(button=>{
          button.onclick=async()=>{
            const note=prompt(button.dataset.decision==='approved'?'ملاحظة الاعتماد':'سبب الرفض')||'';
            try{
              await api({
                action:'approval_decision',
                id:button.dataset.id,
                decision:button.dataset.decision,
                note
              });
              panel.remove();
              document.getElementById('bhOpsRefresh')?.click();
            }catch(error){
              alert(error.message);
            }
          };
        });
      })
      .catch(()=>{});
  }

  function install(){
    addTaskButton();
    enhanceDetails();
    addApprovalPanel();
  }

  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(install,1200);
  install();
})();
