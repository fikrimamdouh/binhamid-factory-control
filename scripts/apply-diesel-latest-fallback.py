from pathlib import Path

analytics_path=Path('api/_lib/fuel-analytics.js')
analytics=analytics_path.read_text()
marker="export async function loadFuelAnalytics(days=30,{category='diesel'}={}){"
if 'export async function loadLatestFuelActivity' not in analytics:
    addition="""
// آخر بيانات فعلية وآخر ملف مرفوع: يمنع تقرير «اليوم» من عرض أصفار مضللة
// عندما لم تصل مزامنة أمس بعد، ويُظهر للمستخدم تاريخ المصدر المتاح بوضوح.
export async function loadLatestFuelActivity({category='diesel'}={}){
  let transactions=[],transactionError='';
  try{transactions=await select('fuel_transactions','select=transaction_date,fuel_type&order=transaction_date.desc&limit=5000')||[];}
  catch(error){transactionError=storeFailureReason(error);}
  const latestRow=transactions.find(row=>inCategory(row,category))||null;
  let lastImport=null;
  try{lastImport=(await select('imports','source=eq.noor-khoy&report_type=eq.fuel&select=created_at,original_name,summary&order=created_at.desc&limit=1'))?.[0]||null;}
  catch(error){console.warn('[fuel latest import]',String(error?.message||'').slice(0,220));}
  const summary=lastImport?.summary&&typeof lastImport.summary==='object'?lastImport.summary:{};
  const lastReportDate=isoDate(summary?.period?.end)||isoDate(summary?.source?.reportDate)||isoDate(summary?.balanceDate)||'';
  return{category,latestDate:isoDate(latestRow?.transaction_date),lastReportDate,lastUploadAt:clean(lastImport?.created_at),sourceFile:clean(lastImport?.original_name),error:transactionError};
}

"""
    if marker not in analytics: raise SystemExit('analytics marker missing')
    analytics=analytics.replace(marker,addition+marker)
    analytics_path.write_text(analytics)

reports_path=Path('api/_lib/bot-fuel-reports.js')
reports=reports_path.read_text()
reports=reports.replace("import { loadFuelAnalytics, loadFuelStatement, loadVehicleStatement, monthStart, yesterday } from './fuel-analytics.js';","import { loadFuelAnalytics, loadFuelStatement, loadVehicleStatement, loadLatestFuelActivity, monthStart, yesterday } from './fuel-analytics.js';")
start=reports.index("// «تقرير اليوم» يعني مسحوبات أمس")
end=reports.index("const ISO_DATE=",start)
replacement="""// «تقرير اليوم» يعني مسحوبات أمس. إذا لم تصل مزامنة أمس بعد فلا نعرض
// صفرًا مضللًا؛ نرجع إلى آخر يوم بيانات متاح ونذكر تاريخ آخر رفع بوضوح.
function uploadNote(latest={}){
  const reportDate=latest.lastReportDate||latest.latestDate;
  if(!reportDate)return null;
  return note(`آخر ملف مرفوع يغطي حتى ${arabicDate(reportDate)}${latest.sourceFile?` — ${esc(latest.sourceFile)}`:''}.`);
}
function dayReportBody(identity,category,day,data,contextNote=null,latest=null){
  const{totals,vehicles,perLiter}=data;
  return compose(warmAck(identity),title('📅',`مسحوبات ${arabicDate(day)} — ${CATEGORY_LABEL[category]}`),contextNote?note(contextNote):null,latest?uploadNote(latest):null,RULE,line('🛢️','المسحوب',qty(Math.round(totals.liters)),'لتر'),line('💰','القيمة',money(totals.amount),'ر.س'),line('🧾','التعبئات',qty(totals.fills)),line('🚚','المركبات',qty(totals.plates)),line('📊','متوسط اللتر',money(perLiter.toFixed(2)),'ر.س'),RULE,section('🚚','لكل مركبة'),...vehicles.map((row,index)=>`${index+1}. <b>${esc(row.name)}</b> — ${qty(Math.round(row.liters))} لتر · ${money(row.amount)} ر.س${row.fills>1?` · ${qty(row.fills)} تعبئات`:''}`),data.otherTotals?.fills?[RULE,note(`وأيضًا ${qty(data.otherTotals.fills)} تعبئة من فئة أخرى بمبلغ ${money(data.otherTotals.amount)} ر.س.`)]:null);
}
async function dayView(chatId,identity,category,date){
  const requestedDay=date||yesterday();
  const data=await loadFuelStatement({from:requestedDay,to:requestedDay,category});
  if(data.error)return sendMessage(chatId,compose(title('⚠️','تعذّر قراءة سجل الوقود'),RULE,`🛠️ ${esc(data.error)}`,note('التقرير سيعمل فور معالجة هذا السبب؛ الملفات المرسلة لن تضيع.')),statementMenu(category,requestedDay,requestedDay,[]));
  if(data.hasData)return sendMessage(chatId,dayReportBody(identity,category,requestedDay,data),statementMenu(category,requestedDay,requestedDay,data.vehicles));
  const latest=await loadLatestFuelActivity({category});
  if(latest.latestDate&&latest.latestDate!==requestedDay){
    const latestData=await loadFuelStatement({from:latest.latestDate,to:latest.latestDate,category});
    if(latestData.hasData)return sendMessage(chatId,dayReportBody(identity,category,latest.latestDate,latestData,`لا توجد بيانات مسجلة ليوم ${arabicDate(requestedDay)}؛ المعروض هو آخر يوم متاح.`,latest),statementMenu(category,latest.latestDate,latest.latestDate,latestData.vehicles));
  }
  return sendMessage(chatId,compose(title('📅',`مسحوبات ${arabicDate(requestedDay)}`),RULE,note(`لا توجد مسحوبات ${CATEGORY_LABEL[category]} مسجّلة في هذا اليوم.`),uploadNote(latest),data.hasAnyData?note('توجد حركات من فئة وقود أخرى في اليوم نفسه — بدّل الفئة.'):note('لم تصل بيانات أحدث إلى سجل الوقود بعد.')),statementMenu(category,requestedDay,requestedDay,[]));
}

"""
reports=reports[:start]+replacement+reports[end:]
old="""  if(/^\/(fuel|diesel)$/i.test(raw)||/^(ديزل|تقارير الديزل|الديزل|تقرير الديزل|استهلاك الديزل|الوقود)$/.test(value)){
    await showFuelMenu(message,identity);return true;
  }
  return false;"""
new="""  if(/^\/(fuel|diesel)$/i.test(raw)||/^(ديزل|تقارير الديزل|الديزل|تقرير الديزل|استهلاك الديزل|الوقود)$/.test(value)||/ديزل/.test(value)){
    await showFuelMenu(message,identity);return true;
  }
  return false;"""
if old not in reports: raise SystemExit('fuel command block missing')
reports_path.write_text(reports.replace(old,new))

webhook_path=Path('api/_lib/telegram-webhook-handler.js')
webhook=webhook_path.read_text()
needle="  if(await handleFuelTextCommand(message,identity,raw))return;\n  if(await handleProcurementTextCommand(message,identity,raw))return;"
repl="  if(await handleFuelTextCommand(message,identity,raw))return;\n  // أي رسالة ديزل غير مكتملة تفتح قائمة الاختيارات بدل رد تخميني طويل.\n  if(/ديزل/.test(normalized))return showFuelMenu(message,identity);\n  if(await handleProcurementTextCommand(message,identity,raw))return;"
if needle not in webhook: raise SystemExit('webhook marker missing')
webhook_path.write_text(webhook.replace(needle,repl))

Path('tests/fuel-latest-data-fallback.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
test('ambiguous diesel text opens menu before AI',()=>{const reports=read('api/_lib/bot-fuel-reports.js'),webhook=read('api/_lib/telegram-webhook-handler.js');assert.match(reports,/\/ديزل\/\.test\(value\)/);assert.match(webhook,/if\(\/ديزل\/\.test\(normalized\)\)return showFuelMenu/);});
test('daily diesel falls back to latest data and shows upload date',()=>{const analytics=read('api/_lib/fuel-analytics.js'),reports=read('api/_lib/bot-fuel-reports.js');assert.match(analytics,/loadLatestFuelActivity/);assert.match(reports,/لا توجد بيانات مسجلة ليوم/);assert.match(reports,/آخر ملف مرفوع يغطي حتى/);});
""")
