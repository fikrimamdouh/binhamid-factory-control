import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { rpc, select } from '../supabase.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const clamp=(value,min,max,fallback)=>{const parsed=Number(value);return Number.isFinite(parsed)?Math.max(min,Math.min(max,Math.trunc(parsed))):fallback;};
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
function date(value){const text=clean(value,10);return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:'';}
function query(filters,order,limit){return[...filters,order,`limit=${limit}`].filter(Boolean).join('&');}
const one=value=>Array.isArray(value)?value[0]:value;

export async function accounting(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='POST'){
      const actor=await requireCapability(req,'accounting.post'),input=await body(req),action=clean(input.action,30);
      if(action!=='reverse')throw Object.assign(new Error('عملية المحاسبة غير مدعومة'),{status:400,code:'ACCOUNTING_ACTION_INVALID'});
      const entryId=clean(input.entryId,80),reason=clean(input.reason,1000);
      if(!entryId||!reason)throw Object.assign(new Error('رقم القيد وسبب العكس مطلوبان'),{status:400,code:'REVERSAL_INPUT_REQUIRED'});
      const result=one(await rpc('reverse_journal_entry',{p_entry_id:entryId,p_actor:actor.appUserId||actor.actor,p_reason:reason}));
      return json(res,200,{ok:true,action:'reverse',result});
    }
    const actor=await requireCapability(req,'accounting.view'),p=params(req),mode=clean(p.get('mode'),30)||'summary',from=date(p.get('from')),to=date(p.get('to')),customer=clean(p.get('customer'),120),limit=clamp(p.get('limit'),1,2000,300);
    if(mode==='integrity'){
      const rows=await select('accounting_integrity_report','select=*');
      return json(res,200,{ok:true,mode,actor:{role:actor.role},integrity:rows?.[0]||{}});
    }
    if(mode==='trial'){
      const rows=await select('trial_balance','select=account_code,account_name_ar,account_type,normal_side,total_debit,total_credit,balance&order=account_code.asc&limit=1000');
      const totals=(rows||[]).reduce((out,row)=>{out.debit+=Number(row.total_debit||0);out.credit+=Number(row.total_credit||0);return out;},{debit:0,credit:0});
      return json(res,200,{ok:true,mode,rows:rows||[],totals:{debit:Number(totals.debit.toFixed(2)),credit:Number(totals.credit.toFixed(2)),balanced:Number(totals.debit.toFixed(2))===Number(totals.credit.toFixed(2))}});
    }
    if(mode==='ledger'){
      const filters=['select=journal_entry_id,reference_no,entry_date,description,source_type,source_id,status,currency,line_no,account_code,account_name_ar,debit,credit,customer_external_id,cost_center_code,memo,running_balance'];
      if(from)filters.push(`entry_date=gte.${from}`);if(to)filters.push(`entry_date=lte.${to}`);if(customer)filters.push(`customer_external_id=eq.${encodeURIComponent(customer)}`);
      const rows=await select('general_ledger',query(filters,'order=entry_date.desc,reference_no.desc,line_no.asc',limit));
      return json(res,200,{ok:true,mode,rows:rows||[],filters:{from,to,customer},limit});
    }
    const filters=['select=id,reference_no,entry_date,description,source_type,source_id,source_batch_id,currency,status,posted_by,posted_at,created_at,journal_entry_lines(line_no,debit,credit,customer_external_id,cost_center_code,memo,chart_of_accounts(account_code,account_name_ar))'];
    if(from)filters.push(`entry_date=gte.${from}`);if(to)filters.push(`entry_date=lte.${to}`);
    const entries=await select('journal_entries',query(filters,'order=entry_date.desc,created_at.desc',limit));
    const summary=(entries||[]).reduce((out,entry)=>{out.entries++;for(const line of entry.journal_entry_lines||[]){out.debit+=Number(line.debit||0);out.credit+=Number(line.credit||0);}if(entry.status==='draft')out.unposted++;return out;},{entries:0,debit:0,credit:0,unposted:0});
    summary.debit=Number(summary.debit.toFixed(2));summary.credit=Number(summary.credit.toFixed(2));summary.balanced=summary.unposted===0&&summary.debit===summary.credit;
    return json(res,200,{ok:true,mode:'entries',entries:entries||[],summary,filters:{from,to},limit});
  }catch(error){errorResponse(res,error);}
}
