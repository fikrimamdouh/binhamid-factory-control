// [BinHamid] 2026.07.20-bot-interactions-log-v1
// قسم «سجل تفاعلات البوت» داخل مركز الاتصال: جدول للمدير يعرض آخر من تواصل
// مع البوت، ماذا أرسل وبماذا ردّ البوت، عدد رسائل كل مستخدم، آخر نشاط بتوقيت
// السعودية، الدور والحالة، مع بحث وتصفية وفتح سجل المحادثة كاملًا.
// يعتمد كليًا على المسارات الموجودة (/api/conversations و/api/dashboard)
// المحمية بتحقق خادمي للمدير — لا بوت جديد، لا webhook جديد، لا جداول جديدة.
(function(){
  'use strict';
  var VERSION='2026.07.20-bot-interactions-log-v1';
  var threads=[],usersById={},importsById={},activeChat='',searchTimer=null;

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function el(id){return document.getElementById(id);}
  function root(){return el('bhCommsRoot');}
  var ROLES={pending:'بانتظار الاعتماد',admin:'مدير النظام',manager:'مدير',accountant:'محاسب',mechanic:'ميكانيكي',block_sales:'مندوب بلوك',concrete_sales:'مندوب خرسانة',collector:'محصل'};
  var TYPES={text:'نص',voice:'صوت',photo:'صورة',document:'ملف',location:'موقع',contact:'جهة اتصال',other:'أخرى'};
  var saudi=new Intl.DateTimeFormat('ar-SA-u-nu-latn',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  function fmt(value){if(!value)return '—';try{return saudi.format(new Date(value));}catch(_){return String(value).slice(0,16);}}
  function isCommand(thread){return String(thread.last_message||'').trim().startsWith('/')?'أمر':TYPES[thread.last_message_type]||thread.last_message_type||'';}
  function statusInfo(thread){
    // «بانتظار الاعتماد» عندما ترتبط آخر رسالة واردة باستيراد لم يُعتمد بعد.
    if(thread.last_related_type==='import'){
      var imp=importsById[String(thread.last_related_id||'')];
      if(imp&&['approved','rejected','opened_in_program'].indexOf(String(imp.status))<0)return{label:'بانتظار الاعتماد',tone:'wait'};
    }
    var s=String(thread.last_status||'');
    if(s==='failed')return{label:'فشلت',tone:'bad'};
    if(s==='delivered'||s==='sent')return{label:'نجحت',tone:'ok'};
    if(s==='processing')return{label:'قيد المعالجة',tone:'wait'};
    return{label:'تم الاستلام',tone:'wait'};
  }
  function userInfo(thread){return usersById[String(thread.external_user_id||'')]||null;}

  function style(){
    if(el('bh-botlog-style'))return;
    var s=document.createElement('style');s.id='bh-botlog-style';
    s.textContent='.bh-botlog-toolbar{display:grid;grid-template-columns:2fr repeat(4,1fr) auto;gap:8px;margin-bottom:10px}.bh-botlog-toolbar input,.bh-botlog-toolbar select{border:1px solid #d7d0c5;border-radius:9px;padding:9px 10px;font:inherit;background:#fff;min-width:0}.bh-botlog-toolbar button{border:0;border-radius:9px;padding:9px 13px;background:#0d7896;color:#fff;cursor:pointer}.bh-botlog-pill{display:inline-block;font-size:10px;border-radius:999px;padding:3px 8px;background:#edf3f5;color:#37515e}.bh-botlog-pill.ok{background:#e2f4e7;color:#1e6b34}.bh-botlog-pill.bad{background:#fde9e9;color:#8b2525}.bh-botlog-pill.wait{background:#fdf3da;color:#7a5c14}.bh-botlog-msg{color:#5d6b72;font-size:12px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bh-botlog-log{margin-top:14px;background:#f7f4ee;border:1px solid #e2ddd3;border-radius:14px;padding:14px;max-height:520px;overflow:auto}.bh-botlog-row{margin:7px 0;display:flex}.bh-botlog-row.out{justify-content:flex-end}.bh-botlog-bubble{max-width:min(80%,640px);background:#fff;border:1px solid #e1ddd5;border-radius:12px;padding:9px 11px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.bh-botlog-row.out .bh-botlog-bubble{background:#dff3e4;border-color:#c8e3ce}.bh-botlog-bubble small{display:block;color:#7d898e;font-size:10px;margin-top:5px;text-align:left}.bh-botlog-bubble b{display:block;font-size:11px;color:#60727b;margin-bottom:4px}';
    document.head.appendChild(s);
  }

  function ensureButton(){
    var side=document.querySelector('.bh-side');
    if(!side||el('bhBotLogNav'))return;
    var b=document.createElement('button');
    b.id='bhBotLogNav';b.type='button';b.textContent='سجل تفاعلات البوت';b.onclick=open;
    var conv=el('bhConversationsNav');
    side.insertBefore(b,conv?conv.nextSibling:null);
  }
  function setActive(){document.querySelectorAll('.bh-side button').forEach(function(x){x.classList.toggle('on',x.id==='bhBotLogNav');});}

  function shell(){
    var r=root();if(!r)return;
    r.innerHTML='<div class="bh-botlog-toolbar">'
      +'<input id="bhBotLogSearch" placeholder="بحث بالاسم أو Telegram ID أو Username أو نص الرسالة">'
      +'<select id="bhBotLogType"><option value="">كل الأنواع</option><option value="text">نص</option><option value="voice">صوت</option><option value="photo">صورة</option><option value="document">ملف</option></select>'
      +'<select id="bhBotLogStatus"><option value="">كل الحالات</option><option value="delivered">نجحت</option><option value="failed">فشلت</option><option value="pending_approval">بانتظار الاعتماد</option><option value="received">تم الاستلام</option></select>'
      +'<input type="date" id="bhBotLogFrom" title="من تاريخ"><input type="date" id="bhBotLogTo" title="إلى تاريخ">'
      +'<button id="bhBotLogRefresh">تحديث</button></div>'
      +'<div class="bh-table-wrap" id="bhBotLogTable"><div style="padding:22px;color:#718087">جاري تحميل سجل التفاعلات...</div></div>'
      +'<div id="bhBotLogThread"></div>';
    el('bhBotLogRefresh').onclick=function(){load();};
    el('bhBotLogSearch').oninput=function(){clearTimeout(searchTimer);searchTimer=setTimeout(load,300);};
    ['bhBotLogType','bhBotLogStatus','bhBotLogFrom','bhBotLogTo'].forEach(function(id){el(id).onchange=load;});
  }

  function query(){
    var p=new URLSearchParams({limit:'1000'});
    var q=el('bhBotLogSearch').value.trim();if(q)p.set('q',q);
    var t=el('bhBotLogType').value;if(t)p.set('messageType',t);
    var s=el('bhBotLogStatus').value;if(s&&s!=='pending_approval')p.set('status',s);
    var f=el('bhBotLogFrom').value;if(f)p.set('from',f);
    var to=el('bhBotLogTo').value;if(to)p.set('to',to);
    return p;
  }

  async function api(url){
    var tk=String(localStorage.getItem('binhamid_cloud_access_token')||'');if(tk==='device-session')tk='';
    var uid=String(localStorage.getItem('binhamid_cloud_app_user_id')||'').trim();
    var h={};if(tk)h.Authorization='Bearer '+tk;if(uid)h['x-app-user-id']=uid;
    var r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:h});
    var d=await r.json().catch(function(){return{};});
    if(!r.ok||d.ok===false)throw new Error(d.error||('HTTP '+r.status));
    return d;
  }

  async function load(){
    var box=el('bhBotLogTable');if(!box)return;
    try{
      var results=await Promise.all([api('/api/conversations?'+query().toString()),api('/api/dashboard')]);
      threads=results[0].threads||[];
      usersById={};(results[1].users||[]).forEach(function(u){usersById[String(u.external_id)]=u;});
      importsById={};(results[1].imports||[]).forEach(function(i){importsById[String(i.id)]=i;});
      if(el('bhBotLogStatus').value==='pending_approval')threads=threads.filter(function(t){return statusInfo(t).label==='بانتظار الاعتماد';});
      render();
    }catch(error){box.innerHTML='<div style="padding:22px;color:#8b2525">تعذر التحميل: '+esc(error.message)+'</div>';}
  }

  function render(){
    var box=el('bhBotLogTable');if(!box)return;
    if(!threads.length){box.innerHTML='<div style="padding:22px;color:#718087">لا توجد تفاعلات مطابقة.</div>';return;}
    box.innerHTML='<table class="bh-table"><thead><tr><th>المستخدم</th><th>Telegram ID</th><th>الدور</th><th>حالة المستخدم</th><th>الرسائل</th><th>آخر نشاط (السعودية)</th><th>آخر رسالة</th><th>حالة المعالجة</th><th></th></tr></thead><tbody>'
      +threads.map(function(t){
        var u=userInfo(t),st=statusInfo(t),isGroup=t.chat_type&&t.chat_type!=='private';
        var name=esc(t.display_name||t.chat_id)+(t.username?' <small style="color:#0d7896">@'+esc(t.username)+'</small>':'');
        var userState=isGroup?'<span class="bh-botlog-pill">مجموعة</span>':(u?(u.active?'<span class="bh-botlog-pill ok">نشط</span>':'<span class="bh-botlog-pill wait">بانتظار الاعتماد</span>'):'<span class="bh-botlog-pill wait">بانتظار الاعتماد</span>');
        var role=ROLES[(u&&u.role)||t.role]||((u&&u.role)||t.role)||'بانتظار الاعتماد';
        return '<tr><td><b>'+name+'</b></td><td>'+esc(t.external_user_id||t.chat_id)+'</td><td>'+esc(role)+'</td><td>'+userState+'</td>'
          +'<td>'+Number(t.message_count||0)+' <small style="color:#7d898e">(وارد '+Number(t.incoming_count||0)+' / رد '+Number(t.outgoing_count||0)+')</small></td>'
          +'<td>'+esc(fmt(t.last_at))+'</td>'
          +'<td class="bh-botlog-msg" title="'+esc(t.last_message||'')+'">['+esc(isCommand(t))+'] '+(t.last_direction==='outgoing'?'رد البوت: ':'')+esc(t.last_message||'—')+'</td>'
          +'<td><span class="bh-botlog-pill '+st.tone+'">'+esc(st.label)+'</span></td>'
          +'<td><button class="bh-btn ghost" data-chat="'+esc(t.chat_id)+'">فتح السجل</button></td></tr>';
      }).join('')+'</tbody></table>';
    box.querySelectorAll('[data-chat]').forEach(function(b){b.onclick=function(){openThread(b.dataset.chat);};});
  }

  async function openThread(chatId){
    activeChat=chatId;
    var box=el('bhBotLogThread');if(!box)return;
    box.innerHTML='<div class="bh-botlog-log">جاري تحميل سجل المحادثة كاملًا...</div>';
    try{
      var d=await api('/api/conversations?chatId='+encodeURIComponent(chatId)+'&limit=1000');
      var thread=threads.find(function(t){return String(t.chat_id)===String(chatId);})||{};
      var messages=d.messages||[];
      box.innerHTML='<div class="bh-botlog-log"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>سجل المحادثة: '+esc(thread.display_name||chatId)+(thread.username?' @'+esc(thread.username):'')+'</b><button class="bh-btn ghost" id="bhBotLogClose">إغلاق</button></div>'
        +(messages.length?messages.map(function(m){
          var out=m.direction==='outgoing';
          var body=m.text||m.transcription||(m.file_name?'[ملف: '+m.file_name+']':'['+(TYPES[m.message_type]||m.message_type)+']');
          return '<div class="bh-botlog-row '+(out?'out':'')+'"><div class="bh-botlog-bubble"><b>'+(out?'رد البوت':esc(m.sender_name||m.sender_external_id||'المستخدم'))+'</b>'+esc(body)
            +(m.transcription&&m.message_type==='voice'&&m.text!==m.transcription?'<div style="margin-top:5px;font-size:11px;color:#60727b">تفريغ الصوت: '+esc(m.transcription)+'</div>':'')
            +'<small>'+esc(TYPES[m.message_type]||m.message_type)+' — '+esc(fmt(m.created_at))+(out?'':' — '+esc(m.delivery_status||''))+'</small></div></div>';
        }).join(''):'<div style="color:#718087">لا توجد رسائل محفوظة.</div>')
        +'</div>';
      el('bhBotLogClose').onclick=function(){box.innerHTML='';activeChat='';};
      box.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(error){box.innerHTML='<div class="bh-botlog-log" style="color:#8b2525">تعذر فتح السجل: '+esc(error.message)+'</div>';}
  }

  function open(){style();setActive();shell();load();}

  var attempts=0;
  (function waitAndMount(){
    if(document.querySelector('.bh-side')){ensureButton();console.log('[BinHamid] '+VERSION+' ready');return;}
    if(++attempts>300)return;
    setTimeout(waitAndMount,150);
  })();
  var observer=new MutationObserver(function(){ensureButton();});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.bhOpenBotInteractionsLog=open;
})();
