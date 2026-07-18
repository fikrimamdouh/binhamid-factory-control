(function(){
  'use strict';
  const VERSION='2026.07.18-telegram-site-two-way-v2',SEEN_KEY='binhamid_two_way_seen',AUTO_KEY='binhamid_cloud_auto_import',TOKEN_KEY='binhamid_cloud_access_token',POLL_MS=15000;
  let busy=false,timer=null,lastDashboard=null;
  const dailyTypes=new Set(['daily_movement','block_daily_movement','concrete_daily_movement']);
  const readSeen=()=>{try{return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)||'[]'));}catch{return new Set();}};
  const writeSeen=set=>{try{localStorage.setItem(SEEN_KEY,JSON.stringify([...set].slice(-500)));}catch{}};
  const accessToken=()=>{const value=String(localStorage.getItem(TOKEN_KEY)||'').trim();return value==='device-session'?'':value;};
  const toast=(message,bad=false)=>{if(typeof window.opsToast==='function')window.opsToast(message,bad?'err':undefined);else console[bad?'error':'info']('[BinHamid two-way]',message);};
  async function request(path,options={}){
    const token=accessToken();
    if(!token)throw Object.assign(new Error('تسجيل دخول الإدارة مطلوب لمزامنة Telegram مع الموقع.'),{status:401,code:'ADMIN_AUTH_REQUIRED'});
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(options.headers||{})}}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||data.message||`HTTP ${response.status}`),{status:response.status,data});
    return data;
  }
  async function setStatus(row,status,note){return request('/api/imports/status',{method:'POST',body:JSON.stringify({id:row.id,status,note})});}
  function uiBusy(){return Boolean(document.querySelector('.modal.on,.bh-login.on,[role="dialog"][open]'));}
  function eligible(row,seen){return row&&row.id&&row.source==='telegram'&&row.status==='ready'&&dailyTypes.has(String(row.report_type||''))&&row.file_path&&!seen.has(row.id);}
  async function applyRow(row,seen){
    if(typeof window.bhCloudApplyImport!=='function')return false;
    try{
      await window.bhCloudApplyImport(row.id,row.report_type||'',row.original_name||'report.xlsx');
      seen.add(row.id);writeSeen(seen);
      await setStatus(row,'opened_in_program','تم تنزيل الملف وفتحه في البرنامج للمراجعة قبل الاعتماد.');
      toast(`وصل ملف Telegram وفتح للمراجعة: ${row.original_name||'report.xlsx'}`);
      return true;
    }catch(error){
      toast(`وصل الملف إلى مركز الوارد، لكن تعذر فتحه: ${error?.message||error}`,true);
      return false;
    }
  }
  async function poll(){
    if(busy||document.hidden||!navigator.onLine||!accessToken())return;
    busy=true;
    try{
      const dashboard=await request('/api/dashboard?persistAlerts=false');lastDashboard=dashboard;
      window.dispatchEvent(new CustomEvent('binhamid:two-way-dashboard',{detail:dashboard}));
      const rows=Array.isArray(dashboard.imports)?dashboard.imports:[],seen=readSeen(),automatic=localStorage.getItem(AUTO_KEY)==='1';
      const unread=rows.filter(row=>row?.source==='telegram'&&!['approved','rejected','opened_in_program','posted'].includes(row.status));
      window.BinHamidTwoWayAutomation={version:VERSION,ready:true,lastPollAt:new Date().toISOString(),pending:unread.length,imports:rows.slice(0,50),automatic};
      if(!automatic||uiBusy())return;
      const next=rows.find(row=>eligible(row,seen));if(next)await applyRow(next,seen);
    }catch(error){window.BinHamidTwoWayAutomation={version:VERSION,ready:false,error:String(error?.message||error),lastPollAt:new Date().toISOString()};if(error?.status!==401)console.warn('[BinHamid two-way poll]',error?.message||error);}
    finally{busy=false;}
  }
  function start(){clearInterval(timer);poll();timer=setInterval(poll,POLL_MS);addEventListener('online',poll);addEventListener('focus',poll);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});window.BinHamidTwoWayPoll=poll;console.info('[BinHamid]',VERSION,'loaded');}
  const wait=setInterval(()=>{if(typeof window.bhCloudApplyImport==='function'){clearInterval(wait);start();}},300);setTimeout(()=>{clearInterval(wait);if(!timer)start();},20000);
})();
