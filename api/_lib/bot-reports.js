import { select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { reportSummary } from './domain.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num=(value,digits=2)=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:digits});
const money=value=>`${num(value,2)} ر.س`;
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(typeof key==='function'?key(row):row?.[key]||0),0);
const collectionAmount=row=>Math.max(Number(row?.debit||0),Number(row?.credit||0));
const PAGE_SIZE=10;
let dailyCache={at:0,value:null};
let openingCache={key:'',at:0,value:null};

async function pagedSelect(table,query,maxPages=20){
  const output=[];
  for(let page=0;page<maxPages;page++){
    const rows=await select(table,`${query}&limit=1000&offset=${page*1000}`)||[];
    output.push(...rows);
    if(rows.length<1000)break;
  }
  return output;
}
function groupTotal(rows,keyField,valueField){
  const map=new Map();
  for(const row of rows){const key=String(row?.[keyField]||'غير محدد').trim()||'غير محدد';map.set(key,(map.get(key)||0)+Number(row?.[valueField]||0));}
  return[...map.entries()].sort((a,b)=>b[1]-a[1]);
}
function pageOf(rows,page=0){
  const safe=Math.max(0,Number(page)||0),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)),current=Math.min(safe,pages-1);
  return{rows:rows.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE),current,pages};
}
function navRows(kind,current,pages){
  if(pages<=1)return[];
  const row=[];
  if(current>0)row.push({text:'السابق',callback_data:`report:${kind}|${current-1}`});
  row.push({text:`${current+1}/${pages}`,callback_data:'report:daily'});
  if(current<pages-1)row.push({text:'التالي',callback_data:`report:${kind}|${current+1}`});
  return[row];
}

export function reportKeyboard(){
  return keyboard([
    [{text:'تقرير اليوم الكامل',callback_data:'report:daily'}],
    [{text:'مبيعات البلوك',callback_data:'report:block'},{text:'مبيعات الخرسانة',callback_data:'report:concrete'}],
    [{text:'كل فواتير اليوم',callback_data:'report:invoices'},{text:'تحصيلات اليوم',callback_data:'report:collections'}],
    [{text:'حركة الخزائن',callback_data:'report:cash'},{text:'أرصدة الخزائن',callback_data:'report:treasuries'}],
    [{text:'حركة المخزون',callback_data:'report:inventory'},{text:'تحليلات اليوم',callback_data:'report:analysis'}],
    [{text:'الديزل',callback_data:'report:fuel'},{text:'الورشة',callback_data:'report:workshop'}]
  ]);
}

async function latestCommittedData(){
  if(dailyCache.value&&Date.now()-dailyCache.at<15_000)return dailyCache.value;
  const batch=(await select('daily_report_batches','status=eq.approved&select=id,report_date,original_name,summary,preview_summary,approved_at,committed_at&order=report_date.desc&limit=1'))?.[0];
  if(!batch)return null;
  const id=encodeURIComponent(String(batch.id));
  const[sales,cash,treasuries,inventory]=await Promise.all([
    select('daily_report_sales_lines',`batch_id=eq.${id}&select=id,source_row_no,invoice_no,sales_type,customer_code,customer_name,item_name,quantity,unit,amount,payment_terms&order=source_row_no.asc&limit=2000`).catch(()=>[]),
    select('daily_report_cash_movements',`batch_id=eq.${id}&select=id,source_row_no,treasury_code,treasury_name,debit,credit,account_name,account_type,account_code,description,movement_type,voucher_no,movement_date_text,payment_method,is_customer_collection&order=source_row_no.asc&limit=2000`).catch(()=>[]),
    select('daily_report_treasury_balances',`batch_id=eq.${id}&select=treasury_code,treasury_name,opening_balance,closing_balance&order=treasury_code.asc&limit=200`).catch(()=>[]),
    select('daily_report_inventory_snapshots',`batch_id=eq.${id}&select=source_row_no,inventory_type,item_code,item_name,unit,opening_quantity,received_quantity,issued_quantity,closing_quantity&order=inventory_type.asc,item_name.asc&limit=3000`).catch(()=>[])
  ]);
  const value={batch,sales:sales||[],cash:cash||[],treasuries:treasuries||[],inventory:inventory||[]};
  dailyCache={at:Date.now(),value};return value;
}

async function openingReceivable(reportDate){
  const key=String(reportDate||'');
  if(openingCache.key===key&&openingCache.value&&Date.now()-openingCache.at<60_000)return openingCache.value;
  try{
    const[openingRows,priorSales,priorCollections]=await Promise.all([
      pagedSelect('customer_opening_balances','select=balance'),
      pagedSelect('sales_orders',`delivery_date=lt.${encodeURIComponent(key)}&status=not.in.(cancelled,rejected)&select=total_amount`),
      pagedSelect('collection_events',`occurred_at=lt.${encodeURIComponent(`${key}T00:00:00+03:00`)}&status=not.in.(cancelled,rejected)&select=amount`)
    ]);
    const initial=sum(openingRows,'balance'),sales=sum(priorSales,'total_amount'),collections=sum(priorCollections,'amount');
    const value={initial,sales,collections,opening:initial+sales-collections};openingCache={key,at:Date.now(),value};return value;
  }catch(error){
    console.warn('[telegram daily opening receivable]',{message:String(error?.message||'').slice(0,220)});
    return null;
  }
}

function analytics(data,opening){
  const{sales,cash,treasuries,inventory}=data,block=sales.filter(row=>row.sales_type==='block'),concrete=sales.filter(row=>row.sales_type==='concrete'),collections=cash.filter(row=>row.is_customer_collection===true||String(row.is_customer_collection)==='true');
  const totalSales=sum(sales,'amount'),totalCollections=sum(collections,collectionAmount),blockSales=sum(block,'amount'),concreteSales=sum(concrete,'amount');
  const topCustomers=groupTotal(sales,'customer_name','amount').slice(0,5),topItems=groupTotal(sales,'item_name','amount').slice(0,5);
  const treasuryOpening=sum(treasuries,'opening_balance'),treasuryClosing=sum(treasuries,'closing_balance');
  const stockAlerts=inventory.filter(row=>Number(row.closing_quantity||0)<0||Number(row.closing_quantity||0)===0);
  const openingBalance=opening?.opening??null,closingBalance=openingBalance===null?null:openingBalance+totalSales-totalCollections;
  return{block,concrete,collections,totalSales,totalCollections,blockSales,concreteSales,blockQty:sum(block,'quantity'),concreteQty:sum(concrete,'quantity'),avgInvoice:sales.length?totalSales/sales.length:0,collectionRate:totalSales>0?totalCollections/totalSales*100:0,topCustomers,topItems,treasuryOpening,treasuryClosing,stockAlerts,openingBalance,closingBalance};
}

function dailyDetailKeyboard(){
  return keyboard([
    [{text:'فواتير البلوك',callback_data:'report:block'},{text:'فواتير الخرسانة',callback_data:'report:concrete'}],
    [{text:'كل الفواتير',callback_data:'report:invoices'},{text:'التحصيلات',callback_data:'report:collections'}],
    [{text:'الخزائن',callback_data:'report:cash'},{text:'المخزون',callback_data:'report:inventory'}],
    [{text:'التحليلات',callback_data:'report:analysis'}]
  ]);
}
function invoiceLine(row,index){return `${index}. <b>${esc(row.invoice_no||'بدون رقم')}</b> — ${esc(row.customer_name||'عميل غير محدد')}\n${esc(row.item_name||'صنف غير محدد')} | <b>${num(row.quantity,3)} ${esc(row.unit||'')}</b> | <b>${money(row.amount)}</b>`;}
function cashLine(row,index){return `${index}. <b>${esc(row.movement_type||row.description||'حركة خزينة')}</b> — ${esc(row.account_name||'حساب غير محدد')}\nخزينة ${esc(row.treasury_code||'—')} | مدين ${money(row.debit)} | دائن ${money(row.credit)}${row.voucher_no?` | إذن ${esc(row.voucher_no)}`:''}`;}
function inventoryLine(row,index){return `${index}. <b>${esc(row.item_name||row.item_code||'صنف')}</b> (${esc(row.unit||'—')})\nافتتاحي ${num(row.opening_quantity,3)} | وارد ${num(row.received_quantity,3)} | منصرف ${num(row.issued_quantity,3)} | ختامي <b>${num(row.closing_quantity,3)}</b>`;}

async function sendPaged(chatId,title,kind,rows,lineBuilder,page=0){
  if(!rows.length)return sendMessage(chatId,`<b>${esc(title)}</b>\n\nلا توجد حركات في آخر تقرير معتمد.`);
  const part=pageOf(rows,page),start=part.current*PAGE_SIZE;
  const text=`<b>${esc(title)}</b>\nالعدد: <b>${rows.length}</b>\n\n${part.rows.map((row,index)=>lineBuilder(row,start+index+1)).join('\n\n')}`;
  return sendMessage(chatId,text.slice(0,3900),keyboard(navRows(kind,part.current,part.pages)));
}

async function legacyReport(chatId,kind){
  const row=(await select('app_state','key=eq.primary&select=payload&limit=1'))?.[0];
  if(!row?.payload)return sendMessage(chatId,'لا توجد نسخة سحابية معتمدة من بيانات التشغيل حتى الآن.');
  const s=reportSummary(row.payload);
  if(kind==='fuel')return sendMessage(chatId,`<b>تقرير الديزل — اليوم</b>\n\nاللترات: <b>${num(s.fuelLitersToday,2)}</b>\nالقيمة: <b>${money(s.fuelCostToday)}</b>`);
  if(kind==='workshop')return sendMessage(chatId,`<b>تقرير الورشة</b>\n\nأوامر الإصلاح المفتوحة: <b>${s.openMaintenance}</b>\nالمركبات المتوقفة: <b>${s.stoppedVehicles}</b>\nإجمالي المركبات: <b>${s.vehicles}</b>`);
  const rows=await select('discrepancies','status=in.(open,under_review)&select=severity,status&limit=1000').catch(()=>[]),critical=(rows||[]).filter(x=>x.severity==='critical').length;
  return sendMessage(chatId,`<b>الفروقات الرقابية المفتوحة</b>\n\nالإجمالي: <b>${rows?.length||0}</b>\nحرجة: <b>${critical}</b>`);
}

export async function sendReport(chatId,request='daily'){
  const[kindRaw,pageRaw]=String(request||'daily').split('|'),kind=kindRaw||'daily',page=Number(pageRaw||0);
  if(['fuel','workshop','discrepancies'].includes(kind))return legacyReport(chatId,kind);
  const data=await latestCommittedData();
  if(!data)return sendMessage(chatId,'لا يوجد تقرير يومي معتمد في قاعدة البيانات حتى الآن.');
  const opening=await openingReceivable(data.batch.report_date),a=analytics(data,opening),date=esc(data.batch.report_date);
  if(kind==='block')return sendPaged(chatId,`مبيعات البلوك — ${date}`,'block',a.block,invoiceLine,page);
  if(kind==='concrete')return sendPaged(chatId,`مبيعات الخرسانة — ${date}`,'concrete',a.concrete,invoiceLine,page);
  if(kind==='invoices')return sendPaged(chatId,`كل فواتير التقرير — ${date}`,'invoices',data.sales,invoiceLine,page);
  if(kind==='collections')return sendPaged(chatId,`تحصيلات العملاء — ${date}`,'collections',a.collections,(row,index)=>`${index}. <b>${esc(row.account_name||'عميل غير محدد')}</b> — ${money(collectionAmount(row))}\nخزينة ${esc(row.treasury_code||'—')} | ${esc(row.payment_method||'طريقة غير محددة')}${row.voucher_no?` | إذن ${esc(row.voucher_no)}`:''}`,page);
  if(kind==='cash')return sendPaged(chatId,`كل حركة الخزائن — ${date}`,'cash',data.cash,cashLine,page);
  if(kind==='inventory')return sendPaged(chatId,`حركة المخزون — ${date}`,'inventory',data.inventory,inventoryLine,page);
  if(kind==='treasuries'){
    const lines=data.treasuries.map((row,index)=>`${index+1}. <b>${esc(row.treasury_name||row.treasury_code||'خزينة')}</b>\nافتتاحي ${money(row.opening_balance)} | ختامي <b>${money(row.closing_balance)}</b> | التغير ${money(Number(row.closing_balance||0)-Number(row.opening_balance||0))}`);
    return sendMessage(chatId,`<b>أرصدة الخزائن — ${date}</b>\n\n${lines.length?lines.join('\n\n'):'لا توجد أرصدة خزائن في التقرير.'}`.slice(0,3900));
  }
  if(kind==='analysis'){
    const topCustomers=a.topCustomers.map(([name,value],index)=>`${index+1}. ${esc(name)} — <b>${money(value)}</b>`).join('\n')||'لا توجد مبيعات';
    const topItems=a.topItems.map(([name,value],index)=>`${index+1}. ${esc(name)} — <b>${money(value)}</b>`).join('\n')||'لا توجد مبيعات';
    const balanceLines=a.openingBalance===null?'تعذر حساب الرصيد التراكمي مؤقتًا.':`الرصيد الافتتاحي للعملاء: <b>${money(a.openingBalance)}</b>\n+ مبيعات التقرير: <b>${money(a.totalSales)}</b>\n− تحصيلات التقرير: <b>${money(a.totalCollections)}</b>\n= الرصيد الختامي المتوقع: <b>${money(a.closingBalance)}</b>`;
    return sendMessage(chatId,`<b>تحليلات التقرير اليومي — ${date}</b>\n\n<b>المديونية التراكمية</b>\n${balanceLines}\n\n<b>كفاءة اليوم</b>\nمتوسط الفاتورة: <b>${money(a.avgInvoice)}</b>\nنسبة التحصيل إلى المبيعات: <b>${num(a.collectionRate,1)}%</b>\nتغير الخزائن: <b>${money(a.treasuryClosing-a.treasuryOpening)}</b>\nتنبيهات مخزون صفري/سالب: <b>${a.stockAlerts.length}</b>\n\n<b>أعلى العملاء</b>\n${topCustomers}\n\n<b>أعلى الأصناف بالقيمة</b>\n${topItems}`.slice(0,3900));
  }
  const balanceLine=a.openingBalance===null?'الرصيد التراكمي: تعذر حسابه مؤقتًا.':`الرصيد الافتتاحي للعملاء: <b>${money(a.openingBalance)}</b>\nالرصيد الختامي المتوقع: <b>${money(a.closingBalance)}</b>`;
  const text=`<b>تقرير اليوم الكامل — ${date}</b>\nآخر إدخال معتمد: <b>${esc(data.batch.original_name||'التقرير اليومي')}</b>\n\n<b>المبيعات</b>\nإجمالي الفواتير: <b>${data.sales.length}</b>\nإجمالي المبيعات: <b>${money(a.totalSales)}</b>\nالبلوك: <b>${num(a.blockQty,3)} قطعة</b> — ${money(a.blockSales)}\nالخرسانة: <b>${num(a.concreteQty,3)} م³</b> — ${money(a.concreteSales)}\nمتوسط الفاتورة: <b>${money(a.avgInvoice)}</b>\n\n<b>التحصيل والمديونية</b>\nعدد التحصيلات: <b>${a.collections.length}</b>\nإجمالي التحصيل: <b>${money(a.totalCollections)}</b>\nنسبة التحصيل للمبيعات: <b>${num(a.collectionRate,1)}%</b>\n${balanceLine}\n\n<b>الخزائن والمخزون</b>\nحركات الخزائن: <b>${data.cash.length}</b>\nإجمالي ختامي الخزائن: <b>${money(a.treasuryClosing)}</b>\nأصناف المخزون: <b>${data.inventory.length}</b>\nتنبيهات رصيد صفري/سالب: <b>${a.stockAlerts.length}</b>`;
  return sendMessage(chatId,text.slice(0,3900),dailyDetailKeyboard());
}
