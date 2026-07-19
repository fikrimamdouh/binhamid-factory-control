(function customerOpeningBalances(){
  'use strict';

  const VERSION='2026.07.19-customer-opening-balances-v2';
  const TEMPLATE='/assets/templates/binhamid-customer-opening-balances-template.xlsx';
  const normal=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ');
  const latinDigits=value=>String(value??'').replace(/[٠-٩]/g,char=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
  const code=value=>latinDigits(value).trim().toUpperCase().replace(/\s+/g,'').replace(/\.0+$/,'');
  const roundMoney=value=>Math.abs(Number(value)||0)<0.005?0:Math.round((Number(value)+Number.EPSILON)*100)/100;
  const amount=(value,blank=NaN)=>{
    if(value===null||value===undefined||String(value).trim()==='')return blank;
    if(typeof value==='number')return Number.isFinite(value)?value:blank;
    let text=latinDigits(value).trim(),negative=false;
    if(/^\(.*\)$/.test(text)){negative=true;text=text.slice(1,-1);}
    text=text.replace(/[−–—]/g,'-').replace(/[٬،,\s]/g,'').replace(/٫/g,'.').replace(/[^0-9+\-.]/g,'');
    if(!text||!/[0-9]/.test(text))return blank;
    const parsed=Number(text);return Number.isFinite(parsed)?(negative?-Math.abs(parsed):parsed):blank;
  };
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fallbackDate=()=>typeof opsToday==='function'?opsToday():new Date().toISOString().slice(0,10);
  const isoDate=value=>{
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    if(typeof value==='number'&&typeof XLSX!=='undefined'&&XLSX.SSF?.parse_date_code){const parsed=XLSX.SSF.parse_date_code(value);if(parsed)return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;}
    const text=latinDigits(value).trim();let match=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);if(match)return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
    match=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);if(match)return `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
    return'';
  };

  function rows(){
    if(typeof OPS==='undefined'||!OPS)return [];
    OPS.customerOpeningBalances=Array.isArray(OPS.customerOpeningBalances)?OPS.customerOpeningBalances:[];
    return OPS.customerOpeningBalances;
  }
  function customerByCode(value){const key=code(value);return(D.cli||[]).find(item=>code(item.code)===key||(item.sourceCustomerCodes||[]).map(code).includes(key));}
  function existingBalance(clientId){return rows().filter(item=>item.clientId===clientId).reduce((sum,item)=>sum+Number(item.amount||0),0);}
  function lockLedger(){
    const previous=window.bhClientLedger;if(typeof previous!=='function'||previous.__includesOpeningBalances)return;
    const wrapped=function(clientId,requestedKind){const ledger=previous.call(this,clientId,requestedKind);if(requestedKind)return ledger;const opening=existingBalance(clientId),net=Number(ledger.netBalance||0)+opening;return{...ledger,openingBalance:opening,netBalance:net,remaining:Math.max(0,net),debitBalance:Math.max(0,net),creditBalance:Math.max(0,-net)};};
    wrapped.__includesOpeningBalances=true;window.bhClientLedger=wrapped;
  }
  function headerIndex(headers,names){return headers.findIndex(header=>names.some(name=>normal(header).includes(normal(name))));}
  function exactHeaderIndex(headers,names){const set=new Set(names.map(normal));return headers.findIndex(header=>set.has(normal(header)));}
  function detectLayout(data){
    for(let rowIndex=0;rowIndex<data.length;rowIndex++){
      const header=data[rowIndex]||[],templateCode=headerIndex(header,['كود العميل','كود']),balance=headerIndex(header,['الرصيد الافتتاحي','الرصيد']);
      if(templateCode>=0&&balance>=0){return{format:'template',headerRow:rowIndex,indexes:{code:templateCode,name:headerIndex(header,['اسم العميل','اسم']),segment:headerIndex(header,['القطاع']),balance,date:headerIndex(header,['تاريخ الرصيد','تاريخ']),note:headerIndex(header,['المرجع','ملاحظة']),previous:-1,debit:-1,credit:-1,cheques:-1}};}
      const customer=exactHeaderIndex(header,['العميل']),previous=exactHeaderIndex(header,['ما قبله','ماقبلـه','سابق']),debit=exactHeaderIndex(header,['مدين']),credit=exactHeaderIndex(header,['دائن']);
      if(customer>=0&&previous>=0&&debit>=0&&credit>=0&&balance>=0){
        const explicitName=headerIndex(header,['اسم العميل','الاسم']);
        return{format:'legacy_trial_balance',headerRow:rowIndex,indexes:{code:customer,name:explicitName>=0?explicitName:customer+1,segment:-1,balance,date:-1,note:-1,previous,debit,credit,cheques:exactHeaderIndex(header,['الشيكات','شيكات'])}};
      }
    }
    return null;
  }
  function reportDate(data,layout){
    const before=data.slice(0,layout.headerRow),flat=before.flat();
    for(let index=0;index<flat.length;index++){if(['الي','الى','إلى'].includes(String(flat[index]??'').trim())){for(let next=index+1;next<Math.min(flat.length,index+5);next++){const parsed=isoDate(flat[next]);if(parsed)return parsed;}}}
    const dates=flat.map(isoDate).filter(Boolean);return dates.at(-1)||fallbackDate();
  }
  async function sha256(buffer){
    try{if(!globalThis.crypto?.subtle)return'';const digest=await globalThis.crypto.subtle.digest('SHA-256',buffer),bytes=[...new Uint8Array(digest)];return bytes.map(value=>value.toString(16).padStart(2,'0')).join('');}catch{return'';}
  }
  async function parse(file){
    if(typeof XLSX==='undefined')throw new Error('قارئ Excel لم يكتمل تحميله؛ أعد فتح الصفحة ثم حاول مرة أخرى.');
    const buffer=await file.arrayBuffer(),workbook=XLSX.read(new Uint8Array(buffer),{type:'array',cellDates:true}),sheetName=workbook.SheetNames.find(name=>normal(name).includes('ارصده العملاء'))||workbook.SheetNames[0],data=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:true}),layout=detectLayout(data);
    if(!layout)throw new Error('لم أتعرف على أعمدة ملف العملاء. يقبل المستورد قالب الأرصدة وملف ميزان مراجعة العملاء الخارج من البرنامج القديم دون تعديل.');
    const endDate=reportDate(data,layout),output=[],errors=[],warnings=[],seen=new Set(),indexes=layout.indexes;
    data.slice(layout.headerRow+1).forEach((row,index)=>{
      const rowNo=layout.headerRow+index+2,customerCode=code(row[indexes.code]),customerName=String(row[indexes.name]??'').trim(),rawBalance=row[indexes.balance];
      if(!customerCode&&!customerName&&String(rawBalance??'').trim()==='')return;
      if(!customerCode&&/(الاجمالي|الاجمالى|المجموع|جمله)/.test(normal(customerName)))return;
      const current=customerByCode(customerCode),balanceValue=amount(rawBalance),previous=amount(indexes.previous>=0?row[indexes.previous]:'',0),debit=amount(indexes.debit>=0?row[indexes.debit]:'',0),credit=amount(indexes.credit>=0?row[indexes.credit]:'',0),cheques=amount(indexes.cheques>=0?row[indexes.cheques]:'',0),segment=String(indexes.segment>=0?row[indexes.segment]:(current?.seg||'الاثنين')).trim()||'الاثنين';
      if(!customerCode){errors.push(`الصف ${rowNo}: كود العميل مطلوب.`);return;}
      if(!Number.isFinite(balanceValue)){errors.push(`الصف ${rowNo}: الرصيد الافتتاحي يجب أن يكون رقمًا.`);return;}
      if(!['خرسانة','بلوك','الاثنين'].includes(segment)){errors.push(`الصف ${rowNo}: القطاع يجب أن يكون خرسانة أو بلوك أو الاثنين.`);return;}
      if(seen.has(customerCode)){errors.push(`الصف ${rowNo}: كود العميل ${customerCode} مكرر داخل الملف.`);return;}seen.add(customerCode);
      if(!current&&!customerName){errors.push(`الصف ${rowNo}: اسم العميل مطلوب لأن الكود ${customerCode} غير موجود.`);return;}
      const balance=roundMoney(balanceValue),computed=roundMoney(previous+debit-credit),difference=roundMoney(balance-computed);
      if(layout.format==='legacy_trial_balance'&&Math.abs(difference)>0.01)warnings.push(`الصف ${rowNo}: فرق مطابقة ${difference.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ر.س بين الحركة والرصيد.`);
      output.push({rowNo,customerCode,customerName,segment,balance,balanceDate:indexes.date>=0?(isoDate(row[indexes.date])||endDate):endDate,note:String(indexes.note>=0?row[indexes.note]:'').trim(),previous:roundMoney(previous),debit:roundMoney(debit),credit:roundMoney(credit),cheques:roundMoney(cheques),difference,current});
    });
    if(errors.length)throw new Error(`${errors.slice(0,12).join('\n')}${errors.length>12?`\n... و${errors.length-12} أخطاء أخرى.`:''}`);
    if(!output.length)throw new Error('لا توجد أرصدة صالحة في الملف.');
    return{rows:output,meta:{format:layout.format,reportDate:endDate,warnings,sourceHash:await sha256(buffer),sheetName}};
  }
  function preview(file,result){
    const plan=result.rows,newCustomers=plan.filter(row=>!row.current).length,total=roundMoney(plan.reduce((sum,row)=>sum+row.balance,0)),debitTotal=roundMoney(plan.reduce((sum,row)=>sum+Math.max(0,row.balance),0)),creditTotal=roundMoney(plan.reduce((sum,row)=>sum+Math.max(0,-row.balance),0)),chequesTotal=roundMoney(plan.reduce((sum,row)=>sum+row.cheques,0)),formatLabel=result.meta.format==='legacy_trial_balance'?'ميزان مراجعة العملاء — البرنامج القديم':'قالب الأرصدة الافتتاحية';
    const body=plan.slice(0,100).map(row=>`<tr><td>${row.rowNo}</td><td class="mono">${escape(row.customerCode)}</td><td>${escape(row.current?.name||row.customerName)}</td><td>${escape(row.segment)}</td><td class="num">${Number(row.balance).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td>${row.current?'تحديث رصيد افتتاحي':'عميل جديد'}</td></tr>`).join('');
    const warning=result.meta.warnings.length?`<div class="note" style="margin-top:10px"><b>تحذيرات المطابقة: ${result.meta.warnings.length}</b><br>${escape(result.meta.warnings.slice(0,5).join('\n'))}</div>`:'';
    openMo('مراجعة أرصدة العملاء الافتتاحية',`<div class="note"><b>نوع الملف:</b> ${escape(formatLabel)}<br><b>تاريخ الرصيد:</b> ${escape(result.meta.reportDate)}<br>لن يُنشأ بيع أو تحصيل من الملف. الإشارة الموجبة مديونية على العميل، والسالبة رصيد دائن له. الأرصدة الافتتاحية لا تدخل أعمار الديون لعدم وجود تواريخ فواتير تفصيلية.</div><div class="stats" style="margin:12px 0"><div class="stat"><b>${plan.length}</b><span>عملاء</span></div><div class="stat"><b>${newCustomers}</b><span>جدد</span></div><div class="stat"><b>${debitTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>أرصدة مدينة</span></div><div class="stat"><b>${creditTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>أرصدة دائنة</span></div><div class="stat"><b>${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>الصافي</span></div><div class="stat"><b>${chequesTotal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>الشيكات</span></div></div><div class="tw"><table><thead><tr><th>الصف</th><th>كود العميل</th><th>العميل</th><th>القطاع</th><th>الرصيد</th><th>الحالة</th></tr></thead><tbody>${body}</tbody></table></div>${plan.length>100?'<p class="sub">تظهر أول 100 صف؛ سيُعتمد كامل الملف.</p>':''}${warning}`,async()=>{
      const sourceFile=`opening-balance|${result.meta.sourceHash||`${file.name}|${file.size}|${file.lastModified}`}`,stamp=new Date().toISOString();
      for(const row of plan){
        let customer=row.current;if(!customer){customer={id:uid(),code:row.customerCode,name:row.customerName,seg:row.segment,cr:'',ct:'',tel:'',days:Number(D.cfg.days||3),rep:'',addr:'',note:'مضاف من ملف أرصدة البرنامج القديم',aliases:[],sourceCustomerCodes:[row.customerCode],createdAt:stamp};D.cli.push(customer);}
        customer.code=customer.code||row.customerCode;if(!customer.name&&row.customerName)customer.name=row.customerName;customer.seg=customer.seg||row.segment;customer.sourceCustomerCodes=Array.isArray(customer.sourceCustomerCodes)?customer.sourceCustomerCodes:[];if(!customer.sourceCustomerCodes.includes(row.customerCode))customer.sourceCustomerCodes.push(row.customerCode);
        customer.openingBalance=row.balance;customer.openingBalanceDate=row.balanceDate;customer.openingBalanceCheques=row.cheques;customer.openingBalanceSource=sourceFile;
        OPS.settings.customerCodeMap=OPS.settings.customerCodeMap||{};OPS.settings.customerCodeMap[row.customerCode]=customer.id;
        const prior=rows().find(item=>item.clientId===customer.id),record={id:prior?.id||opsUid('opb'),clientId:customer.id,customerCode:row.customerCode,customerName:customer.name,date:row.balanceDate,amount:row.balance,previous:row.previous,debit:row.debit,credit:row.credit,cheques:row.cheques,difference:row.difference,note:row.note||`رصيد افتتاحي من ${formatLabel}`,sourceFile,sourceHash:result.meta.sourceHash||'',sourceFormat:result.meta.format,updatedAt:stamp,createdAt:prior?.createdAt||stamp};
        if(prior)Object.assign(prior,record);else rows().push(record);
      }
      OPS.settings.customerOpeningBalanceImport={fileName:file.name,sourceHash:result.meta.sourceHash||'',sourceFormat:result.meta.format,reportDate:result.meta.reportDate,rowCount:plan.length,warningCount:result.meta.warnings.length,importedAt:stamp};
      save();lockLedger();rAll();await opsPersist(`اعتماد أرصدة افتتاحية للعملاء من ${file.name}`);toast(`تم اعتماد ${plan.length} رصيد افتتاحي وربطه بأكواد العملاء.`);
    });
  }
  async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;try{preview(file,await parse(file));}catch(error){toast(error.message||'تعذر قراءة ملف الأرصدة','err');}}
  function controls(){
    const row=document.querySelector('#p-cli .row');if(!row||document.getElementById('bhOpeningBalancesControls'))return;
    const box=document.createElement('span');box.id='bhOpeningBalancesControls';box.style.cssText='display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center';
    const download=document.createElement('a');download.className='btn btn-o';download.href=TEMPLATE;download.download='binhamid-customer-opening-balances-template.xlsx';download.textContent='⇩ تنزيل قالب أرصدة العملاء';
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls';input.hidden=true;input.addEventListener('change',upload);
    const uploadButton=document.createElement('button');uploadButton.type='button';uploadButton.className='btn btn-g';uploadButton.textContent='⇧ رفع أرصدة افتتاحية';uploadButton.onclick=()=>input.click();box.append(download,uploadButton,input);row.appendChild(box);
  }
  function install(){lockLedger();controls();}install();new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});console.info('[BinHamid]',VERSION,'ready');
})();
