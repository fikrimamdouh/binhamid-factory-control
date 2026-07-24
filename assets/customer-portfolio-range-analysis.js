// [BinHamid] 2026.07.24-customer-portfolio-range-analysis-v1
// تحليل مالي للفترة فقط. لا يملك الطباعة أو الاعتماد أو إرسال Telegram.
(function(){
  'use strict';
  if(window.__BH_CUSTOMER_PORTFOLIO_RANGE_ANALYSIS__)return;
  window.__BH_CUSTOMER_PORTFOLIO_RANGE_ANALYSIS__=true;

  const VERSION='2026.07.24-customer-portfolio-range-analysis-v1';
  const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const iso=value=>/^\d{4}-\d{2}-\d{2}$/.test(clean(value).slice(0,10))?clean(value).slice(0,10):'';
  const fmt=value=>{const date=iso(value);if(!date)return'—';const[y,m,d]=date.split('-');return`${d}/${m}/${y}`;};
  const riyadhToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const addDays=(value,days)=>{const date=new Date(`${iso(value)}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
  let current=null,attempts=0;

  function byId(id){return document.getElementById(id);}
  function sectorValue(){const value=clean(byId('pcSeg')?.value);return value==='بلوك'?'block':value==='خرسانة'?'concrete':'all';}
  function employeeValue(){return clean(byId('pcEmp')?.value);}
  function setMessage(text,error=false){const node=byId('bhPortfolioAnalysisMessage');if(!node)return;node.textContent=text||'';node.style.color=error?'#9d302a':'#637985';}
  function statusClass(status){return({settled:'ok',partial:'part',unpaid:'bad',no_prior_debt:'neutral',new_debt:'warn'})[status]||'neutral';}
  function declarationButton(){return[...document.querySelectorAll('button')].find(button=>/\bprCli\s*\(/.test(button.getAttribute('onclick')||''))||null;}

  function style(){
    if(byId('bh-portfolio-analysis-style'))return;
    const node=document.createElement('style');node.id='bh-portfolio-analysis-style';node.textContent=`
      #bh-portfolio-analysis{grid-column:1/-1;margin-top:12px;border:1px solid var(--line,#ddd6ca);border-radius:12px;background:#fff;padding:14px;box-shadow:0 4px 16px rgba(20,66,95,.06)}
      .bh-pa-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid var(--line,#e5dfd5);padding-bottom:9px;margin-bottom:10px}.bh-pa-head h3{margin:0;color:#14425f;font-size:16px}.bh-pa-head p{margin:3px 0 0;color:#667985;font-size:11px}.bh-pa-version{font-size:8px;color:#a3a3a3}
      .bh-pa-presets,.bh-pa-actions{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.bh-pa-presets button{border:1px solid #d6cec0;background:#fff;color:#14425f;border-radius:7px;padding:6px 10px;cursor:pointer}.bh-pa-presets button:hover{border-color:#b4893a;color:#805b1d}
      .bh-pa-filters{display:grid;grid-template-columns:minmax(150px,1fr) minmax(170px,1fr);gap:8px;margin:8px 0}.bh-pa-filters label{font-size:11px;color:#14425f}.bh-pa-filters select,.bh-pa-filters input{margin-top:4px;width:100%}
      .bh-pa-message{min-height:20px;font-size:11px;padding:4px 0}.bh-pa-note{background:#f6efe3;border-right:3px solid #b4893a;color:#6c5222;padding:8px 10px;border-radius:5px;font-size:11px;margin:8px 0}
      .bh-pa-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:7px;margin:9px 0}.bh-pa-kpi{border:1px solid #e5dfd5;background:#fcfaf7;border-radius:8px;padding:8px}.bh-pa-kpi span{display:block;font-size:10px;color:#70818a}.bh-pa-kpi b{display:block;margin-top:3px;font-size:14px;color:#173746}.bh-pa-kpi.alert b{color:#9d302a}.bh-pa-kpi.good b{color:#23704a}
      .bh-pa-table{overflow:auto;border:1px solid #e5dfd5;border-radius:8px}.bh-pa-table table{min-width:1160px;width:100%;border-collapse:collapse}.bh-pa-table th{background:#14425f;color:#f0dcb4;padding:7px 6px;font-size:10px;white-space:nowrap}.bh-pa-table td{padding:7px 6px;border-bottom:1px solid #eee8dd;text-align:center;font-size:10.5px}.bh-pa-table td.name{text-align:right;min-width:180px}.bh-pa-table tr:nth-child(even){background:#fcfaf7}.bh-pa-status{display:inline-block;border-radius:99px;padding:2px 8px;font-size:9.5px;font-weight:700;white-space:nowrap}.bh-pa-status.ok{background:#e4f3eb;color:#1f7249}.bh-pa-status.part{background:#fff1cf;color:#805d16}.bh-pa-status.bad{background:#f7e6e4;color:#9d302a}.bh-pa-status.warn{background:#f6eddb;color:#805d16}.bh-pa-status.neutral{background:#edf1f2;color:#4d6875}
      @media(max-width:700px){.bh-pa-filters{grid-template-columns:1fr}.bh-pa-actions .btn{width:100%}}
    `;document.head.appendChild(node);
  }

  function markup(){return`
    <div class="bh-pa-head"><div><h3>متابعة سداد محفظة العملاء</h3><p>تحليل الرصيد السابق والمبيعات والتحصيلات بين تاريخين، مع بيان من صفّى القديم ومن سدد جزئيًا.</p></div><span class="bh-pa-version">${VERSION}</span></div>
    <div class="bh-pa-presets"><button type="button" data-bh-pa-days="7">آخر 7 أيام</button><button type="button" data-bh-pa-days="10">آخر 10 أيام</button><button type="button" data-bh-pa-days="30">آخر 30 يومًا</button><button type="button" data-bh-pa-month="1">الشهر الحالي</button></div>
    <div class="bh-pa-filters"><label>حالة السداد<select id="bhPortfolioStatus"><option value="all">كل الحالات</option><option value="settled">صفّى الرصيد السابق</option><option value="partial">سداد جزئي للقديم</option><option value="unpaid">لم يسدد من القديم</option><option value="no_prior_debt">لا يوجد رصيد سابق</option><option value="new_debt">مديونية جديدة خلال الفترة</option></select></label><label>بحث عميل<input id="bhPortfolioSearch" type="search" placeholder="اسم العميل أو الكود أو الجوال"></label></div>
    <div class="bh-pa-actions"><button type="button" id="bhPortfolioAnalyze" class="btn btn-p">عرض وتحليل الفترة</button><button type="button" id="bhPortfolioOpenDeclaration" class="btn btn-o">فتح الإقرار بنفس تصميم الموقع</button></div>
    <div id="bhPortfolioAnalysisMessage" class="bh-pa-message"></div><div id="bhPortfolioAnalysisResult"></div>`;}

  function query(){
    return new URLSearchParams({route:'customer-portfolio/range',from:byId('pcFrom')?.value||'',to:byId('pcTo')?.value||'',sector:sectorValue(),employee:employeeValue(),status:byId('bhPortfolioStatus')?.value||'all',search:byId('bhPortfolioSearch')?.value||''});
  }
  function kpis(data){const s=data.summary||{},items=[['العملاء',s.customerCount,''],['رصيد أول الفترة',`${money(s.openingDebt)} ر.س`,''],['مبيعات الفترة',`${money(s.sales)} ر.س`,''],['تحصيلات الفترة',`${money(s.collections)} ر.س`,'good'],['المسدّد من القديم',`${money(s.oldDebtPaid)} ر.س`,'good'],['متبقي القديم',`${money(s.oldDebtRemaining)} ر.س`,'alert'],['الرصيد الختامي',`${money(s.closingBalance)} ر.س`,''],['دفعات مقدمة',`${money(s.advance)} ر.س`,''],['صفّوا القديم',s.settledCount,'good'],['سداد جزئي',s.partialCount,''],['لم يسددوا',s.unpaidCount,'alert']];return`<div class="bh-pa-kpis">${items.map(([label,value,cls])=>`<div class="bh-pa-kpi ${cls}"><span>${label}</span><b>${value??0}</b></div>`).join('')}</div>`;}
  function table(data){if(!data.rows?.length)return'<div class="bh-pa-note">لا توجد أرصدة أو حركات مطابقة للفترة والفلاتر المحددة.</div>';return`<div class="bh-pa-table"><table><thead><tr><th>العميل</th><th>رصيد أول الفترة</th><th>مبيعات الفترة</th><th>تحصيلات الفترة</th><th>المسدّد من القديم</th><th>متبقي القديم</th><th>المسدّد من مبيعات الفترة</th><th>دفعة مقدمة</th><th>الرصيد الختامي</th><th>الحالة</th><th>آخر بيع</th><th>آخر تحصيل</th></tr></thead><tbody>${data.rows.map(row=>`<tr><td class="name"><b>${esc(row.customerName)}</b><div class="muted mono">${esc(row.customerCode||row.phone||'')}</div></td><td>${money(row.openingDebt)}</td><td>${money(row.periodSales)}</td><td>${money(row.periodCollections)}</td><td>${money(row.oldDebtPaid)}</td><td>${money(row.oldDebtRemaining)}</td><td>${money(row.currentSalesPaid)}</td><td>${money(row.advance)}</td><td><b>${money(row.closingBalance)}</b></td><td><span class="bh-pa-status ${statusClass(row.status)}">${esc(row.statusLabel)}</span></td><td>${fmt(row.lastSaleDate)}</td><td>${fmt(row.lastCollectionDate)}</td></tr>`).join('')}</tbody></table></div>`;}
  function render(data){current=data;const result=byId('bhPortfolioAnalysisResult');if(result)result.innerHTML=`<div class="bh-pa-note"><b>الفترة:</b> ${fmt(data.from)} إلى ${fmt(data.to)} — <b>آخر يوم حركة فعلية:</b> ${fmt(data.latestActivityDate)}${data.latestReportDate&&data.latestReportDate!==data.latestActivityDate?` — آخر دفعة معتمدة إداريًا: ${fmt(data.latestReportDate)}`:''}<br>${esc(data.allocationRule||'')}</div>${kpis(data)}${table(data)}`;setMessage(`تم تحليل ${data.rows?.length||0} عميل.`);}
  async function load(){const button=byId('bhPortfolioAnalyze');button.disabled=true;setMessage('جارٍ قراءة الأرصدة والمبيعات والتحصيلات من قاعدة البيانات...');try{const response=await fetch(`/api/router?${query()}`,{credentials:'same-origin',cache:'no-store'}),data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw new Error(data.error||`HTTP ${response.status}`);render(data);return data;}catch(error){current=null;byId('bhPortfolioAnalysisResult').innerHTML='';setMessage(`تعذر تحليل الفترة: ${error.message}`,true);throw error;}finally{button.disabled=false;}}
  function applyDays(days){const to=iso(byId('pcTo')?.value)||current?.latestActivityDate||riyadhToday();byId('pcTo').value=to;byId('pcFrom').value=addDays(to,-(days-1));load().catch(()=>{});}
  function openDeclaration(){const button=declarationButton();if(!button)return setMessage('زر الإقرار الأصلي غير جاهز.',true);if(!employeeValue())return setMessage('اختر مسؤول المبيعات أولًا.',true);if(sectorValue()==='all')return setMessage('اختر قطاع البلوك أو الخرسانة أولًا.',true);button.click();}
  function bind(root){byId('bhPortfolioAnalyze').onclick=()=>load().catch(()=>{});byId('bhPortfolioOpenDeclaration').onclick=openDeclaration;root.querySelectorAll('[data-bh-pa-days]').forEach(button=>button.onclick=()=>applyDays(Number(button.dataset.bhPaDays)));root.querySelector('[data-bh-pa-month]').onclick=()=>{const to=iso(byId('pcTo')?.value)||current?.latestActivityDate||riyadhToday();byId('pcTo').value=to;byId('pcFrom').value=`${to.slice(0,7)}-01`;load().catch(()=>{});};}
  function install(){attempts++;const range=byId('bh-portfolio-date-range'),employee=byId('pcEmp'),segment=byId('pcSeg');if(!range||!employee||!segment){if(attempts<160)return setTimeout(install,250);return console.warn('[BinHamid]',VERSION,'range controls not found');}if(byId('bh-portfolio-analysis'))return;style();const root=document.createElement('section');root.id='bh-portfolio-analysis';root.innerHTML=markup();range.after(root);bind(root);setTimeout(()=>load().catch(()=>{}),0);console.info('[BinHamid]',VERSION,'ready');}
  install();
})();
