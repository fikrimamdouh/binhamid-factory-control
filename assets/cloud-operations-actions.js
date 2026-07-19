(function(){
  'use strict';

  const TOKEN_KEY='binhamid_cloud_access_token';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const requestId=prefix=>`${prefix}:${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

  function token(){return localStorage.getItem(TOKEN_KEY)||'';}

  function ensureStyle(){
    if(document.getElementById('bh-operations-actions-style'))return;
    const style=document.createElement('style');style.id='bh-operations-actions-style';style.textContent=`
      .bh-ops-form{display:grid;gap:10px;margin-top:14px}
      .bh-ops-form label{display:grid;gap:5px;font-size:12px;color:#5d717b}
      .bh-ops-form input,.bh-ops-form select,.bh-ops-form textarea,.bh-ops-actions textarea{width:100%;box-sizing:border-box;border:1px solid #cfd8da;border-radius:9px;padding:10px;font:inherit;background:#fff;color:#173746}
      .bh-ops-form textarea,.bh-ops-actions textarea{min-height:90px;resize:vertical}
      .bh-ops-form button,.bh-ops-actions button{border:0;border-radius:9px;padding:9px 12px;background:#0d7896;color:#fff;cursor:pointer;font:inherit}
      .bh-ops-form button:disabled,.bh-ops-actions button:disabled{opacity:.55;cursor:wait}
      .bh-ops-actions{display:grid;gap:9px;margin-top:16px;padding-top:14px;border-top:1px solid #e6e0d7}
      .bh-ops-actions label{display:flex;gap:7px;align-items:center;font-size:12px;color:#5d717b}
      .bh-ops-actions label input{width:auto}
      .bh-ops-actions>div{display:flex;gap:7px;flex-wrap:wrap}
      .bh-ops-error{padding:10px;border-radius:8px;background:#fff0f0;color:#8b2525}
      .bh-ops-success{padding:10px;border-radius:8px;background:#e8f5ed;color:#1f6646}
    `;document.head.appendChild(style);
  }

  async function api(input){
    const response=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json',...(token()?{Authorization:`Bearer ${token()}`}:{})},body:JSON.stringify(input)}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'تعذر تنفيذ الإجراء');return data;
  }

  function modal(title,html,kind='generic'){
    const element=document.createElement('div');element.className='bh-ops-modal';element.dataset.modalKind=kind;element.innerHTML=`<div class="bh-ops-modal-card"><div class="bh-ops-modal-head"><h3>${esc(title)}</h3><button data-close>إغلاق</button></div>${html}</div>`;document.body.appendChild(element);element.querySelector('[data-close]').onclick=()=>element.remove();element.onclick=event=>{if(event.target===element)element.remove();};return element;
  }

  function addTaskButton(){
    const top=document.querySelector('.bh-ops-top');if(!top||document.getElementById('bhOpsNewTask'))return;
    const button=document.createElement('button');button.id='bhOpsNewTask';button.textContent='مهمة جديدة';
    button.onclick=()=>{
      const operationRequestId=requestId('web-task'),dialog=modal('إنشاء مهمة إدارية',`<div class="bh-ops-form"><label>العنوان<input id="bhTaskTitle" maxlength="500"></label><label>التفاصيل<textarea id="bhTaskDescription" maxlength="4000"></textarea></label><label>المسؤول<input id="bhTaskAssignee" maxlength="500"></label><label>القسم<select id="bhTaskDepartment"><option value="general">عام</option><option value="sales">المبيعات</option><option value="workshop">الورشة</option><option value="finance">المالية</option><option value="warehouse">المخزن</option><option value="procurement">المشتريات</option><option value="quality">الجودة</option><option value="hr">الموارد البشرية</option><option value="fleet">الأسطول</option></select></label><label>الأولوية<select id="bhTaskPriority"><option value="normal">عادي</option><option value="urgent">عاجل</option><option value="critical">حرج</option></select></label><label>الموعد<input id="bhTaskDue" type="datetime-local"></label><button id="bhTaskSave">حفظ المهمة</button><div id="bhTaskResult"></div></div>`,'create-task');
      dialog.querySelector('#bhTaskSave').onclick=async()=>{
        const saveButton=dialog.querySelector('#bhTaskSave'),resultBox=dialog.querySelector('#bhTaskResult');saveButton.disabled=true;resultBox.textContent='';
        try{
          const data=await api({action:'create_task',requestId:operationRequestId,title:dialog.querySelector('#bhTaskTitle').value,description:dialog.querySelector('#bhTaskDescription').value,assignedTo:dialog.querySelector('#bhTaskAssignee').value,department:dialog.querySelector('#bhTaskDepartment').value,priority:dialog.querySelector('#bhTaskPriority').value,dueDate:dialog.querySelector('#bhTaskDue').value});
          resultBox.innerHTML=`<div class="bh-ops-success">${data.duplicate?'المهمة محفوظة مسبقًا':'تم إنشاء المهمة'} <b>${esc(data.reference)}</b></div>`;setTimeout(()=>{dialog.remove();document.getElementById('bhOpsRefresh')?.click();},700);
        }catch(error){saveButton.disabled=false;resultBox.innerHTML=`<div class="bh-ops-error">${esc(error.message)}</div>`;}
      };
    };top.insertBefore(button,top.children[1]||null);
  }

  function enhanceDetails(){
    const cards=[...document.querySelectorAll('.bh-ops-modal-card')];
    for(const card of cards){
      if(card.dataset.actionsReady||!card.querySelector('.bh-ops-detail'))continue;const modalElement=card.closest('.bh-ops-modal');if(modalElement?.dataset.modalKind==='create-task')continue;const reference=card.querySelector('.bh-ops-modal-head h3')?.textContent?.trim();if(!reference)continue;
      card.dataset.actionsReady='1';const box=document.createElement('div');box.className='bh-ops-actions';box.innerHTML=`<textarea id="bhOperationNote" maxlength="2000" placeholder="ملاحظة التحديث"></textarea><label><input type="checkbox" id="bhOperationNotify" checked> إرسال التحديث إلى الموظف</label><div>${[['in_progress','بدء التنفيذ'],['waiting','انتظار'],['approved','اعتماد'],['completed','مكتمل'],['rejected','رفض'],['cancelled','إلغاء']].map(([value,label])=>`<button data-op-status="${value}">${label}</button>`).join('')}</div>`;card.appendChild(box);
      box.querySelectorAll('[data-op-status]').forEach(statusButton=>{
        statusButton.onclick=async()=>{
          const buttons=[...box.querySelectorAll('[data-op-status]')];buttons.forEach(item=>item.disabled=true);statusButton.dataset.requestId||=requestId(`web-status:${reference}:${statusButton.dataset.opStatus}`);
          try{await api({action:'set_status',requestId:statusButton.dataset.requestId,reference,status:statusButton.dataset.opStatus,note:box.querySelector('#bhOperationNote').value,notify:box.querySelector('#bhOperationNotify').checked});modalElement?.remove();document.getElementById('bhOpsRefresh')?.click();}
          catch(error){buttons.forEach(item=>item.disabled=false);alert(error.message);}
        };
      });
    }
  }

  function addApprovalPanel(){
    const shell=document.querySelector('.bh-ops-shell');if(!shell||document.getElementById('bhOpsApprovalPanel'))return;
    fetch('/api/operations?limit=1',{headers:token()?{Authorization:`Bearer ${token()}`}:{}})
      .then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'تعذر تحميل الاعتمادات');return data;})
      .then(data=>{
        const rows=data.approvals||[];if(!rows.length)return;const panel=document.createElement('div');panel.id='bhOpsApprovalPanel';panel.className='bh-ops-card';panel.innerHTML=`<h3>اعتمادات معلقة (${rows.length})</h3><div class="bh-ops-table-wrap"><table class="bh-ops-table"><tbody>${rows.map(row=>`<tr><td><b>${esc(row.reference_no)}</b></td><td class="title">${esc(row.summary||row.entity_type)}</td><td>${Number(row.amount||0).toLocaleString('ar-SA')} ر.س</td><td><button data-decision="approved" data-id="${row.id}">اعتماد</button> <button data-decision="rejected" data-id="${row.id}">رفض</button></td></tr>`).join('')}</tbody></table></div>`;shell.querySelector('.bh-ops-filter')?.after(panel);
        panel.querySelectorAll('[data-decision]').forEach(decisionButton=>{
          decisionButton.onclick=async()=>{
            const note=prompt(decisionButton.dataset.decision==='approved'?'ملاحظة الاعتماد':'سبب الرفض')||'',actionButtons=[...panel.querySelectorAll('[data-decision]')];actionButtons.forEach(item=>item.disabled=true);
            try{await api({action:'approval_decision',id:decisionButton.dataset.id,decision:decisionButton.dataset.decision,note});panel.remove();document.getElementById('bhOpsRefresh')?.click();}
            catch(error){actionButtons.forEach(item=>item.disabled=false);alert(error.message);}
          };
        });
      }).catch(()=>{});
  }

  function install(){ensureStyle();addTaskButton();enhanceDetails();addApprovalPanel();}
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});setInterval(install,1200);install();
})();
