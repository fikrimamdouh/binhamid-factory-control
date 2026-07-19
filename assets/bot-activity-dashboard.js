(function(){
  'use strict';
  const TOKEN_KEY='binhamid_cloud_access_token';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const token=()=>String(localStorage.getItem(TOKEN_KEY)||'').trim();
  const fmt=value=>{try{return new Date(value).toLocaleString('ar-SA',{dateStyle:'short',timeStyle:'short'});}catch{return String(value||'—');}};
  const num=value=>Number(value||0).toLocaleString('en-US');
  async function load(){
    const response=await fetch('/api/dashboard?persistAlerts=false',{headers:{Authorization:`Bearer ${token()}`},cache:'no-store'}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'تعذر قراءة سجل البوت');
    return{activity:data.botActivity,imports:Array.isArray(data.imports)?data.imports:[],restricted:Boolean(data.restricted)};
  }
  function table(rows,columns){
    if(!rows?.length)return'<p class="bh-empty">لا توجد بيانات بعد.</p>';
    return`<div class="bh-table-wrap"><table class="bh-table"><thead><tr>${columns.map(column=>`<th>${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(column=>`<td>${esc(column.value(row))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function excelRows(imports){return imports.filter(row=>/\.(xlsx|xls)$/i.test(String(row.original_name||''))||/spreadsheet|excel/i.test(String(row.mime_type||''))).slice(0,30);}
  async function render(){
    const root=document.getElementById('bhBotActivityRoot');if(!root)return;
    root.innerHTML='<div class="bh-card"><h2>سجل وتحليلات البوت</h2><p class="bh-note">جارٍ تحميل المستخدمين والرسائل وملفات Excel...</p></div>';
    try{
      const data=await load(),a=data.activity,imports=excelRows(data.imports);
      if(!a){root.innerHTML=`<div class="bh-card"><h2>سجل وتحليلات البوت</h2><p class="bh-note">${data.restricted?'الجهاز غير مرتبط بمستخدم مدير. سجّل دخول المالك من بوابة Telegram لعرض نصوص الرسائل والمستخدمين.':'يلزم دخول مدير معتمد لعرض التحليلات.'}</p><h3>ملفات Excel الواردة</h3>${table(imports,[{label:'الوقت',value:r=>fmt(r.created_at)},{label:'الملف',value:r=>r.original_name||'—'},{label:'النوع',value:r=>r.report_type||'—'},{label:'الحالة',value:r=>r.status||'—'},{label:'الصفوف',value:r=>num(r.row_count)},{label:'الأخطاء',value:r=>num(r.error_count)}])}</div>`;return;}
      root.innerHTML=`<div class="bh-grid">
        <div class="bh-c12 bh-kpis"><div class="bh-kpi"><b>${esc(num(a.total))}</b><span>رسائل 30 يومًا</span></div><div class="bh-kpi"><b>${esc(num(a.incoming))}</b><span>واردة من المستخدمين</span></div><div class="bh-kpi"><b>${esc(num(a.outgoing))}</b><span>ردود البوت</span></div><div class="bh-kpi"><b>${esc(num(a.activeUsers))}</b><span>مستخدمون نشطون</span></div></div>
        <div class="bh-card bh-c6"><h3>أكثر المستخدمين تعاملًا</h3>${table(a.topUsers,[{label:'المستخدم',value:r=>r.name},{label:'الدور',value:r=>r.role},{label:'الرسائل',value:r=>num(r.count)},{label:'آخر تفاعل',value:r=>fmt(r.lastAt)}])}</div>
        <div class="bh-card bh-c6"><h3>أكثر إجراءات البوت</h3>${table(a.topActions,[{label:'الإجراء',value:r=>r.action},{label:'التكرار',value:r=>num(r.count)}])}</div>
        <div class="bh-card bh-c12"><h3>آخر الرسائل</h3><p class="bh-note">تظهر لمستخدم مدير معتمد فقط. النصوص معروضة كنص آمن دون تنفيذ HTML.</p>${table(a.recentMessages,[{label:'الوقت',value:r=>fmt(r.at)},{label:'الاتجاه',value:r=>r.direction==='outgoing'?'رد البوت':'مستخدم'},{label:'المستخدم',value:r=>r.senderName||r.senderExternalId||'—'},{label:'النوع',value:r=>r.messageType},{label:'الرسالة',value:r=>r.preview||r.fileName||'—'},{label:'الحالة',value:r=>r.deliveryStatus||'—'}])}</div>
        <div class="bh-card bh-c12"><h3>آخر ملفات Excel الواردة</h3>${table(imports,[{label:'الوقت',value:r=>fmt(r.created_at)},{label:'الملف',value:r=>r.original_name||'—'},{label:'النوع',value:r=>r.report_type||'—'},{label:'الحالة',value:r=>r.status||'—'},{label:'الصفوف',value:r=>num(r.row_count)},{label:'الأخطاء',value:r=>num(r.error_count)},{label:'التحذيرات',value:r=>num(r.warning_count)}])}</div>
        <div class="bh-card bh-c12"><h3>آخر عمليات مُسجلة</h3>${table(a.recentActions,[{label:'الوقت',value:r=>fmt(r.at)},{label:'الإجراء',value:r=>r.action},{label:'الاتجاه',value:r=>r.direction==='outgoing'?'رد البوت':'مستخدم'},{label:'المستخدم',value:r=>r.senderName||r.senderExternalId||'—'},{label:'النوع',value:r=>r.messageType}])}</div>
      </div>`;
    }catch(error){root.innerHTML=`<div class="bh-card"><h2>سجل وتحليلات البوت</h2><p class="bh-note warn">${esc(error.message)}</p></div>`;}
  }
  function open(){document.querySelectorAll('.pane').forEach(pane=>pane.classList.remove('on'));document.getElementById('p-bot-activity')?.classList.add('on');document.querySelectorAll('#tabs button').forEach(button=>button.classList.toggle('on',button.id==='bhBotActivityTab'));render();}
  function install(){const tabs=document.getElementById('tabs'),wrap=document.querySelector('.wrap');if(!tabs||!wrap)return false;if(!document.getElementById('bhBotActivityTab')){const button=document.createElement('button');button.id='bhBotActivityTab';button.innerHTML='<span class="ic">◉</span>سجل البوت';button.onclick=open;tabs.appendChild(button);}if(!document.getElementById('p-bot-activity')){const pane=document.createElement('div');pane.id='p-bot-activity';pane.className='pane';pane.innerHTML='<div id="bhBotActivityRoot"></div>';wrap.appendChild(pane);}window.bhBotActivityOpen=open;return true;}
  const timer=setInterval(()=>{if(install())clearInterval(timer);},250);setTimeout(()=>clearInterval(timer),20000);
})();
