(function(){
'use strict';
/* ============================================================
   BinHamid cloud + communication center
   ------------------------------------------------------------
   Reorganized 2026-07-19: the Telegram admin area (formerly
   "مركز الاتصال") now has five clearly separated tabs instead of
   one page that mixed groups+users together. No public function
   or DOM id changed name, so cloud-user-roles.js, import-review-
   guard.js, telegram-site-two-way.js, cloud-control-navigation-
   fix.js, daily-report-source-of-truth.js and fleet-attendance-
   status.js all keep working without changes.
   ============================================================ */
const V='2026.07.19-cloud-foundation-2-reorganized';
const TK='binhamid_cloud_access_token',DK='binhamid_cloud_device_id',RK='binhamid_cloud_revision',QK='binhamid_cloud_pending';
let askedLogin=false;
let autoBusy=false;
let page='overview',dash=null,server=null,timer=null,busy=false,patched=false;
const S={configured:false,authorized:false,pending:false,error:'',lastSync:''};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function device(){let x=localStorage.getItem(DK);if(!x){x='dev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);localStorage.setItem(DK,x)}return x}
const CTK='bh_cloud_token';
function bhReadCookie(){try{const m=document.cookie.match(/(?:^|; )bh_cloud_token=([^;]*)/);return m?decodeURIComponent(m[1]):''}catch{return ''}}
function bhWriteCookie(v){try{document.cookie=CTK+'='+encodeURIComponent(v||'')+'; path=/; max-age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'')}catch{}}
function setToken(v){try{localStorage.setItem(TK,v)}catch{}bhWriteCookie(v)}
(function bootToken(){try{
  const u=new URL(location.href);
  let q=u.searchParams.get('k')||u.searchParams.get('token')||'';
  if(!q){const h=(location.hash||'').match(/[#&](?:k|token)=([^&]+)/);if(h)q=decodeURIComponent(h[1]);}
  if(q){setToken(q);u.searchParams.delete('k');u.searchParams.delete('token');history.replaceState(null,'',u.pathname+(u.searchParams.toString()?'?'+u.searchParams.toString():''));if((location.hash||'').match(/[#&](?:k|token)=/))history.replaceState(null,'',location.pathname+location.search);}
  const ls=localStorage.getItem(TK)||'',ck=bhReadCookie();
  if(!ls&&ck)localStorage.setItem(TK,ck);
  if(ls&&!ck)bhWriteCookie(ls);
}catch{}})();

/* ---------- طبقة الاتصال بالخادم ---------- */
const token=()=>localStorage.getItem(TK)||bhReadCookie()||'';
const rev=()=>Number(localStorage.getItem(RK)||0);
const setRev=x=>localStorage.setItem(RK,String(Number(x)||0));
function headers(extra={}){const realToken=token()==='device-session'?'':token(),uid=String(localStorage.getItem('binhamid_cloud_app_user_id')||'').trim();return {'Content-Type':'application/json',...(realToken?{Authorization:'Bearer '+realToken}:{}),...(uid?{'x-app-user-id':uid}:{}),...extra}}
async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:headers(opt.headers||{})}),t=r.headers.get('content-type')||'',d=t.includes('json')?await r.json():await r.text();
  if(r.status===401){S.authorized=false;badge();throw Object.assign(new Error(d?.error||'رمز الدخول غير صحيح'),{status:401})}
  if(!r.ok)throw Object.assign(new Error(d?.error||d?.message||String(d)||('HTTP '+r.status)),{status:r.status});
  S.authorized=true;return d;
}

/* ---------- لقطة البيانات المحلية للمزامنة ---------- */
function shot(){return{schemaVersion:1,capturedAt:new Date().toISOString(),deviceId:device(),legacy:typeof D!=='undefined'?D:null,ops:typeof OPS!=='undefined'?OPS:null}}
function hasData(){try{return(D.emp.length+D.veh.length+D.cli.length+OPS.movements.length+OPS.fuel.length+OPS.maintenance.length)>0}catch{return false}}
function queue(){try{localStorage.setItem(QK,JSON.stringify({at:new Date().toISOString(),baseRevision:rev(),payload:shot()}));S.pending=true}catch{}}
function clearQueue(){localStorage.removeItem(QK);S.pending=false}

/* ---------- تنبيهات وشارة الحالة ---------- */
function toast(m,bad=false){const e=$('bhSyncToast');if(!e)return;e.textContent=m;e.className='bh-sync-toast on'+(bad?' bad':'');clearTimeout(toast.t);toast.t=setTimeout(()=>e.className='bh-sync-toast',3500)}
function badge(){
  const e=$('bhCloudBadge');if(!e)return;
  const text=busy?'مزامنة':!S.configured?'حفظ محلي':S.error?'تعارض/خطأ':S.pending?'بانتظار المزامنة':S.lastSync?'سحابي محفوظ':(S.authorized||token())?'سحابي جاهز':'يلزم تسجيل دخول';
  e.textContent=text;e.className='bh-cloud-badge '+(busy?'sync':S.error?'err':S.lastSync&&!S.pending?'ok':'');
}
async function status(){try{server=await fetch('/api/system/status',{cache:'no-store'}).then(r=>r.json());S.configured=!!server.cloudConfigured;S.error=''}catch(e){S.error=e.message}badge()}

/* ---------- الحفظ السحابي (رفع/سحب) ---------- */
async function push(reason='حفظ تلقائي',force=false){
  if(busy)return;
  if(!S.configured||(!token()&&!localStorage.getItem('binhamid_cloud_app_user_id'))){queue();badge();return}
  const body=JSON.stringify({baseRevision:force?null:rev(),reason,deviceId:device(),payload:shot()});
  if(new Blob([body]).size>4e6){S.error='حجم البيانات أكبر من حد الطلب';queue();badge();return toast('تم الحفظ محليًا لكن المزامنة تحتاج تقسيم البيانات.',true)}
  busy=true;S.error='';badge();
  try{
    const r=await api('/api/state',{method:'PUT',body});
    setRev(r.revision);S.lastSync=r.updatedAt||new Date().toISOString();clearQueue();
    const b=$('tbSave');if(b)b.textContent='محفوظ محليًا وسحابيًا';
  }catch(e){
    S.error=e.message;queue();
    if(e.status===409)toast('توجد نسخة سحابية أحدث. لم تُستبدل بياناتك.',true);
    else if(e.status===401){if(!askedLogin){askedLogin=true;login()}}
    else toast('الحفظ المحلي تم، وتعذرت المزامنة: '+e.message,true);
  }finally{busy=false;badge();render()}
}
function schedule(r){clearTimeout(timer);timer=setTimeout(()=>push(r),1400)}
async function pull(){
  if(!token()&&!localStorage.getItem('binhamid_cloud_app_user_id'))return login();
  try{
    const r=await api('/api/state');
    if(!r.payload)return toast('لا توجد نسخة سحابية بعد.');
    if(hasData()&&!confirm('ستُنشأ نسخة احتياطية محلية ثم تستبدل البيانات الحالية بالنسخة السحابية. استمرار؟'))return;
    if(typeof opsSnapshot==='function')await opsSnapshot('قبل استعادة السحابي');
    if(r.payload.legacy)localStorage.setItem('binhamid_v1',JSON.stringify(r.payload.legacy));
    if(r.payload.ops)localStorage.setItem('binhamid_factory_control_v3',JSON.stringify(r.payload.ops));
    setRev(r.revision);clearQueue();
    alert('تمت الاستعادة. ستُعاد الصفحة الآن.');location.reload();
  }catch(e){toast(e.message,true)}
}
function patchSave(){
  if(patched)return;patched=true;
  if(typeof window.save==='function'){const f=window.save;window.save=function(){const x=f.apply(this,arguments);schedule('تحديث البيانات الرئيسية');return x}}
  if(typeof window.opsPersist==='function'){const f=window.opsPersist;window.opsPersist=async function(label){const x=await f.apply(this,arguments);schedule(label||'تحديث تشغيلي');return x}}
  addEventListener('online',()=>push('عودة الاتصال'));
  addEventListener('offline',()=>{S.error='لا يوجد اتصال';queue();badge()});
}

/* ---------- حقن الواجهة داخل البرنامج القديم ---------- */
function ui(){
  const top=$('tbSave')?.parentElement;
  if(top&&!$('bhCloudBadge')){const b=document.createElement('button');b.id='bhCloudBadge';b.className='bh-cloud-badge';b.onclick=open;top.insertBefore(b,$('tbSave'))}
  const tabs=$('tabs');
  if(tabs&&!$('bhCommsTab')){const b=document.createElement('button');b.id='bhCommsTab';b.innerHTML='<span class="ic">◎</span>مركز الاتصال';b.onclick=open;tabs.appendChild(b)}
  const w=document.querySelector('.wrap');
  if(w&&!$('p-comms')){const p=document.createElement('div');p.className='pane';p.id='p-comms';p.innerHTML='<div id="bhCommsRoot"></div>';w.appendChild(p)}
  if(!$('bhCloudLogin'))document.body.insertAdjacentHTML('beforeend','<div class="bh-login" id="bhCloudLogin"><div class="bh-login-card"><h2>ربط الجهاز بالنظام السحابي</h2><p>اكتب قيمة BINHAMID_ADMIN_TOKEN المحفوظة في Vercel. لا تُحفظ في GitHub.<br><b>أو الأسهل:</b> سجّل دخول المالك بكود تليجرام من زر البوابة، وسيُفتح مركز الاتصال تلقائيًا بدون هذا الرمز.</p><label>رمز الدخول</label><input type="password" id="bhCloudToken"><div class="bh-actions"><button class="bh-btn ghost" onclick="bhCloudCloseLogin()">إلغاء</button><button class="bh-btn primary" onclick="bhCloudSaveLogin()">حفظ واختبار</button></div></div></div><div class="bh-sync-toast" id="bhSyncToast"></div>');
}
function open(){
  if(typeof go==='function')go('comms');else{document.querySelectorAll('.pane').forEach(x=>x.classList.remove('on'));$('p-comms')?.classList.add('on')}
  document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',x.id==='bhCommsTab'));
  load();render();
}
function login(){$('bhCloudToken').value=token();$('bhCloudLogin').classList.add('on')}
window.bhCloudCloseLogin=()=>$('bhCloudLogin').classList.remove('on');
window.bhCloudLogin=login;
window.bhCloudSaveLogin=async()=>{
  const v=$('bhCloudToken').value.trim();if(!v)return toast('اكتب رمز الدخول.',true);
  setToken(v);askedLogin=false;
  try{
    const remote=await api('/api/state');S.authorized=true;bhCloudCloseLogin();
    if(remote.payload&&hasData()&&rev()===0){S.error='نسخة سحابية موجودة';toast('تم الربط دون رفع بيانات هذا الجهاز لأن نسخة سحابية موجودة.',true)}
    else if(!remote.payload){await push('إنشاء النسخة الأولى',true);toast('تم إنشاء النسخة السحابية الأولى.')}
    else{setRev(remote.revision);toast('تم ربط الجهاز.')}
    load();
  }catch(e){toast(e.message,true)}
};
window.bhCloudPush=()=>push('مزامنة يدوية');
window.bhCloudPull=pull;

/* ---------- الترحيل التلقائي للملفات الآمنة (غير المالية اليومية) ---------- */
const AK='binhamid_cloud_auto_applied',AIK='binhamid_cloud_auto_import';
function bhAppliedSet(){try{return new Set(JSON.parse(localStorage.getItem(AK)||'[]'))}catch{return new Set()}}
function bhMarkApplied(id){try{const s=bhAppliedSet();s.add(id);localStorage.setItem(AK,JSON.stringify([...s].slice(-300)))}catch{}}
window.bhCloudAutoImport=v=>{localStorage.setItem(AIK,v===false?'0':'1');toast(v===false?'تم إيقاف مساعد الاستيراد من المتصفح.':'تم تفعيل مساعد المتصفح. يمكنك أيضًا فتح واعتماد التقرير اليومي يدويًا من الموقع أو إرساله للبوت.')};
async function bhAutoApply(){
  if(autoBusy)return;
  if(localStorage.getItem(AIK)==='0')return;
  const done=bhAppliedSet();
  // Daily financial Excel is posted by the webhook when it arrives from
  // Telegram. The website remains a complete manual path: open/upload and
  // approve it here uses the same file hash and rejects a duplicate safely.
  // Browser automation itself is reserved for non-daily operational files.
  const rows=(dash?.imports||[]).filter(r=>r&&r.id&&r.status==='ready'&&!/daily_movement|block_daily_movement|concrete_daily_movement/i.test(String(r.report_type||''))&&!done.has(r.id));
  if(!rows.length)return;
  autoBusy=true;
  try{
    for(const r of rows){
      bhMarkApplied(r.id);
      try{
        await window.bhCloudApplyImport(r.id,r.report_type||'',r.original_name||'report.xlsx');
        toast('تم ترحيل ملف وارد تلقائيًا: '+(r.original_name||''));
      }catch(e){toast('تعذر الترحيل التلقائي ('+(r.original_name||'')+'): '+e.message,true)}
    }
  }finally{autoBusy=false}
}
async function load(){
  if(!S.configured||(!token()&&!localStorage.getItem('binhamid_cloud_app_user_id'))){dash=null;return render()}
  try{dash=await api('/api/dashboard');S.error='';bhAutoApply()}catch(e){dash=null;S.error=e.message}
  badge();render();
}

/* ============================================================
   عناصر واجهة قابلة لإعادة الاستخدام
   ============================================================ */
function pill(ok){return'<span class="bh-pill '+(ok?'ok':'bad')+'">'+(ok?'جاهز':'ناقص')+'</span>'}
function cfg(){
  const c=server||{};
  return[
    ['قاعدة Supabase',c.supabaseConfigured,'SUPABASE_URL + SERVICE ROLE'],
    ['رمز دخول النظام',c.adminTokenConfigured,'BINHAMID_ADMIN_TOKEN'],
    ['بوت Telegram',c.telegramConfigured,'BOT TOKEN + WEBHOOK SECRET'],
    ['الصوت الذكي',c.openaiConfigured,'OPENAI_API_KEY اختياري'],
    ['مخزن الملفات',c.storageConfigured,'factory-documents'],
    ['تحويل تقارير PDF',c.pdfConfigured,'PDF_API_URL + PDF_API_KEY — بدونها لن تُنشأ تقارير البلوك/الخرسانة'],
    ['المهام المجدولة (Cron)',c.cronConfigured,'CRON_SECRET — يجب أن يطابق سر GitHub Actions نفسه']
  ].map(x=>'<div class="bh-status-row"><div><b>'+x[0]+'</b><small>'+x[2]+'</small></div>'+pill(x[1])+'</div>').join('');
}
function importRow(r){
  return '<tr><td>'+esc(new Date(r.created_at).toLocaleString('ar-SA'))+'</td><td>'+esc(r.department)+'</td><td>'+esc(r.report_type)+'</td><td>'+esc(r.original_name)+'</td><td><span class="bh-pill info">'+esc(r.status_label||r.status)+'</span></td><td><button class="bh-btn primary" onclick="bhCloudApplyImport(\''+r.id+'\',\''+esc(r.report_type||'')+'\',\''+esc(r.original_name||'report.xlsx')+'\')">فتح في المستورد</button></td></tr>';
}
function importsTable(rows){
  if(!rows.length)return'<div class="bh-empty">لا توجد ملفات واردة.</div>';
  return '<div class="bh-table-wrap"><table class="bh-table"><thead><tr><th>الوقت</th><th>القسم</th><th>النوع</th><th>الملف</th><th>الحالة</th><th></th></tr></thead><tbody>'+rows.map(importRow).join('')+'</tbody></table></div>';
}
// كل ملفات المراجعة (تبويب "الملفات الواردة")
function imports(){return importsTable(dash?.imports||[])}
// أحدث خمسة ملفات فقط (لوحة "نظرة عامة") مع رابط لعرض الباقي
function recentImports(){
  const rows=dash?.imports||[];
  if(!rows.length)return'<div class="bh-empty">لا توجد ملفات واردة.</div>';
  const more=rows.length>5?'<div class="bh-actions" style="margin-top:9px"><button class="bh-btn ghost" onclick="bhCloudView(\'inbox\')">عرض كل الملفات ('+rows.length+')</button></div>':'';
  return importsTable(rows.slice(0,5))+more;
}
function groups(){
  const rows=dash?.groups||[];
  if(!rows.length)return'<div class="bh-empty">لسه مفيش مجموعة Telegram متصلة. أضف البوت لمجموعة العمل وأرسل أي رسالة فيها لتظهر هنا.</div>';
  return '<div class="bh-table-wrap"><table class="bh-table"><thead><tr><th>المجموعة</th><th>Chat ID</th><th>القسم</th><th>الحالة</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.title)+'</td><td>'+esc(r.chat_id)+'</td><td>'+esc(r.department)+'</td><td>'+pill(r.active)+'</td><td><button class="bh-btn ghost" onclick="bhCloudApproveGroup(\''+r.chat_id+'\',\''+esc(r.title||'')+'\')">ضبط القسم</button></td></tr>').join('')+'</tbody></table></div>';
}
function users(){
  const rows=dash?.users||[];
  if(!rows.length)return'<div class="bh-empty">لسه مفيش مستخدم مسجّل. اطلب من الموظف إرسال أمر /whoami للبوت ليظهر هنا وتحدد دوره.</div>';
  return '<div class="bh-table-wrap"><table class="bh-table"><thead><tr><th>الاسم</th><th>Telegram ID</th><th>الدور</th><th>الحالة</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.full_name||r.external_username)+'</td><td>'+esc(r.external_id)+'</td><td>'+esc(r.role)+'</td><td>'+pill(r.active)+'</td><td><button class="bh-btn ghost" onclick="bhCloudApproveUser(\''+r.external_id+'\',\''+esc(r.full_name||'')+'\',\''+esc(r.role||'pending')+'\','+(r.active!==false)+',\''+esc(r.nickname||'')+'\')">تحديد الدور</button> <button class="bh-btn ghost" style="color:#8b2525" onclick="bhCloudDeleteUser(\''+r.external_id+'\',\''+esc(r.full_name||r.external_username||'')+'\')">حذف</button></td></tr>').join('')+'</tbody></table></div>';
}

/* ============================================================
   محتوى كل تبويب — خمسة تبويبات واضحة بدل صفحة واحدة مزدحمة
   ============================================================ */
function viewOverview(){
  const c=dash?.counts||{};
  return '<div class="bh-grid">'
    +'<div class="bh-c12 bh-kpis">'
      +'<div class="bh-kpi warn"><b>'+(c.pendingImports||0)+'</b><span>ملفات تنتظر المراجعة</span></div>'
      +'<div class="bh-kpi warn"><b>'+(c.openApprovals||0)+'</b><span>اعتمادات مفتوحة</span></div>'
      +'<div class="bh-kpi bad"><b>'+(c.openDiscrepancies||0)+'</b><span>فروقات مفتوحة</span></div>'
      +'<div class="bh-kpi"><b>'+(c.messagesToday||0)+'</b><span>رسائل اليوم</span></div>'
    +'</div>'
    +'<div class="bh-card bh-c7"><h3>الوضع التشغيلي</h3><div class="bh-status">'
      +'<div class="bh-status-row"><div><b>الحفظ المحلي</b><small>يعمل عند انقطاع الإنترنت.</small></div>'+pill(true)+'</div>'
      +'<div class="bh-status-row"><div><b>الحفظ السحابي</b><small>Revision '+rev()+' — '+device()+'</small></div>'+pill(S.configured&&(S.authorized||!!token()))+'</div>'
    +'</div></div>'
    +'<div class="bh-card bh-c5"><h3>قاعدة الرقابة</h3><div class="bh-note">كل ملف أو صوت أو موافقة تُحفظ أولًا كمعاملة تحت المراجعة، ولا تتحول تلقائيًا إلى اعتماد مالي.</div></div>'
    +'<div class="bh-card bh-c12"><h3>أحدث الملفات الواردة</h3>'+recentImports()+'</div>'
  +'</div>';
}
function viewInbox(){
  const n=(dash?.imports||[]).length;
  return '<div class="bh-card"><h3>تقارير Excel الواردة'+(n?' ('+n+')':'')+'</h3>'
    +'<div class="bh-note" style="margin-bottom:10px">كل ملف بيوصل من Telegram بيظهر هنا أولًا. اضغط "فتح في المستورد" لمراجعته واعتماده — مفيش ترحيل تلقائي لملفات التقرير المالي اليومي.</div>'
    +imports()+'</div>';
}
function viewGroups(){
  return '<div class="bh-card"><h3>مجموعات Telegram</h3>'
    +'<div class="bh-note" style="margin-bottom:10px">أضف البوت لأي مجموعة عمل (ورشة، مالية، بلوك، خرسانة) وأرسل رسالة فيها؛ هتظهر هنا وتقدر تحدد قسمها ليتم توجيه رسائلها صح.</div>'
    +groups()+'</div>';
}
function viewUsers(){
  return '<div class="bh-card"><h3>المستخدمون والأدوار</h3>'
    +'<div class="bh-note" style="margin-bottom:10px">أول ما حد يبعت أمر /whoami للبوت هيظهر اسمه هنا بدور "بانتظار الاعتماد". اضغط "تحديد الدور" وحدد صلاحيته قبل ما يقدر يستخدم البوت أو الموقع.</div>'
    +users()+'</div>';
}
function viewSetup(){
  return '<div class="bh-grid">'
    +'<div class="bh-card bh-c5"><h3>حالة المكونات</h3><div class="bh-status">'+cfg()+'</div></div>'
    +'<div class="bh-card bh-c7"><h3>خطوات التشغيل الأولى</h3>'
      +'<div class="bh-note warn">1) شغّل ملف SQL في Supabase &nbsp; 2) أضف متغيرات .env.example إلى Vercel &nbsp; 3) سجّل الـ Webhook من هنا &nbsp; 4) اختبر البوت.</div>'
      +'<div class="bh-actions" style="margin-top:10px">'
        +'<button class="bh-btn blue" onclick="bhCloudRegisterWebhook()">1. تسجيل Webhook</button>'
        +'<button class="bh-btn ghost" onclick="bhCloudTestBot()">2. اختبار البوت</button>'
        +'<button class="bh-btn ghost" onclick="bhCloudPull()">استعادة نسخة سحابية</button>'
      +'</div>'
    +'</div>'
  +'</div>';
}
function renderView(){
  if(page==='inbox')return viewInbox();
  if(page==='groups')return viewGroups();
  if(page==='users')return viewUsers();
  if(page==='setup')return viewSetup();
  return viewOverview();
}

/* ---------- التنقل والشيل الرئيسي ---------- */
function navLabel(id,label){
  const c=dash?.counts||{};
  if(id==='inbox'&&c.pendingImports)return label+' ('+c.pendingImports+')';
  if(id==='groups'){const n=(dash?.groups||[]).filter(g=>!g.active).length;if(n)return label+' ('+n+')'}
  if(id==='users'){const n=(dash?.users||[]).filter(u=>String(u.role||'')==='pending'||!u.active).length;if(n)return label+' ('+n+')'}
  return label;
}
function render(){
  const root=$('bhCommsRoot');if(!root)return;
  const nav=[['overview','نظرة عامة'],['inbox','الملفات الواردة'],['groups','المجموعات'],['users','المستخدمون والأدوار'],['setup','الإعداد']];
  root.innerHTML='<div class="bh-comm-shell">'
    +'<aside class="bh-comm-side"><h3>مركز اتصال المصنع</h3><p>إدارة بوت Telegram: الملفات، المجموعات، المستخدمون، والإعداد — كل حاجة في مكانها.</p>'
      +'<div class="bh-comm-nav">'+nav.map(x=>'<button class="'+(page===x[0]?'on':'')+'" onclick="bhCloudView(\''+x[0]+'\')">'+navLabel(x[0],x[1])+'</button>').join('')+'</div>'
    +'</aside>'
    +'<main class="bh-comm-main">'
      +'<div class="bh-comm-head"><div><h2>مركز الاتصال والحفظ السحابي</h2><p>Local-first مع منع الاستبدال الصامت.</p></div><span class="bh-sp"></span>'
        +'<div class="bh-actions"><button class="bh-btn ghost" onclick="bhCloudLogin()">ربط الجهاز</button><button class="bh-btn primary" onclick="bhCloudPush()">مزامنة الآن</button></div>'
      +'</div>'
      +renderView()
    +'</main>'
  +'</div>';
}
window.bhCloudView=v=>{page=v;render();if(v!=='setup')load()};

/* ---------- إجراءات الإدارة (Telegram) ---------- */
window.bhCloudRegisterWebhook=async()=>{
  try{const r=await api('/api/telegram/register',{method:'POST',body:JSON.stringify({baseUrl:location.origin})});toast('تم تسجيل Webhook: '+r.url)}
  catch(e){toast(e.message,true)}
};
window.bhCloudTestBot=async()=>{
  const id=prompt('Telegram Chat ID:');if(!id)return;
  try{await api('/api/telegram/test',{method:'POST',body:JSON.stringify({chatId:id})});toast('تم إرسال رسالة الاختبار.')}
  catch(e){toast(e.message,true)}
};
window.bhCloudApproveGroup=async(id,title)=>{
  const d=prompt('قسم المجموعة: workshop / finance / block / concrete','workshop');if(!d)return;
  try{await api('/api/admin/groups',{method:'POST',body:JSON.stringify({chatId:id,department:d,active:true})});load()}
  catch(e){toast(e.message,true)}
};
window.bhCloudDeleteUser=async(id,name)=>{
  if(!confirm('حذف صلاحية «'+(name||id)+'»؟\n\nسيتم إلغاء ربطه بالبوت وإيقاف حسابه فورًا، ولن يقدر يستخدم البوت ولا الموقع.\nسجل رسائله السابق يفضل محفوظًا، وتقدر تعتمده من جديد في أي وقت.'))return;
  try{
    await api('/api/admin/users',{method:'POST',body:JSON.stringify({action:'delete',externalId:id})});
    toast('تم حذف صلاحية: '+(name||id));
    load();
  }catch(e){toast('تعذر الحذف: '+e.message,true)}
};
const BH_ROLES=['admin','manager','accountant','mechanic','block_sales','concrete_sales','collector','driver','employee','warehouse','fuel_operator','hr','procurement','quality'];
window.bhCloudApproveUser=async(id,name,currentRole,currentActive,currentNickname)=>{
  const r=prompt('الدور: '+BH_ROLES.join(' / '),currentRole&&currentRole!=='pending'?currentRole:'manager');if(!r)return;
  const role=String(r).trim().toLowerCase();
  if(!BH_ROLES.includes(role)){toast('الدور «'+r+'» غير صحيح. اكتب أحد الأدوار المعروضة بالضبط.',true);return}
  // إلغاء نافذة الكنية يعني «بدون كنية» ويكمل الاعتماد — كان الإلغاء يوقف
  // العملية كلها بصمت بلا أي رسالة، فيظهر المستخدم pending بعد التحديث.
  const nickname=prompt('الكنية التي يناديه بها البوت (مثال: أبو فلاح) — اضغط إلغاء لتخطيها',currentNickname||'');
  try{
    await api('/api/admin/users',{method:'POST',body:JSON.stringify({externalId:id,fullName:name,role,active:true,nickname:String(nickname==null?'':nickname).trim()})});
    toast('تم حفظ الدور: '+role);
    load();
  }catch(e){toast('تعذر حفظ الدور: '+e.message,true)}
};
window.bhCloudApplyImport=async(id,type,name)=>{
  try{
    const r=await fetch('/api/imports/file?id='+encodeURIComponent(id),{headers:headers({'Content-Type':''})});
    if(!r.ok)throw new Error((await r.json()).error);
    const blob=await r.blob(),file=new File([blob],name,{type:r.headers.get('content-type')||blob.type});
    if(/fuel|diesel|ديزل/i.test(type)){if(typeof opsGo==='function')opsGo('fleet');await opsImportFuelWorkbookPrimary(file)}
    else{if(typeof opsGo==='function')opsGo('movements');await opsImportDailyMovement(file)}
    await api('/api/imports/status',{method:'POST',body:JSON.stringify({id,status:'opened_in_program'})});
    load();
  }catch(e){toast(e.message,true)}
};

/* ============================================================
   بدء التشغيل — يشمل إصلاح حلقة الريفريش (2026-07-19):
   الاستعادة من السحابة تحدث فقط لو النسخة السحابية فيها بيانات
   فعلًا، ومحاولة واحدة فقط لكل تبويب عبر sessionStorage. النسخة
   المستعادة تُختم بوقت جديد حتى لا تُستبدل بنسخة IndexedDB أقدم.
   ============================================================ */
async function initCloud(){
  await status();
  S.pending=!!localStorage.getItem(QK);
  if(S.configured&&token())try{
    const r=await api('/api/state'),lr=rev(),rr=Number(r.revision||0);
    if(r.payload&&!hasData()){
      const p=r.payload,cnt=a=>Array.isArray(a)?a.length:0;
      const total=cnt(p.legacy&&p.legacy.emp)+cnt(p.legacy&&p.legacy.veh)+cnt(p.legacy&&p.legacy.cli)+cnt(p.ops&&p.ops.movements)+cnt(p.ops&&p.ops.fuel)+cnt(p.ops&&p.ops.maintenance);
      let tried=false;try{tried=sessionStorage.getItem('bh_restore_try')==='1'}catch{}
      if(total>0&&!tried){
        try{sessionStorage.setItem('bh_restore_try','1')}catch{}
        if(p.ops){p.ops.meta=p.ops.meta||{};p.ops.meta.updatedAt=new Date().toISOString();}
        if(p.legacy)localStorage.setItem('binhamid_v1',JSON.stringify(p.legacy));
        if(p.ops)localStorage.setItem('binhamid_factory_control_v3',JSON.stringify(p.ops));
        setRev(rr);location.reload();return;
      }
      setRev(rr);S.error=total>0?'':'النسخة السحابية فارغة';
    }else{
      try{sessionStorage.removeItem('bh_restore_try')}catch{}
    }
    if(r.payload&&hasData()&&(lr===0||rr>lr))S.error='النسخة السحابية أحدث';
    else if(localStorage.getItem(QK))push('إرسال تغييرات معلقة');
  }catch(e){S.error=e.message}
  badge();
}
function init(){ui();patchSave();initCloud();console.info('[BinHamid]',V,'loaded')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,1700));
else setTimeout(init,1700);
})();
