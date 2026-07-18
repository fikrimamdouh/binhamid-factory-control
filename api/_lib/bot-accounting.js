import { select } from './supabase.js';
import { sendMessage, keyboard } from './telegram.js';
import { capabilityAllowed } from './permissions.js';
import { esc, formatAmount, setEnterpriseSession } from './bot-enterprise-store.js';

const VIEW_CAPABILITY='accounting.view';
const clean=value=>String(value||'').trim().slice(0,120);
async function canView(identity){
  if(!identity?.active)return false;
  const userId=String(identity.user_id||'');
  const [roleRows,userRows]=await Promise.all([
    safeSelect('role_capabilities',`role=eq.${encodeURIComponent(identity.role||'pending')}&select=capability,allowed&limit=500`),
    userId?safeSelect('user_capabilities',`app_user_id=eq.${encodeURIComponent(userId)}&select=capability,allowed&limit=500`):Promise.resolve([])
  ]);
  return capabilityAllowed(identity.role,VIEW_CAPABILITY,roleRows,userRows);
}
async function guarded(chatId,identity,work){if(!await canView(identity)){await sendMessage(chatId,'مركز المحاسبة متاح فقط لمن يملك صلاحية accounting.view.');return null;}return work();}
async function safeSelect(table,query){try{return await select(table,query)||[];}catch(error){console.warn('[telegram accounting read]',{table,message:String(error?.message||'').slice(0,250)});return[];}}
const amount=value=>formatAmount(Number(value||0));

export const accountingMenu=()=>keyboard([[{text:'📊 الملخص المحاسبي',callback_data:'ent:accounting_summary'},{text:'⚖️ ميزان المراجعة',callback_data:'ent:accounting_trial'}],[{text:'📚 أحدث دفتر الأستاذ',callback_data:'ent:accounting_ledger'},{text:'🔎 بحث حساب أو قيد',callback_data:'ent:accounting_search'}],[{text:'🧾 أحدث القيود',callback_data:'ent:accounting_entries'},{text:'🛡 فحص سلامة الحسابات',callback_data:'ent:accounting_integrity'}]]);

export async function sendAccountingSummary(chatId,identity){
  return guarded(chatId,identity,async()=>{
    const [entries,trial,integrityRows]=await Promise.all([
      safeSelect('journal_entries','select=id,status,entry_date,posted_at&order=entry_date.desc,created_at.desc&limit=1000'),
      safeSelect('trial_balance','select=total_debit,total_credit,balance&limit=1000'),
      safeSelect('accounting_integrity_report','select=*&limit=1')
    ]);
    const totals=trial.reduce((out,row)=>{out.debit+=Number(row.total_debit||0);out.credit+=Number(row.total_credit||0);return out;},{debit:0,credit:0});
    const draft=entries.filter(row=>row.status==='draft').length,posted=entries.filter(row=>row.status==='posted').length,balanced=Number(totals.debit.toFixed(2))===Number(totals.credit.toFixed(2));
    const integrity=integrityRows[0]||{},issues=Object.entries(integrity).filter(([key,value])=>/(error|issue|unbalanced|orphan|negative|missing|difference|mismatch)/i.test(key)&&Number(value)>0);
    return sendMessage(chatId,`<b>الملخص المحاسبي</b>\n\n• القيود المرحّلة: <b>${posted}</b>\n• القيود المسودة: <b>${draft}</b>\n• إجمالي المدين: <b>${amount(totals.debit)} ر.س</b>\n• إجمالي الدائن: <b>${amount(totals.credit)} ر.س</b>\n• ميزان المراجعة: <b>${balanced?'متزن ✅':'غير متزن ⚠️'}</b>\n• فحص السلامة: <b>${issues.length?'توجد مؤشرات تحتاج مراجعة':'سليم ✅'}</b>`);
  });
}
export async function sendTrialBalance(chatId,identity){
  return guarded(chatId,identity,async()=>{
    const rows=await safeSelect('trial_balance','select=account_code,account_name_ar,account_type,normal_side,total_debit,total_credit,balance&order=account_code.asc&limit=1000');
    if(!rows.length)return sendMessage(chatId,'لا توجد أرصدة في ميزان المراجعة حتى الآن.');
    const totals=rows.reduce((out,row)=>{out.debit+=Number(row.total_debit||0);out.credit+=Number(row.total_credit||0);return out;},{debit:0,credit:0});
    const important=[...rows].sort((a,b)=>Math.abs(Number(b.balance||0))-Math.abs(Number(a.balance||0))).slice(0,20);
    const lines=important.map(row=>`• <code>${esc(row.account_code)}</code> ${esc(row.account_name_ar||'حساب')} — <b>${amount(row.balance)} ر.س</b>`);
    return sendMessage(chatId,`<b>ميزان المراجعة</b>\n\nمدين: <b>${amount(totals.debit)} ر.س</b>\nدائن: <b>${amount(totals.credit)} ر.س</b>\nالحالة: <b>${Number(totals.debit.toFixed(2))===Number(totals.credit.toFixed(2))?'متزن ✅':'غير متزن ⚠️'}</b>\n\n<b>أكبر الأرصدة</b>\n${lines.join('\n')}`.slice(0,3900));
  });
}
function ledgerLine(row){return `• <b>${esc(row.reference_no||row.journal_entry_id||'قيد')}</b> — ${esc(row.entry_date||'')}\n  <code>${esc(row.account_code||'')}</code> ${esc(row.account_name_ar||'')}\n  مدين ${amount(row.debit)} | دائن ${amount(row.credit)}${row.description?`\n  ${esc(row.description).slice(0,140)}`:''}`;}
export async function sendLedger(chatId,identity,query=''){
  return guarded(chatId,identity,async()=>{
    const rows=await safeSelect('general_ledger',query||'select=journal_entry_id,reference_no,entry_date,description,account_code,account_name_ar,debit,credit,customer_external_id,running_balance&order=entry_date.desc,reference_no.desc,line_no.asc&limit=30');
    if(!rows.length)return sendMessage(chatId,'لا توجد حركات دفتر أستاذ مطابقة.');
    return sendMessage(chatId,`<b>دفتر الأستاذ</b> — ${rows.length} حركة\n\n${rows.slice(0,25).map(ledgerLine).join('\n\n')}`.slice(0,3900));
  });
}
export async function sendRecentEntries(chatId,identity){
  return guarded(chatId,identity,async()=>{
    const rows=await safeSelect('journal_entries','select=id,reference_no,entry_date,description,source_type,status,currency,posted_at,created_at&order=entry_date.desc,created_at.desc&limit=25');
    if(!rows.length)return sendMessage(chatId,'لا توجد قيود محاسبية حتى الآن.');
    const lines=rows.map(row=>`• <b>${esc(row.reference_no||row.id)}</b> — ${esc(row.entry_date||'')}\n  ${esc(row.description||row.source_type||'قيد محاسبي').slice(0,150)} | ${esc(row.status==='posted'?'مرحّل':row.status||'')}`);
    return sendMessage(chatId,`<b>أحدث القيود المحاسبية</b>\n\n${lines.join('\n\n')}`.slice(0,3900));
  });
}
export async function sendAccountingIntegrity(chatId,identity){
  return guarded(chatId,identity,async()=>{
    const row=(await safeSelect('accounting_integrity_report','select=*&limit=1'))[0];
    if(!row)return sendMessage(chatId,'لا توجد نتيجة لفحص سلامة الحسابات حتى الآن.');
    const labels={balanced_entries:'قيود متزنة',unbalanced_entries:'قيود غير متزنة',orphan_lines:'سطور بلا قيد',draft_entries:'قيود مسودة',posted_entries:'قيود مرحّلة',debit_total:'إجمالي المدين',credit_total:'إجمالي الدائن'};
    const lines=Object.entries(row).filter(([,value])=>['string','number','boolean'].includes(typeof value)).slice(0,30).map(([key,value])=>`• ${esc(labels[key]||key.replaceAll('_',' '))}: <b>${esc(value)}</b>`);
    return sendMessage(chatId,`<b>فحص سلامة الحسابات</b>\n\n${lines.join('\n')}`.slice(0,3900));
  });
}
export async function startAccountingSearch(message,identity){
  if(!await canView(identity))return sendMessage(message.chat.id,'ليست لديك صلاحية accounting.view.');
  await setEnterpriseSession(message.chat.id,identity.external_id||message.from.id,'enterprise_accounting_search',{startedAt:new Date().toISOString()});
  return sendMessage(message.chat.id,'اكتب رقم الحساب أو اسمه أو رقم القيد أو اسم العميل. يمكنك إرساله صوتيًا أيضًا.\n\nاكتب «إلغاء» للخروج.');
}
export async function continueAccountingSession(message,identity,session,text){
  if(session?.state!=='enterprise_accounting_search')return false;
  const term=clean(text);if(term.length<2){await sendMessage(message.chat.id,'اكتب حرفين على الأقل للبحث.');return true;}
  const token=encodeURIComponent(`*${term.replace(/[(),]/g,' ')}*`);
  const query=`select=journal_entry_id,reference_no,entry_date,description,account_code,account_name_ar,debit,credit,customer_external_id,running_balance&or=(account_code.ilike.${token},account_name_ar.ilike.${token},reference_no.ilike.${token},description.ilike.${token},customer_external_id.ilike.${token})&order=entry_date.desc,reference_no.desc,line_no.asc&limit=40`;
  await sendLedger(message.chat.id,identity,query);return true;
}
export async function handleAccountingCallback(message,identity,value){
  if(value==='accounting_menu')return guarded(message.chat.id,identity,()=>sendMessage(message.chat.id,'اختر التقرير أو البحث المحاسبي:',accountingMenu()));
  if(value==='accounting_summary')return sendAccountingSummary(message.chat.id,identity);
  if(value==='accounting_trial')return sendTrialBalance(message.chat.id,identity);
  if(value==='accounting_ledger')return sendLedger(message.chat.id,identity);
  if(value==='accounting_entries')return sendRecentEntries(message.chat.id,identity);
  if(value==='accounting_integrity')return sendAccountingIntegrity(message.chat.id,identity);
  if(value==='accounting_search')return startAccountingSearch({...message,from:message.from||{}},identity);
  return false;
}
export async function handleAccountingTextCommand(message,identity,text){
  const value=String(text||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,'').replace(/\s+/g,' ').trim();
  if(/^\/(accounting|accounts)(?:@\w+)?$/i.test(String(text||'').trim())||/^(المحاسبه|الحسابات|مركز المحاسبه|قائمه المحاسبه)$/.test(value)){await handleAccountingCallback(message,identity,'accounting_menu');return true;}
  if(/^(ملخص المحاسبه|الحاله المحاسبيه|وضع الحسابات)$/.test(value)){await sendAccountingSummary(message.chat.id,identity);return true;}
  if(/^(ميزان المراجعه|اعرض ميزان المراجعه)$/.test(value)){await sendTrialBalance(message.chat.id,identity);return true;}
  if(/^(دفتر الاستاذ|احدث دفتر الاستاذ|اخر القيود|احدث القيود)$/.test(value)){await sendLedger(message.chat.id,identity);return true;}
  if(/^(ابحث في الحسابات|بحث حساب|بحث قيد)$/.test(value)){await startAccountingSearch(message,identity);return true;}
  return false;
}
