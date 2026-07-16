(function(){
  'use strict';
  const VERSION='2026.07.16-unified-workforce-1';
  const TEMPLATE_NAME='قالب_الربط_الموحد_الموظفين_الديزل_الأصول.xlsx';
  let core=null,plan=null,lastFileName='';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function arrays(){
    if(!window.D||!window.OPS)throw new Error('بيانات البرنامج لم تكتمل بعد.');
    if(!Array.isArray(D.emp))D.emp=[];if(!Array.isArray(D.veh))D.veh=[];if(!Array.isArray(OPS.fuel))OPS.fuel=[];if(!Array.isArray(OPS.workforceAssetLinks))OPS.workforceAssetLinks=[];
    return {employees:D.emp,assets:D.veh,links:OPS.workforceAssetLinks,fuel:OPS.fuel};
  }
  function toast(message,bad=false){let el=$('bhUnifiedToast');if(!el){el=document.createElement('div');el.id='bhUnifiedToast';document.body.appendChild(el);}el.textContent=message;el.className='bh-unified-toast on'+(bad?' bad':'');clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='bh-unified-toast',4200);}
  async function downloadTemplate(){
    try{
      const parts=await Promise.all(Array.from({length:7},(_,i)=>fetch(`/assets/templates/unified-workforce-template.part${String(i+1).padStart(2,'0')}.txt?v=${VERSION}`).then(r=>{if(!r.ok)throw new Error('جزء القالب غير موجود');return r.text();})));
      const raw=atob(parts.join('').replace(/\s+/g,'')),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const a=document.createElement('a');a.href=url;a.download=TEMPLATE_NAME;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
      toast('تم تنزيل قالب الربط الموحد.');
    }catch(error){toast('تعذر تنزيل القالب: '+(error.message||error),true);}
  }
  function counts(){
    try{const a=arrays();return {employees:a.employees.length,assets:a.assets.length,links:a.links.filter(x=>x.active!==false).length,fuel:a.fuel.length};}
    catch{return {employees:0,assets:0,links:0,fuel:0};}
  }
  function renderStatus(){const c=counts();const host=$('bhUnifiedStatus');if(host)host.innerHTML=`<div><b>${c.employees}</b><span>موظف</span></div><div><b>${c.assets}</b><span>أصل/مركبة</span></div><div><b>${c.links}</b><span>ربط فعال</span></div><div><b>${c.fuel}</b><span>حركة ديزل</span></div>`;}
  function renderPreview(){
    const host=$('bhUnifiedPreview'),apply=$('bhUnifiedApply');if(!host)return;
    if(!plan){host.innerHTML='<div class="bh-u-empty">ارفع القالب المعدّل لعرض نتيجة التحديث قبل الاعتماد.</div>';if(apply)apply.disabled=true;return;}
    const s=plan.summary||{},bad=plan.errors?.length||0,warn=plan.warnings?.length||0;
    host.innerHTML=`<div class="bh-u-file"><b>${esc(lastFileName)}</b><span>${bad?'يحتاج تصحيح':'جاهز للاعتماد'}</span></div>
      <div class="bh-u-kpis"><div><b>${s.employeeCreates||0}</b><span>موظفون جدد</span></div><div><b>${s.employeeUpdates||0}</b><span>تحديث موظفين</span></div><div><b>${s.assetCreates||0}</b><span>أصول جديدة</span></div><div><b>${s.assetUpdates||0}</b><span>تحديث أصول</span></div><div><b>${s.linkUpserts||0}</b><span>روابط تعتمد</span></div><div><b>${s.unlinks||0}</b><span>روابط تلغى</span></div></div>
      ${bad?`<div class="bh-u-list bad"><b>أخطاء تمنع الاعتماد</b>${plan.errors.map(x=>`<p>${esc(x)}</p>`).join('')}</div>`:''}
      ${warn?`<div class="bh-u-list warn"><b>تنبيهات</b>${plan.warnings.map(x=>`<p>${esc(x)}</p>`).join('')}</div>`:''}`;
    if(apply)apply.disabled=Boolean(bad);
  }
  async function readFile(file){
    if(!core)throw new Error('مكوّن الربط لم يكتمل تحميله.');if(!window.XLSX?.read)throw new Error('مكتبة Excel غير محملة في البرنامج.');
    const data=await file.arrayBuffer(),workbook=XLSX.read(data,{type:'array',cellDates:false});
    const rows=core.workbookRows(XLSX,workbook),current=arrays();plan=core.buildImportPlan(rows,current);lastFileName=file.name;renderPreview();toast(plan.errors.length?'تمت القراءة وظهر ما يلزم تصحيحه.':'تمت القراءة والملف جاهز للاعتماد.',Boolean(plan.errors.length));
  }
  async function applyImport(){
    if(!plan||plan.errors?.length)return;
    const current=arrays(),backup={employees:structuredClone(current.employees),assets:structuredClone(current.assets),links:structuredClone(current.links),fuel:structuredClone(current.fuel)};
    const button=$('bhUnifiedApply');if(button){button.disabled=true;button.textContent='جارٍ الاعتماد...';}
    try{
      if(typeof window.opsSnapshot==='function')await window.opsSnapshot('قبل اعتماد قالب الربط الموحد');
      const result=core.applyImportPlan(current,plan);
      if(typeof window.save==='function')window.save();
      if(typeof window.opsPersist==='function')await window.opsPersist('اعتماد قالب الربط الموحد');
      if(typeof window.bhCloudPush==='function')await window.bhCloudPush();
      plan=null;lastFileName='';renderPreview();renderStatus();toast(`تم الاعتماد: ${result.linked} ربط، ${result.mappedFuel} حركة ديزل مرتبطة.`);
    }catch(error){
      current.employees.splice(0,current.employees.length,...backup.employees);current.assets.splice(0,current.assets.length,...backup.assets);current.links.splice(0,current.links.length,...backup.links);current.fuel.splice(0,current.fuel.length,...backup.fuel);
      toast('تعذر الاعتماد وتمت استعادة البيانات السابقة: '+(error.message||error),true);
    }finally{if(button){button.disabled=false;button.textContent='اعتماد التحديث داخل البرنامج';}}
  }
  function openPane(){
    document.querySelectorAll('.pane').forEach(x=>x.classList.remove('on'));$('p-unified-workforce')?.classList.add('on');
    document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('on'));$('bhUnifiedWorkforceTab')?.classList.add('on');renderStatus();renderPreview();
  }
  function style(){if($('bhUnifiedStyle'))return;const st=document.createElement('style');st.id='bhUnifiedStyle';st.textContent=`
    .bh-u-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}.bh-u-btn{border:0;border-radius:9px;padding:11px 15px;font:inherit;font-weight:800;cursor:pointer}.bh-u-btn.primary{background:#14425f;color:#fff}.bh-u-btn.gold{background:#b4893a;color:#fff}.bh-u-btn:disabled{opacity:.45;cursor:not-allowed}.bh-u-note{background:#f5eddf;border-inline-start:4px solid #b4893a;border-radius:9px;padding:12px 14px;line-height:1.8;color:#644b1d}.bh-u-status,.bh-u-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px;margin:13px 0}.bh-u-status>div,.bh-u-kpis>div{border:1px solid #e2dcd1;border-radius:10px;padding:12px;background:#fff}.bh-u-status b,.bh-u-kpis b{display:block;font-size:22px;color:#14425f}.bh-u-status span,.bh-u-kpis span{font-size:11.5px;color:#6e6e6e}.bh-u-empty{padding:25px;text-align:center;color:#6e6e6e;border:1px dashed #d7d0c5;border-radius:10px}.bh-u-file{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 13px;background:#edf3f5;border-radius:9px}.bh-u-list{margin-top:10px;padding:12px;border-radius:9px}.bh-u-list b{display:block;margin-bottom:6px}.bh-u-list p{margin:4px 0;font-size:12.5px}.bh-u-list.bad{background:#fff0f0;color:#8f2929;border:1px solid #edcaca}.bh-u-list.warn{background:#fff8e8;color:#795817;border:1px solid #ead7a5}.bh-unified-toast{position:fixed;bottom:20px;left:20px;z-index:9999;background:#123449;color:white;border-radius:10px;padding:12px 15px;opacity:0;transform:translateY(20px);transition:.2s;pointer-events:none}.bh-unified-toast.on{opacity:1;transform:none}.bh-unified-toast.bad{background:#9d3030}`;document.head.appendChild(st);}
  function installUi(){
    const tabs=$('tabs'),wrap=document.querySelector('.wrap');if(!tabs||!wrap||$('bhUnifiedWorkforceTab'))return false;style();
    const tab=document.createElement('button');tab.id='bhUnifiedWorkforceTab';tab.innerHTML='<span class="ic">⌁</span>ربط الموظفين والأصول';tab.onclick=openPane;tabs.appendChild(tab);
    const pane=document.createElement('div');pane.id='p-unified-workforce';pane.className='pane';pane.innerHTML=`<div class="card"><h2>القالب الموحد للموظفين والديزل والأصول</h2><p class="sub">تنزيل القالب، اختيار الموظف ولوحة الديزل ورقم الأصل ERP، ثم رفعه لاعتماد الإضافة أو التحديث دون تكرار.</p><div class="bh-u-note"><b>مفتاح الموظف:</b> الهوية/الإقامة. <b>مفتاح الأصل:</b> رقم الأصل ERP. <b>اللوحة:</b> للربط بحركات الديزل. الخانات الفارغة لا تمسح بيانات قديمة.</div><div id="bhUnifiedStatus" class="bh-u-status"></div><div class="bh-u-actions"><button id="bhUnifiedDownload" class="bh-u-btn gold" type="button">تنزيل القالب الجاهز</button><button id="bhUnifiedUpload" class="bh-u-btn primary" type="button">رفع القالب المعدّل</button><input id="bhUnifiedFile" type="file" accept=".xlsx,.xls" hidden></div></div><div class="card"><h2>مراجعة قبل الاعتماد</h2><div id="bhUnifiedPreview"></div><div class="bh-u-actions"><button id="bhUnifiedApply" class="bh-u-btn primary" type="button" disabled>اعتماد التحديث داخل البرنامج</button></div></div>`;
    wrap.appendChild(pane);$('bhUnifiedDownload').onclick=downloadTemplate;$('bhUnifiedUpload').onclick=()=>$('bhUnifiedFile').click();$('bhUnifiedFile').onchange=async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;try{await readFile(f);}catch(error){plan=null;renderPreview();toast(error.message||String(error),true);}};$('bhUnifiedApply').onclick=applyImport;renderStatus();renderPreview();return true;
  }
  function patchFuelPersistence(){
    if(!core||typeof window.opsPersist!=='function'||window.opsPersist.__bhUnifiedPatched)return;
    const original=window.opsPersist;async function wrapped(){try{const a=arrays();core.remapFuelRows(a.fuel,a.links,a.employees,a.assets);}catch(error){console.warn('[Unified workforce mapping]',error);}return original.apply(this,arguments);}wrapped.__bhUnifiedPatched=true;window.opsPersist=wrapped;
  }
  async function start(){
    try{core=await import('/lib/unified-workforce-core.mjs?v='+encodeURIComponent(VERSION));installUi();patchFuelPersistence();setInterval(()=>{installUi();patchFuelPersistence();renderStatus();},1200);}
    catch(error){console.error('[Unified workforce]',error);toast('تعذر تحميل ربط الموظفين والأصول: '+(error.message||error),true);}
  }
  start();
})();
