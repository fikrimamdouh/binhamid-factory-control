(function customerOpeningBalances(){
  'use strict';

  const VERSION='2026.07.18-customer-opening-balances-v1';
  const TEMPLATE='/assets/templates/binhamid-customer-opening-balances-template.xlsx';
  const normal=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/\s+/g,' ');
  const code=value=>String(value??'').trim().toUpperCase().replace(/\s+/g,'');
  const amount=value=>{const parsed=Number(String(value??'').replace(/[،,\s]/g,''));return Number.isFinite(parsed)?parsed:NaN;};
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
  const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):typeof opsToday==='function'?opsToday():new Date().toISOString().slice(0,10);

  function rows(){
    if(typeof OPS==='undefined'||!OPS)return [];
    OPS.customerOpeningBalances=Array.isArray(OPS.customerOpeningBalances)?OPS.customerOpeningBalances:[];
    return OPS.customerOpeningBalances;
  }

  function customerByCode(value){
    const key=code(value);
    return (D.cli||[]).find(item=>code(item.code)===key||(item.sourceCustomerCodes||[]).map(code).includes(key));
  }

  function existingBalance(clientId){
    return rows().filter(item=>item.clientId===clientId).reduce((sum,item)=>sum+Number(item.amount||0),0);
  }

  function lockLedger(){
    const previous=window.bhClientLedger;
    if(typeof previous!=='function'||previous.__includesOpeningBalances)return;
    const wrapped=function(clientId,requestedKind){
      const ledger=previous.call(this,clientId,requestedKind);
      if(requestedKind)return ledger;
      const opening=existingBalance(clientId);
      const net=Number(ledger.netBalance||0)+opening;
      return {...ledger,openingBalance:opening,netBalance:net,remaining:Math.max(0,net),debitBalance:Math.max(0,net),creditBalance:Math.max(0,-net)};
    };
    wrapped.__includesOpeningBalances=true;
    window.bhClientLedger=wrapped;
  }

  function headerIndex(headers,names){
    return headers.findIndex(header=>names.some(name=>normal(header).includes(normal(name))));
  }

  function parse(file){
    if(typeof XLSX==='undefined')throw new Error('قارئ Excel لم يكتمل تحميله؛ أعد فتح الصفحة ثم حاول مرة أخرى.');
    return file.arrayBuffer().then(buffer=>{
      const workbook=XLSX.read(new Uint8Array(buffer),{type:'array',cellDates:false});
      const sheetName=workbook.SheetNames.find(name=>normal(name).includes('ارصده العملاء'))||workbook.SheetNames[0];
      const data=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false});
      const headerRow=data.findIndex(row=>headerIndex(row,['كود العميل','كود'])>=0&&headerIndex(row,['الرصيد الافتتاحي','الرصيد'])>=0);
      if(headerRow<0)throw new Error('لم أجد أعمدة قالب أرصدة العملاء. نزّل القالب من زر العملاء واستخدمه دون تغيير العناوين.');
      const header=data[headerRow],indexes={code:headerIndex(header,['كود العميل','كود']),name:headerIndex(header,['اسم العميل','اسم']),segment:headerIndex(header,['القطاع']),balance:headerIndex(header,['الرصيد الافتتاحي','الرصيد']),date:headerIndex(header,['تاريخ الرصيد','تاريخ']),note:headerIndex(header,['المرجع','ملاحظة'])};
      const output=[],errors=[],seen=new Set();
      data.slice(headerRow+1).forEach((row,index)=>{
        const rowNo=headerRow+index+2,customerCode=code(row[indexes.code]),customerName=String(row[indexes.name]||'').trim(),rawBalance=row[indexes.balance];
        if(!customerCode&&!customerName&&String(rawBalance||'').trim()==='')return;
        const balance=amount(rawBalance),segment=String(row[indexes.segment]||'الاثنين').trim()||'الاثنين';
        if(!customerCode){errors.push(`الصف ${rowNo}: كود العميل مطلوب.`);return;}
        if(!Number.isFinite(balance)){errors.push(`الصف ${rowNo}: الرصيد الافتتاحي يجب أن يكون رقمًا.`);return;}
        if(!['خرسانة','بلوك','الاثنين'].includes(segment)){errors.push(`الصف ${rowNo}: القطاع يجب أن يكون خرسانة أو بلوك أو الاثنين.`);return;}
        if(seen.has(customerCode)){errors.push(`الصف ${rowNo}: كود العميل ${customerCode} مكرر داخل الملف.`);return;}
        seen.add(customerCode);
        const current=customerByCode(customerCode);
        if(!current&&!customerName){errors.push(`الصف ${rowNo}: اسم العميل مطلوب لأن الكود ${customerCode} غير موجود.`);return;}
        output.push({rowNo,customerCode,customerName,segment,balance,balanceDate:date(row[indexes.date]),note:String(row[indexes.note]||'').trim(),current});
      });
      if(errors.length)throw new Error(errors.slice(0,12).join('\n'));
      if(!output.length)throw new Error('لا توجد أرصدة صالحة في الملف.');
      return output;
    });
  }

  function preview(file,plan){
    const newCustomers=plan.filter(row=>!row.current).length,total=plan.reduce((sum,row)=>sum+row.balance,0);
    const body=plan.slice(0,100).map(row=>`<tr><td>${row.rowNo}</td><td class="mono">${escape(row.customerCode)}</td><td>${escape(row.current?.name||row.customerName)}</td><td>${escape(row.segment)}</td><td class="num">${Number(row.balance).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td>${row.current?'تحديث رصيد افتتاحي':'عميل جديد'}</td></tr>`).join('');
    openMo('مراجعة أرصدة العملاء الافتتاحية',`<div class="note"><b>لن يُنشأ بيع أو تحصيل من هذا الملف.</b> سيُحفظ الرصيد الافتتاحي على كود العميل نفسه، ثم تُضاف إليه التوريدات والتحصيلات القادمة تلقائيًا. الإشارة الموجبة تعني مديونية للعميل، والسالبة رصيد دائن له.</div><div class="stats" style="margin:12px 0"><div class="stat"><b>${plan.length}</b><span>عملاء بالملف</span></div><div class="stat"><b>${newCustomers}</b><span>عملاء جدد</span></div><div class="stat"><b>${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>صافي الرصيد</span></div></div><div class="tw"><table><thead><tr><th>الصف</th><th>كود العميل</th><th>العميل</th><th>القطاع</th><th>الرصيد</th><th>الحالة</th></tr></thead><tbody>${body}</tbody></table></div>${plan.length>100?'<p class="sub">تظهر أول 100 صف؛ سيُعتمد كامل الملف.</p>':''}`,async()=>{
      const sourceFile=`opening-balance|${file.name}|${file.size}|${file.lastModified}`;
      for(const row of plan){
        let customer=row.current;
        if(!customer){
          customer={id:uid(),code:row.customerCode,name:row.customerName,seg:row.segment,cr:'',ct:'',tel:'',days:Number(D.cfg.days||3),rep:'',addr:'',note:'مضاف من قالب الرصيد الافتتاحي',aliases:[],sourceCustomerCodes:[row.customerCode],createdAt:new Date().toISOString()};
          D.cli.push(customer);
        }
        customer.code=customer.code||row.customerCode;
        customer.sourceCustomerCodes=Array.isArray(customer.sourceCustomerCodes)?customer.sourceCustomerCodes:[];
        if(!customer.sourceCustomerCodes.includes(row.customerCode))customer.sourceCustomerCodes.push(row.customerCode);
        OPS.settings.customerCodeMap=OPS.settings.customerCodeMap||{};
        OPS.settings.customerCodeMap[row.customerCode]=customer.id;
        const prior=rows().find(item=>item.clientId===customer.id);
        const record={id:prior?.id||opsUid('opb'),clientId:customer.id,customerCode:row.customerCode,date:row.balanceDate,amount:row.balance,note:row.note,sourceFile,updatedAt:new Date().toISOString(),createdAt:prior?.createdAt||new Date().toISOString()};
        if(prior)Object.assign(prior,record);else rows().push(record);
      }
      save();
      lockLedger();
      rAll();
      await opsPersist(`اعتماد أرصدة افتتاحية للعملاء من ${file.name}`);
      toast(`تم اعتماد ${plan.length} رصيد افتتاحي وربطه بأكواد العملاء.`);
    });
  }

  async function upload(event){
    const file=event.target.files?.[0];event.target.value='';
    if(!file)return;
    try{preview(file,await parse(file));}catch(error){toast(error.message||'تعذر قراءة قالب الأرصدة','err');}
  }

  function controls(){
    const row=document.querySelector('#p-cli .row');
    if(!row||document.getElementById('bhOpeningBalancesControls'))return;
    const box=document.createElement('span');box.id='bhOpeningBalancesControls';box.style.cssText='display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center';
    const download=document.createElement('a');download.className='btn btn-o';download.href=TEMPLATE;download.download='binhamid-customer-opening-balances-template.xlsx';download.textContent='⇩ تنزيل قالب أرصدة العملاء';
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls';input.hidden=true;input.addEventListener('change',upload);
    const uploadButton=document.createElement('button');uploadButton.type='button';uploadButton.className='btn btn-g';uploadButton.textContent='⇧ رفع أرصدة افتتاحية';uploadButton.onclick=()=>input.click();
    box.append(download,uploadButton,input);row.appendChild(box);
  }

  function install(){lockLedger();controls();}
  install();
  new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});
  console.info('[BinHamid]',VERSION,'ready');
})();
