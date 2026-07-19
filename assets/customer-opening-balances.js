(function customerOpeningBalances(){
  'use strict';

  const VERSION='2026.07.19-customer-opening-balances-v2-old-system';
  const TEMPLATE='/assets/templates/binhamid-customer-opening-balances-template.xlsx';
  const normal=value=>String(value??'').trim().toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/\s+/g,' ');
  const header=value=>normal(value).replace(/[()\[\]{}\/\\:：._-]+/g,' ').replace(/\s+/g,' ').trim();
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const today=()=>typeof opsToday==='function'?opsToday():new Date().toISOString().slice(0,10);
  const roundMoney=value=>{const number=Number(value||0);if(!Number.isFinite(number))return NaN;const rounded=Math.round((number+Number.EPSILON)*100)/100;return Math.abs(rounded)<0.005?0:rounded;};

  function normalizeDigits(value){
    return String(value??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/٬/g,',').replace(/[−–—]/g,'-');
  }

  function normalizeCode(value){
    if(typeof value==='number'&&Number.isFinite(value))return Number.isInteger(value)?String(value):String(value).replace(/\.0+$/,'');
    const text=normalizeDigits(value).trim().toUpperCase().replace(/\s+/g,'');
    return /^\d+\.0+$/.test(text)?text.replace(/\.0+$/,''):text;
  }

  function parseAmount(value){
    if(typeof value==='number')return Number.isFinite(value)?roundMoney(value):NaN;
    let text=normalizeDigits(value).trim();
    if(!text)return NaN;
    const parentheses=/^\(.*\)$/.test(text);
    text=text.replace(/[()]/g,'').replace(/(?:ر\.?\s*س|ريال|sar)/gi,'').replace(/[،,\s]/g,'');
    if(!/^[-+]?\d*(?:\.\d+)?$/.test(text)||!/[0-9]/.test(text))return NaN;
    const parsed=Number(text);
    if(!Number.isFinite(parsed))return NaN;
    return roundMoney(parentheses?-Math.abs(parsed):parsed);
  }

  function parseDate(value,fallback=today()){
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
    const text=normalizeDigits(value).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
    let match=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if(match)return`${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}`;
    match=text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if(match)return`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}`;
    return fallback;
  }

  function rows(){
    if(typeof OPS==='undefined'||!OPS)return[];
    OPS.customerOpeningBalances=Array.isArray(OPS.customerOpeningBalances)?OPS.customerOpeningBalances:[];
    return OPS.customerOpeningBalances;
  }

  function customerByCode(value){
    const key=normalizeCode(value);
    return(D.cli||[]).find(item=>normalizeCode(item.code)===key||(item.sourceCustomerCodes||[]).map(normalizeCode).includes(key));
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
      const opening=existingBalance(clientId),net=Number(ledger.netBalance||0)+opening;
      return{...ledger,openingBalance:opening,netBalance:net,remaining:Math.max(0,net),debitBalance:Math.max(0,net),creditBalance:Math.max(0,-net)};
    };
    wrapped.__includesOpeningBalances=true;
    window.bhClientLedger=wrapped;
  }

  function exactIndex(headers,aliases){
    const values=(headers||[]).map(header);
    const targets=aliases.map(header);
    let index=values.findIndex(value=>targets.includes(value));
    if(index>=0)return index;
    index=values.findIndex(value=>targets.some(target=>value.startsWith(`${target} `)||value.endsWith(` ${target}`)));
    return index;
  }

  function detectOldTrialBalance(textRows){
    for(let index=0;index<textRows.length;index++){
      const row=textRows[index]||[],client=exactIndex(row,['العميل']),debit=exactIndex(row,['مدين']),credit=exactIndex(row,['دائن']),balance=exactIndex(row,['الرصيد']);
      if(client>=0&&debit>=0&&credit>=0&&balance>=0)return{kind:'old_trial_balance',headerRow:index,code:client,name:client+1,previous:exactIndex(row,['ما قبله']),debit,credit,balance};
    }
    return null;
  }

  function detectTemplate(textRows){
    for(let index=0;index<textRows.length;index++){
      const row=textRows[index]||[],code=exactIndex(row,['كود العميل','رقم العميل','الكود']),balance=exactIndex(row,['الرصيد الافتتاحي','رصيد افتتاحي','الرصيد']);
      if(code<0||balance<0)continue;
      return{kind:'template',headerRow:index,code,name:exactIndex(row,['اسم العميل','اسم العميل المنشأة','العميل']),segment:exactIndex(row,['القطاع','النشاط']),balance,balanceType:exactIndex(row,['نوع الرصيد','طبيعة الرصيد']),date:exactIndex(row,['تاريخ الرصيد','تاريخ الرصيد الافتتاحي','التاريخ']),note:exactIndex(row,['المرجع','ملاحظة','الملاحظات']),phone:exactIndex(row,['الجوال','رقم الجوال','الهاتف']),creditLimit:exactIndex(row,['حد الائتمان','الحد الائتماني']),paymentDays:exactIndex(row,['ايام السداد','مدة السداد'])};
    }
    return null;
  }

  function reportDate(textRows,layout){
    if(layout.kind!=='old_trial_balance')return today();
    for(let index=0;index<Math.min(textRows.length,layout.headerRow+1);index++){
      const row=textRows[index]||[];
      if(!normal(row[0]).includes('ميزان مراجعه'))continue;
      for(let cell=row.length-1;cell>=0;cell--){const parsed=parseDate(row[cell],'');if(parsed)return parsed;}
    }
    return today();
  }

  function normalizeSegment(value){
    const text=normal(value);
    if(/خرسان/.test(text))return'خرسانة';
    if(/بلوك|بلك/.test(text))return'بلوك';
    return'الاثنين';
  }

  function balanceByType(value,type){
    const amount=parseAmount(value),nature=normal(type);
    if(!Number.isFinite(amount))return NaN;
    if(/دائن/.test(nature))return-roundMoney(Math.abs(amount));
    if(/مدين/.test(nature))return roundMoney(Math.abs(amount));
    return roundMoney(amount);
  }

  function rowValue(row,index){return index>=0?row[index]:'';}
  function isOldNonDataRow(row){
    const first=normal(row?.[0]);
    return!first||first==='العميل'||first.startsWith('الاجمالي')||first.includes('ميزان مراجعه عن فتره');
  }

  function parseOldRows(rawRows,textRows,layout){
    const date=reportDate(textRows,layout),byCode=new Map(),errors=[];
    for(let index=layout.headerRow+1;index<textRows.length;index++){
      const textRow=textRows[index]||[],rawRow=rawRows[index]||[];
      if(isOldNonDataRow(textRow))continue;
      const customerCode=normalizeCode(rowValue(rawRow,layout.code)||rowValue(textRow,layout.code)),customerName=String(rowValue(textRow,layout.name)||'').trim();
      if(!customerCode&&!customerName)continue;
      if(!customerCode||!customerName)continue;
      let balance=parseAmount(rowValue(rawRow,layout.balance));
      if(!Number.isFinite(balance))balance=parseAmount(rowValue(textRow,layout.balance));
      if(!Number.isFinite(balance)){
        const previous=parseAmount(rowValue(rawRow,layout.previous))||0,debit=parseAmount(rowValue(rawRow,layout.debit))||0,credit=parseAmount(rowValue(rawRow,layout.credit))||0;
        balance=roundMoney(previous+debit-credit);
      }
      if(!Number.isFinite(balance)){errors.push(`الصف ${index+1}: تعذر قراءة رصيد العميل ${customerCode}.`);continue;}
      const prior=byCode.get(customerCode);
      if(prior){prior.balance=roundMoney(prior.balance+balance);prior.duplicateRows.push(index+1);continue;}
      byCode.set(customerCode,{rowNo:index+1,customerCode,customerName,segment:'الاثنين',balance,balanceDate:date,note:'مستورد من ميزان مراجعة البرنامج القديم',phone:'',creditLimit:0,paymentDays:0,current:customerByCode(customerCode),sourceFormat:'old_trial_balance',duplicateRows:[]});
    }
    if(errors.length)throw new Error(errors.slice(0,12).join('\n'));
    return[...byCode.values()];
  }

  function parseTemplateRows(rawRows,textRows,layout){
    const output=[],errors=[],seen=new Set();
    for(let index=layout.headerRow+1;index<textRows.length;index++){
      const textRow=textRows[index]||[],rawRow=rawRows[index]||[],customerCode=normalizeCode(rowValue(rawRow,layout.code)||rowValue(textRow,layout.code)),customerName=String(rowValue(textRow,layout.name)||'').trim(),rawBalance=rowValue(rawRow,layout.balance)||rowValue(textRow,layout.balance);
      if(!customerCode&&!customerName&&String(rawBalance??'').trim()==='')continue;
      const balance=balanceByType(rawBalance,rowValue(textRow,layout.balanceType)),segment=normalizeSegment(rowValue(textRow,layout.segment));
      if(!customerCode){errors.push(`الصف ${index+1}: كود العميل مطلوب.`);continue;}
      if(!Number.isFinite(balance)){errors.push(`الصف ${index+1}: الرصيد الافتتاحي يجب أن يكون رقمًا.`);continue;}
      if(seen.has(customerCode)){errors.push(`الصف ${index+1}: كود العميل ${customerCode} مكرر داخل الملف.`);continue;}
      seen.add(customerCode);
      const current=customerByCode(customerCode);
      if(!current&&!customerName){errors.push(`الصف ${index+1}: اسم العميل مطلوب لأن الكود ${customerCode} غير موجود.`);continue;}
      output.push({rowNo:index+1,customerCode,customerName,segment,balance,balanceDate:parseDate(rowValue(textRow,layout.date)),note:String(rowValue(textRow,layout.note)||'').trim(),phone:String(rowValue(textRow,layout.phone)||'').trim(),creditLimit:Math.max(0,parseAmount(rowValue(rawRow,layout.creditLimit))||0),paymentDays:Math.max(0,Math.round(parseAmount(rowValue(rawRow,layout.paymentDays))||0)),current,sourceFormat:'opening_balance_template',duplicateRows:[]});
    }
    if(errors.length)throw new Error(errors.slice(0,12).join('\n'));
    return output;
  }

  async function parse(file){
    if(typeof XLSX==='undefined')throw new Error('قارئ Excel لم يكتمل تحميله؛ أعد فتح الصفحة ثم حاول مرة أخرى.');
    const buffer=await file.arrayBuffer(),workbook=XLSX.read(new Uint8Array(buffer),{type:'array',cellDates:false});
    for(const sheetName of workbook.SheetNames){
      const sheet=workbook.Sheets[sheetName],rawRows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true}),textRows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false});
      const old=detectOldTrialBalance(textRows),template=old?null:detectTemplate(textRows),layout=old||template;
      if(!layout)continue;
      const output=layout.kind==='old_trial_balance'?parseOldRows(rawRows,textRows,layout):parseTemplateRows(rawRows,textRows,layout);
      if(output.length)return{rows:output,layout,sheetName};
    }
    throw new Error('لم أتعرف على ملف العملاء. يقبل المستورد ميزان مراجعة العملاء الخارج من البرنامج القديم أو قالب الأرصدة الافتتاحية.');
  }

  function preview(file,result){
    const plan=result.rows,newCustomers=plan.filter(row=>!row.current).length,debit=plan.reduce((sum,row)=>sum+Math.max(0,row.balance),0),credit=plan.reduce((sum,row)=>sum+Math.max(0,-row.balance),0),net=roundMoney(debit-credit),format=result.layout.kind==='old_trial_balance'?'ميزان مراجعة البرنامج القديم':'قالب الأرصدة الافتتاحية';
    const body=plan.slice(0,100).map(row=>`<tr><td>${row.rowNo}</td><td class="mono">${escape(row.customerCode)}</td><td>${escape(row.current?.name||row.customerName)}</td><td>${escape(row.segment)}</td><td class="num">${Number(row.balance).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td>${row.current?'تحديث الرصيد':'عميل جديد'}</td></tr>`).join('');
    openMo('مراجعة أرصدة العملاء الافتتاحية',`<div class="note"><b>تم التعرف على ${escape(format)}.</b> لن يُنشأ بيع أو تحصيل من الملف. الرصيد الموجب مديونية على العميل، والرصيد السالب دفعة مقدمة أو رصيد دائن له.</div><div class="stats" style="margin:12px 0"><div class="stat"><b>${plan.length}</b><span>عملاء</span></div><div class="stat"><b>${newCustomers}</b><span>عملاء جدد</span></div><div class="stat"><b>${debit.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>أرصدة مدينة</span></div><div class="stat"><b>${credit.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>أرصدة دائنة</span></div><div class="stat"><b>${net.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</b><span>صافي العملاء</span></div></div><div class="tw"><table><thead><tr><th>الصف</th><th>كود العميل</th><th>العميل</th><th>القطاع</th><th>الرصيد</th><th>الحالة</th></tr></thead><tbody>${body}</tbody></table></div>${plan.length>100?'<p class="sub">تظهر أول 100 صف؛ سيُعتمد كامل الملف.</p>':''}`,async()=>{
      const sourceFile=`opening-balance|${result.layout.kind}|${file.name}|${file.size}|${file.lastModified}`;
      OPS.settings=OPS.settings||{};OPS.settings.customerCodeMap=OPS.settings.customerCodeMap||{};
      for(const row of plan){
        let customer=row.current;
        if(!customer){
          customer={id:uid(),code:row.customerCode,name:row.customerName,seg:row.segment,cr:'',ct:'',tel:row.phone||'',days:row.paymentDays||Number(D.cfg.days||3),cap:row.creditLimit||0,credit:row.creditLimit||0,rep:'',addr:'',note:'مضاف من ملف العملاء القديم/الأرصدة الافتتاحية',aliases:[],sourceCustomerCodes:[row.customerCode],createdAt:new Date().toISOString()};
          D.cli.push(customer);
        }
        customer.code=customer.code||row.customerCode;
        if(!customer.name&&row.customerName)customer.name=row.customerName;
        if(!customer.tel&&row.phone)customer.tel=row.phone;
        if(row.creditLimit>0){customer.cap=row.creditLimit;customer.credit=row.creditLimit;}
        if(row.paymentDays>0)customer.days=row.paymentDays;
        customer.sourceCustomerCodes=Array.isArray(customer.sourceCustomerCodes)?customer.sourceCustomerCodes:[];
        if(!customer.sourceCustomerCodes.includes(row.customerCode))customer.sourceCustomerCodes.push(row.customerCode);
        OPS.settings.customerCodeMap[row.customerCode]=customer.id;
        const prior=rows().find(item=>item.clientId===customer.id),record={id:prior?.id||opsUid('opb'),clientId:customer.id,customerCode:row.customerCode,customerName:customer.name||row.customerName,segment:row.segment,date:row.balanceDate,amount:row.balance,note:row.note,sourceFormat:row.sourceFormat,sourceFile,updatedAt:new Date().toISOString(),createdAt:prior?.createdAt||new Date().toISOString()};
        if(prior)Object.assign(prior,record);else rows().push(record);
      }
      save();lockLedger();rAll();await opsPersist(`اعتماد أرصدة افتتاحية للعملاء من ${file.name}`);toast(`تم اعتماد ${plan.length} رصيد افتتاحي وربطه بأكواد العملاء.`);
    });
  }

  async function upload(event){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try{preview(file,await parse(file));}catch(error){toast(error.message||'تعذر قراءة ملف العملاء','err');}
  }

  function controls(){
    const row=document.querySelector('#p-cli .row');if(!row||document.getElementById('bhOpeningBalancesControls'))return;
    const box=document.createElement('span');box.id='bhOpeningBalancesControls';box.style.cssText='display:inline-flex;gap:8px;flex-wrap:wrap;align-items:center';
    const download=document.createElement('a');download.className='btn btn-o';download.href=TEMPLATE;download.download='binhamid-customer-opening-balances-template.xlsx';download.textContent='⇩ تنزيل قالب أرصدة العملاء';
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls';input.hidden=true;input.addEventListener('change',upload);
    const uploadButton=document.createElement('button');uploadButton.type='button';uploadButton.className='btn btn-g';uploadButton.textContent='⇧ رفع ملف العملاء القديم / الأرصدة';uploadButton.onclick=()=>input.click();
    box.append(download,uploadButton,input);row.appendChild(box);
  }

  window.BHCustomerOpeningBalances={version:VERSION,normalizeCode,parseAmount,parseDate,balanceByType,detectOldTrialBalance,detectTemplate};
  function install(){lockLedger();controls();}
  install();new MutationObserver(install).observe(document.documentElement,{childList:true,subtree:true});console.info('[BinHamid]',VERSION,'ready');
})();
