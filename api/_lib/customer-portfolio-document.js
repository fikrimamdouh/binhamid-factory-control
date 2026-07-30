const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const chunks=(rows,size)=>{const output=[];for(let index=0;index<rows.length;index+=size)output.push(rows.slice(index,index+size));return output;};
const RESIDUAL_THRESHOLD=0.5;
const residualValue=value=>{const number=Number(value||0);return Number.isFinite(number)&&Math.abs(number)<RESIDUAL_THRESHOLD?0:number;};

export function removeRepeatedPaymentTerms(document=''){
  return String(document)
    .replace(/<div class="f w2 dark"><div class="k">مهلة السداد المعتمدة<\/div><div class="v lg">[\s\S]*?<\/div><\/div>/g,'')
    .replace(/<th style="width:[^"]+">مهلة السداد<\/th>/g,'')
    .replace(/<td class="mono">\d+(?:\.\d+)?\s*يوم<\/td>/g,'')
    .replace(/(<td class="num">[^<]*<\/td>)<td><\/td>(<td class="num">)/g,'$1$2');
}

function normalizeLedgerResidualCells(document=''){
  return String(document).replace(/<table class="led">[\s\S]*?<\/table>/g,table=>{
    if(!table.includes('>المتبقي<'))return table;
    return table.replace(/<tr>[\s\S]*?<\/tr>/g,row=>{
      if(row.includes('<th'))return row;
      const cells=[...row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)];
      if(!cells.length)return row;
      const last=cells[cells.length-1],cell=last[0];
      if(!/class="num"/.test(cell))return row;
      const value=Number(cell.replace(/<[^>]+>/g,'').replace(/,/g,'').trim());
      if(!Number.isFinite(value)||Math.abs(value)>=RESIDUAL_THRESHOLD||Math.abs(value)<0.000001)return row;
      const replacement=cell.replace(/>[\s\S]*<\/td>/,'>0.00</td>');
      return`${row.slice(0,last.index)}${replacement}${row.slice(last.index+cell.length)}`;
    });
  });
}

function ignoredResidualRows(rows=[]){
  const totals=new Map();
  for(const row of rows||[]){
    const debt=Number(row?.outstanding??row?.finalBalance??row?.finalDebt??0);
    if(Number.isFinite(debt)&&Math.abs(debt)>0.000001&&Math.abs(debt)<RESIDUAL_THRESHOLD){const kind=debt>=0?'مدين':'دائن';totals.set(kind,(totals.get(kind)||0)+Math.abs(debt));}
    const advance=Number(row?.finalAdvance??0);
    if(Number.isFinite(advance)&&advance>0.000001&&advance<RESIDUAL_THRESHOLD)totals.set('دائن',(totals.get('دائن')||0)+advance);
  }
  return[...totals.entries()].map(([kind,amount])=>({kind,amount}));
}

function injectIgnoredResidualTable(document='',rows=[]){
  const ignored=ignoredResidualRows(rows);if(!ignored.length)return document;
  const body=ignored.map((row,index)=>`<tr><td style="text-align:center">${index+1}</td><td style="text-align:center">${row.kind}</td><td style="text-align:center;font-family:ui-monospace,monospace;font-weight:700">${money(row.amount)} ر.س</td></tr>`).join('');
  const note=`<div style="margin-top:1.2mm;border:.8pt solid #D7C7A4;background:#FCF8F0;padding:1.4mm 2mm;break-inside:avoid"><div style="font-size:6.5pt;font-weight:700;color:#6D572D;margin-bottom:.8mm">فروق هللات مستبعدة من خانة المتبقي لأنها أقل من 0.50 ر.س — لا تؤثر في رصيد الإقرار</div><table style="width:100%;border-collapse:collapse;font-size:6.2pt"><thead><tr style="background:#EFE3CB;color:#4A3A1F"><th style="width:12mm">م</th><th>نوع الفرق</th><th>المبلغ المستبعد</th></tr></thead><tbody>${body}</tbody></table></div>`;
  const marker='<div class="ledn">',index=String(document).lastIndexOf(marker);
  return index<0?`${document}${note}`:`${document.slice(0,index)}${note}${document.slice(index)}`;
}

function detailPage({type,rows,offset,employee,reportDate,sourceFile,logoUrl,documentRef}){
  const department=type==='block'?'البلوك':'الخرسانة',body=rows.map((row,index)=>{const finalBalance=residualValue(row.finalBalance),finalAdvance=residualValue(row.finalAdvance);return`<tr><td>${offset+index+1}</td><td><b>${esc(row.name)}</b><br><span>${esc(row.code||'بدون رقم')}</span></td><td><b>${esc(row.customerClassLabel)}</b><br><span>${esc(row.statusLabel)}</span></td><td>${money(row.previousBalance)}</td><td>${money(row.reportSales)}</td><td>${money(row.reportCollections)}</td><td>${money(row.paidCurrent)}</td><td>${money(row.paidPrevious)}</td><td><b>${money(finalBalance)}</b>${finalAdvance>0?`<br><span>دفعة مقدمة ${money(finalAdvance)}</span>`:''}</td></tr>`;}).join('');
  return `<div class="doc"><div class="spine"><div class="seal"><img src="${esc(logoUrl)}" alt=""></div><div class="ticks"></div><div class="vref">${esc(documentRef)}</div><div class="vlabel">تسوية العملاء</div></div><div class="body" style="padding:8mm 7mm 5mm"><div style="display:flex;align-items:center;gap:7mm;border-bottom:2pt solid #0B2233;padding-bottom:3mm"><img src="${esc(logoUrl)}" style="width:34mm"><div><div style="font-family:'Reem Kufi',Tahoma;font-size:15pt;font-weight:700;color:#0B2233">تفصيل تسوية محفظة ${department}</div><div style="font-size:7.5pt;color:#655F50">${esc(employee.name)} — ${esc(reportDate)} — ${esc(sourceFile)}</div></div></div><div style="margin:4mm 0;padding:2.5mm 3mm;border:1pt solid #C6B187;background:#F8F1E4;font-size:7.5pt"><b>قاعدة التوزيع:</b> سداد التقرير يقفل الرصيد السابق أولًا وفق الأقدم فالأقدم، ثم يُوجّه الباقي إلى مشتريات التقرير، ثم تُعرض أي زيادة كدفعة مقدمة. العميل القديم هو من كان له رصيد أو مبيعات قبل تاريخ التقرير، والعميل الجديد لم تكن له حركة سابقة.</div><table style="width:100%;border-collapse:collapse;font-size:6.6pt;line-height:1.35"><thead><tr style="background:#0B2233;color:white"><th style="width:6mm">م</th><th style="width:32mm">العميل</th><th style="width:34mm">التصنيف والحالة</th><th>الرصيد السابق</th><th>مشتريات التقرير</th><th>سداد التقرير</th><th>من المشتريات</th><th>من السابق</th><th>المتبقي النهائي</th></tr></thead><tbody>${body}</tbody></table><div style="margin-top:auto;border-top:1pt solid #C6B187;padding-top:2mm;font-size:6.8pt;color:#655F50">مهلة السداد لا تُكرر داخل الكشف؛ تظل مثبتة مرة واحدة ضمن بنود الإقرار والالتزام أسفل الوثيقة. فروق الرصيد الأقل من نصف ريال تُعرض في جدول مستقل دون أسماء العملاء.</div></div></div>`;
}

export function enhancePortfolioDocument(document='',context={}){
  const allRows=context.rows||[],signedRows=allRows.filter(row=>Number(row?.finalDebt??row?.finalBalance??row?.outstanding??0)>=RESIDUAL_THRESHOLD),cleaned=injectIgnoredResidualTable(normalizeLedgerResidualCells(removeRepeatedPaymentTerms(document)),allRows),pages=chunks(signedRows,7).map((rows,index)=>detailPage({...context,rows,offset:index*7})).join('');
  if(!cleaned.includes('</body>'))throw Object.assign(new Error('تعذر إكمال إقرار المحفظة لأن قالب المستند لا يحتوي علامة الإغلاق المطلوبة.'),{code:'CUSTOMER_PORTFOLIO_TEMPLATE_MISSING_BODY_TAG'});
  return cleaned.replace('</body>',`${pages}</body>`);
}
