(function(){
  'use strict';
  const TOKEN_KEY='binhamid_cloud_access_token';
  const state={file:null,base64:'',preview:null,busy:false};
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=value=>Number(value||0).toLocaleString('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2});
  const qty=value=>Number(value||0).toLocaleString('ar-SA',{maximumFractionDigits:3});
  const today=()=>new Date(Date.now()+3*60*60*1000).toISOString().slice(0,10);

  function style(){
    if($('bhDailyReportStyle'))return;
    const node=document.createElement('style');node.id='bhDailyReportStyle';node.textContent=`
      .bh-dr-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.bh-dr-head h2{margin:0;flex:1;color:#14425f}
      .bh-dr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}.bh-dr-kpi{background:#fff;border:1px solid #e2dcd1;border-inline-start:4px solid #b4893a;border-radius:9px;padding:12px}.bh-dr-kpi b{display:block;font-size:22px;color:#14425f}.bh-dr-kpi span{font-size:11px;color:#6e6e6e}
      .bh-dr-panel{background:#fff;border:1px solid #e2dcd1;border-radius:10px;padding:16px;margin-bottom:14px}.bh-dr-form{display:grid;grid-template-columns:minmax(220px,1fr) 180px auto;gap:10px;align-items:end}.bh-dr-form label{margin:0}.bh-dr-form input{width:100%}
      .bh-dr-btn{border:0;border-radius:8px;padding:10px 15px;font:inherit;font-weight:700;cursor:pointer;background:#14425f;color:#fff}.bh-dr-btn.gold{background:#b4893a}.bh-dr-btn.ghost{background:#eef2f3;color:#14425f}.bh-dr-btn:disabled{opacity:.45;cursor:not-allowed}
      .bh-dr-msg{margin-top:10px;padding:10px 12px;border-radius:8px;background:#eef7f2;color:#1f6b48}.bh-dr-msg.bad{background:#fff0f0;color:#8b2525}.bh-dr-msg.warn{background:#fff8e8;color:#7a5a16}
      .bh-dr-table{width:100%;border-collapse:collapse;font-size:12px;min-width:850px}.bh-dr-table th{background:#14425f;color:#fff;padding:8px;text-align:right}.bh-dr-table td{padding:7px;border-bottom:1px solid #eee8de}.bh-dr-scroll{overflow:auto;border:1px solid #e2dcd1;border-radius:9px}.bh-dr-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.bh-dr-tabs button{border:1px solid #d8d1c6;background:#fff;border-radius:7px;padding:7px 11px;cursor:pointer}.bh-dr-tabs button.on{background:#b4893a;color:#fff;border-color:#b4893a}.bh-dr-section{display:none}.bh-dr-section.on{display:block}.bh-dr-issue{color:#9a2e2e;font-weight:700}.bh-dr-ok{color:#1f7a4c;font-weight:700}
      @media(max-width:720px){.bh-dr-form{grid-template-columns:1fr}.bh-dr-head{align-items:flex-start}.bh-dr-kpi b{font-size:19px}}
    `;document.head.appendChild(node);
  }

  async function api(payload){
    const token=localStorage.getItem(TOKEN_KEY)||'';
    const response=await fetch('/api/imports/daily-report',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'تعذر تنفيذ استيراد التقرير اليومي');
    return data;
  }

  async function toBase64(file){
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';const step=0x8000;
    for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));
    return btoa(binary);
  }

  function message(text,type=''){
    const node=$('bhDrMessage');if(!node)return;node.className=`bh-dr-msg ${type}`.trim();node.textContent=text;node.style.display=text?'block':'none';
  }

  function summaryHtml(summary){
    const items=[[summary.salesLines,'سطور المبيعات'],[summary.uniqueInvoices,'أرقام الفواتير'],[money(summary.salesTotal),'إجمالي المديونية'],[summary.block.lines,'فواتير البلوك'],[qty(summary.block.quantity),'كمية البلوك'],[money(summary.block.amount),'مديونية البلوك'],[summary.concrete.lines,'فواتير الخرسانة'],[qty(summary.concrete.quantity),'م³ الخرسانة'],[money(summary.concrete.amount),'مديونية الخرسانة'],[summary.collections.count,'تحصيلات العملاء'],[money(summary.collections.amount),'إجمالي التحصيل'],[summary.cashMovements,'كل حركات الخزن']];
    return items.map(([value,label])=>`<div class="bh-dr-kpi"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('');
  }

  function salesTable(rows){return `<div class="bh-dr-scroll"><table class="bh-dr-table"><thead><tr><th>صف</th><th>الفاتورة</th><th>النوع</th><th>الكمية</th><th>كود العميل</th><th>العميل</th><th>الصنف</th><th>المديونية</th><th>الحالة</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.sourceRowNo}</td><td>${esc(row.invoiceNo)}</td><td>${row.salesType==='block'?'بلوك':row.salesType==='concrete'?'خرسانة':'غير محدد'}</td><td>${qty(row.quantity)}</td><td>${esc(row.customerCode)}</td><td>${esc(row.customerName)}</td><td>${esc(row.item)}</td><td>${money(row.amount)}</td><td class="${row.issues.length?'bh-dr-issue':'bh-dr-ok'}">${row.issues.length?esc(row.issues.join('، ')):'جاهز'}</td></tr>`).join('')}</tbody></table></div>`;}
  function collectionsTable(rows){return `<div class="bh-dr-scroll"><table class="bh-dr-table"><thead><tr><th>صف</th><th>الخزينة</th><th>طريقة السداد</th><th>رقم الإذن</th><th>كود العميل</th><th>العميل</th><th>المبلغ</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.sourceRowNo}</td><td>${esc(row.treasuryCode)} — ${esc(row.treasuryName)}</td><td>${row.paymentMethod==='pos'?'نقاط بيع':'نقدي'}</td><td>${esc(row.voucherNo)}</td><td>${esc(row.customerCode)}</td><td>${esc(row.customerName)}</td><td>${money(row.amount)}</td></tr>`).join('')}</tbody></table></div>`;}
  function cashTable(rows){return `<div class="bh-dr-scroll"><table class="bh-dr-table"><thead><tr><th>صف</th><th>الخزينة</th><th>مدين</th><th>دائن</th><th>الحساب</th><th>نوع الحساب</th><th>الكود</th><th>الحركة</th><th>الإذن</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.sourceRowNo}</td><td>${esc(row.treasuryCode)}</td><td>${money(row.debit)}</td><td>${money(row.credit)}</td><td>${esc(row.accountName)}</td><td>${esc(row.accountType)}</td><td>${esc(row.accountCode)}</td><td>${esc(row.movementType)}</td><td>${esc(row.voucherNo)}</td></tr>`).join('')}</tbody></table></div>`;}
  function inventoryTable(rows){return `<div class="bh-dr-scroll"><table class="bh-dr-table"><thead><tr><th>صف</th><th>القسم</th><th>كود الصنف</th><th>الصنف</th><th>الوحدة</th><th>أول المدة</th><th>وارد</th><th>منصرف</th><th>الرصيد</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.sourceRowNo}</td><td>${row.inventoryType==='finished_goods'?'منتج تام':'خامة'}</td><td>${esc(row.itemCode)}</td><td>${esc(row.itemName)}</td><td>${esc(row.unit)}</td><td>${qty(row.opening)}</td><td>${qty(row.received)}</td><td>${qty(row.issued)}</td><td>${qty(row.closing)}</td></tr>`).join('')}</tbody></table></div>`;}

  function showSection(name){document.querySelectorAll('.bh-dr-section').forEach(node=>node.classList.toggle('on',node.dataset.section===name));document.querySelectorAll('.bh-dr-tabs button').forEach(node=>node.classList.toggle('on',node.dataset.section===name));}
  function renderPreview(data){state.preview=data;$('bhDrSummary').innerHTML=summaryHtml(data.summary);$('bhDrSales').innerHTML=salesTable(data.preview.sales||[]);$('bhDrCollections').innerHTML=collectionsTable(data.preview.collections||[]);$('bhDrCash').innerHTML=cashTable(data.preview.cashMovements||[]);$('bhDrInventory').innerHTML=inventoryTable(data.preview.inventory||[]);$('bhDrCommit').disabled=Boolean(data.summary.blockedSalesLines)||!data.summary.salesLines;const issueText=data.summary.blockedSalesLines?`يوجد ${data.summary.blockedSalesLines} سطر مبيعات غير صالح. لن يسمح النظام بالاعتماد حتى تصحيحه.`:`المعاينة جاهزة. الاعتماد سيرحل المبيعات آجلًا والتحصيلات من الخزن فقط، ويمنع تكرار تقرير نفس التاريخ.`;message(issueText,data.summary.blockedSalesLines?'bad':'warn');showSection('sales');}

  async function preview(){if(state.busy)return;const file=$('bhDrFile').files?.[0];if(!file)return message('اختر ملف ملخص العمل اليومي.','bad');state.busy=true;$('bhDrPreview').disabled=true;$('bhDrCommit').disabled=true;message('جارٍ قراءة أقسام المبيعات والخزن والمخزون...');try{state.file=file;state.base64=await toBase64(file);const data=await api({action:'preview',fileName:file.name,fileBase64:state.base64});renderPreview(data);}catch(error){state.preview=null;$('bhDrSummary').innerHTML='';message(error.message,'bad');}finally{state.busy=false;$('bhDrPreview').disabled=false;}}
  async function commit(){if(state.busy||!state.preview||!state.base64)return;const reportDate=$('bhDrDate').value;if(!reportDate)return message('حدد تاريخ التقرير قبل الاعتماد.','bad');state.busy=true;$('bhDrPreview').disabled=true;$('bhDrCommit').disabled=true;message('جارٍ اعتماد التقرير وترحيل المبيعات والتحصيلات...');try{const data=await api({action:'commit',fileName:state.file?.name||'daily-report.xlsx',fileBase64:state.base64,reportDate});const duplicate=data.duplicate?'التقرير مسجل سابقًا ولم تُكرر أي حركة.':'تم الاعتماد: المبيعات ظهرت في أوامر البيع والتقارير، والتحصيلات ظهرت في التحصيل والخزن ووزعت FIFO، وتم إنشاء قيود إيراد جاهزة لمحرك التكلفة.';message(duplicate);$('bhDrCommit').disabled=true;}catch(error){message(error.message,'bad');$('bhDrCommit').disabled=Boolean(state.preview.summary.blockedSalesLines);}finally{state.busy=false;$('bhDrPreview').disabled=false;}}

  function pane(){const wrap=document.querySelector('.wrap');if(!wrap||$('p-daily-report'))return;const node=document.createElement('div');node.className='pane';node.id='p-daily-report';node.innerHTML=`<div class="bh-dr-head"><h2>استيراد ملخص العمل اليومي</h2><span>المبيعات ← التحصيلات ← الخزن ← المخزون ← محرك التكلفة</span></div><div class="bh-dr-panel"><div class="bh-dr-form"><label>ملف Excel<input id="bhDrFile" type="file" accept=".xlsx,.xls"></label><label>تاريخ التقرير<input id="bhDrDate" type="date" value="${today()}"></label><div><button class="bh-dr-btn" id="bhDrPreview">قراءة ومعاينة</button> <button class="bh-dr-btn gold" id="bhDrCommit" disabled>اعتماد وترحيل</button></div></div><div id="bhDrMessage" class="bh-dr-msg" style="display:none"></div></div><div id="bhDrSummary" class="bh-dr-grid"></div><div class="bh-dr-tabs"><button class="on" data-section="sales">المبيعات</button><button data-section="collections">تحصيلات العملاء</button><button data-section="cash">كل حركات الخزن</button><button data-section="inventory">المخزون</button></div><section class="bh-dr-section on" data-section="sales" id="bhDrSales"></section><section class="bh-dr-section" data-section="collections" id="bhDrCollections"></section><section class="bh-dr-section" data-section="cash" id="bhDrCash"></section><section class="bh-dr-section" data-section="inventory" id="bhDrInventory"></section>`;wrap.appendChild(node);$('bhDrPreview').onclick=preview;$('bhDrCommit').onclick=commit;node.querySelectorAll('.bh-dr-tabs button').forEach(button=>button.onclick=()=>showSection(button.dataset.section));}
  function open(){pane();document.querySelectorAll('.pane').forEach(node=>node.classList.toggle('on',node.id==='p-daily-report'));document.querySelectorAll('#tabs button').forEach(node=>node.classList.toggle('on',node.id==='bhDailyReportTab'));}
  function install(){style();pane();const tabs=$('tabs');if(tabs&&!$('bhDailyReportTab')){const button=document.createElement('button');button.id='bhDailyReportTab';button.innerHTML='<span class="ic">▦</span>التقرير اليومي';button.onclick=open;tabs.appendChild(button);}}
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});setInterval(install,1200);install();
})();
