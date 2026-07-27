const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
const money=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const chunks=(rows,size)=>{const output=[];for(let index=0;index<rows.length;index+=size)output.push(rows.slice(index,index+size));return output;};

export function removeRepeatedPaymentTerms(document=''){
  return String(document)
    .replace(/<div class="f w2 dark"><div class="k">مهلة السداد المعتمدة<\/div><div class="v lg">[\s\S]*?<\/div><\/div>/g,'')
    .replace(/<th style="width:(?:13|18)mm">مهلة السداد<\/th>/g,'')
    .replace(/<td class="mono">\d+(?:\.\d+)?\s*يوم<\/td>/g,'')
    .replace(/(<td class="num">[^<]*<\/td>)<td><\/td>(<td class="num">)/g,'$1$2');
}
function detailPage({type,rows,offset,employee,reportDate,sourceFile,logoUrl,documentRef}){
  const department=type==='block'?'البلوك':'الخرسانة',body=rows.map((row,index)=>`<tr><td>${offset+index+1}</td><td><b>${esc(row.name)}</b><br><span>${esc(row.code||'بدون رقم')}</span></td><td><b>${esc(row.customerClassLabel)}</b><br><span>${esc(row.statusLabel)}</span></td><td>${money(row.previousBalance)}</td><td>${money(row.reportSales)}</td><td>${money(row.reportCollections)}</td><td>${money(row.paidCurrent)}</td><td>${money(row.paidPrevious)}</td><td><b>${money(row.finalBalance)}</b>${row.finalAdvance>0?`<br><span>دفعة مقدمة ${money(row.finalAdvance)}</span>`:''}</td></tr>`).join('');
  return `<div class="doc"><div class="spine"><div class="seal"><img src="${esc(logoUrl)}" alt=""></div><div class="ticks"></div><div class="vref">${esc(documentRef)}</div><div class="vlabel">تسوية العملاء</div></div><div class="body" style="padding:8mm 7mm 5mm"><div style="display:flex;align-items:center;gap:7mm;border-bottom:2pt solid #0B2233;padding-bottom:3mm"><img src="${esc(logoUrl)}" style="width:34mm"><div><div style="font-family:'Reem Kufi',Tahoma;font-size:15pt;font-weight:700;color:#0B2233">تفصيل تسوية محفظة ${department}</div><div style="font-size:7.5pt;color:#655F50">${esc(employee.name)} — ${esc(reportDate)} — ${esc(sourceFile)}</div></div></div><div style="margin:4mm 0;padding:2.5mm 3mm;border:1pt solid #C6B187;background:#F8F1E4;font-size:7.5pt"><b>قاعدة التوزيع:</b> سداد التقرير يقفل مشتريات التقرير أولًا، ثم يخفض الرصيد السابق. العميل القديم هو من كان له رصيد أو مبيعات قبل تاريخ التقرير، والعميل الجديد لم تكن له حركة سابقة.</div><table style="width:100%;border-collapse:collapse;font-size:6.6pt;line-height:1.35"><thead><tr style="background:#0B2233;color:white"><th style="width:6mm">م</th><th style="width:32mm">العميل</th><th style="width:34mm">التصنيف والحالة</th><th>الرصيد السابق</th><th>مشتريات التقرير</th><th>سداد التقرير</th><th>من المشتريات</th><th>من السابق</th><th>المتبقي النهائي</th></tr></thead><tbody>${body}</tbody></table><div style="margin-top:auto;border-top:1pt solid #C6B187;padding-top:2mm;font-size:6.8pt;color:#655F50">مهلة السداد لا تُكرر داخل الكشف؛ تظل مثبتة مرة واحدة ضمن بنود الإقرار والالتزام أسفل الوثيقة.</div></div></div>`;
}
export function enhancePortfolioDocument(document='',context={}){
  const cleaned=removeRepeatedPaymentTerms(document),pages=chunks(context.rows||[],7).map((rows,index)=>detailPage({...context,rows,offset:index*7})).join('');
  if(!cleaned.includes('</body>'))throw Object.assign(new Error('تعذر إكمال إقرار المحفظة لأن قالب المستند لا يحتوي علامة الإغلاق المطلوبة.'),{code:'CUSTOMER_PORTFOLIO_TEMPLATE_MISSING_BODY_TAG'});
  return cleaned.replace('</body>',`${pages}</body>`);
}
