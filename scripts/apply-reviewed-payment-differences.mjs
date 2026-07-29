import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const payloadPath=process.env.REVIEWED_PAYMENT_PAYLOAD||'ops/reconciliation/erp-payment-differences-2026-07-19-to-27.json.gz.b64';
const resultPath=process.env.REVIEWED_PAYMENT_RESULT||'reviewed-payment-differences-result.json';
const databaseUrl=String(process.env.SUPABASE_DB_URL||'').trim();
const expectedHash='04cda870e64000dace70c29fe5858b6e5b8e98d48ac8c2c66df410d34a71408e';
const expectedRows=52;
const expectedAmount=169153;
const expectedSourceDates=['2026-07-23','2026-07-25','2026-07-26','2026-07-27'];
const postingDateBySource={'2026-07-27':'2026-07-26'};
const expectedPostingDates=['2026-07-23','2026-07-25','2026-07-26'];
const money=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100;
const fail=(code,reason,evidence={})=>{
  const output={ok:false,code,reason,evidence,checkedAt:new Date().toISOString()};
  writeFileSync(resultPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
  console.error(`[reviewed-payments] ${code}: ${reason}`);
  process.exit(1);
};

let raw;
try{
  const encoded=readFileSync(payloadPath,'utf8').trim();
  raw=gunzipSync(Buffer.from(encoded,'base64'));
}catch(error){
  fail('PAYLOAD_DECODE_FAILED','Could not decode the reviewed payment payload.',{message:String(error?.message||error)});
}

const actualHash=createHash('sha256').update(raw).digest('hex');
if(actualHash!==expectedHash)fail('PAYLOAD_HASH_MISMATCH','The reviewed payload hash does not match the approved source.',{actualHash,expectedHash});

let payload;
try{payload=JSON.parse(raw.toString('utf8'));}catch(error){fail('PAYLOAD_JSON_INVALID','The reviewed payload is not valid JSON.',{message:String(error?.message||error)});}
const payments=Array.isArray(payload?.payments)?payload.payments:[];
const total=money(payments.reduce((sum,row)=>sum+Number(row?.debit||0),0));
const sourceDates=[...new Set(payments.map(row=>String(row?.reportDate||'')).filter(Boolean))].sort();
if(payments.length!==expectedRows||total!==expectedAmount||JSON.stringify(sourceDates)!==JSON.stringify(expectedSourceDates)){
  fail('PAYLOAD_TOTALS_INVALID','The reviewed payload totals or source dates differ from the approved review.',{rows:payments.length,total,sourceDates,expectedRows,expectedAmount,expectedSourceDates});
}
for(const [index,row] of payments.entries()){
  const valid=/^\d{4}-\d{2}-\d{2}$/.test(String(row.reportDate||''))&&String(row.accountCode||'').trim()&&String(row.accountName||'').trim()&&String(row.voucherNo||'').trim()&&Number(row.debit)>0&&Number(row.credit||0)===0;
  if(!valid)fail('PAYLOAD_ROW_INVALID','A reviewed payment row is incomplete.',{index:index+1});
}

const preparedPayments=payments.map(row=>{
  const sourceDate=String(row.reportDate);
  const postingDate=postingDateBySource[sourceDate]||sourceDate;
  return{
    ...row,
    sourceReportDate:sourceDate,
    movementDate:postingDate,
    reportDate:postingDate,
    description:[String(row.description||'').trim(),sourceDate!==postingDate?`تسوية حركة أصلها ${sourceDate}`:''].filter(Boolean).join(' — ')
  };
});
const postingDates=[...new Set(preparedPayments.map(row=>row.reportDate))].sort();
if(JSON.stringify(postingDates)!==JSON.stringify(expectedPostingDates)){
  fail('POSTING_DATES_INVALID','The payment settlement dates differ from the approved target dates.',{postingDates,expectedPostingDates});
}

if(String(process.env.REVIEWED_PAYMENT_VALIDATE_ONLY||'')==='1'){
  const output={ok:true,validatedOnly:true,hash:actualHash,rows:payments.length,total,sourceDates,postingDates,postingDateBySource};
  writeFileSync(resultPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
  console.log(`[reviewed-payments] VALID rows=${payments.length} amount=${total}`);
  process.exit(0);
}
if(!databaseUrl)fail('DATABASE_URL_EMPTY','The protected production database connection is missing.');

const groups=new Map();
for(const row of preparedPayments){
  if(!groups.has(row.reportDate))groups.set(row.reportDate,[]);
  groups.get(row.reportDate).push(row);
}
const blocks=[];
for(const reportDate of expectedPostingDates){
  const rows=groups.get(reportDate)||[];
  const json64=Buffer.from(JSON.stringify(rows),'utf8').toString('base64');
  blocks.push(`do $reviewed$\ndeclare v_result jsonb;\nbegin\n  v_result:=public.append_daily_report_customer_payments(\n    '${reportDate}'::date,\n    '${actualHash}',\n    convert_from(decode('${json64}','base64'),'UTF8')::jsonb,\n    'reviewed-payment-differences-2026-07-29',\n    'ERP reviewed payment completion 19-27 July 2026; 27 July settled on 26 July'\n  );\n  if coalesce((v_result->>'conflictCount')::integer,0)>0 then\n    raise exception 'REVIEWED_PAYMENT_CONFLICT:${reportDate}:%',v_result;\n  end if;\n  insert into reviewed_payment_results(report_date,result) values('${reportDate}'::date,v_result);\nend\n$reviewed$;`);
}
const sql=`\\pset tuples_only on\n\\pset format unaligned\nset client_min_messages=warning;\ncreate temp table reviewed_payment_results(report_date date primary key,result jsonb not null);\n${blocks.join('\n\n')}\nselect jsonb_build_object(\n  'ok',true,\n  'days',jsonb_agg(jsonb_build_object(\n    'reportDate',report_date,\n    'inserted',coalesce((result->>'inserted')::integer,0),\n    'matched',coalesce((result->>'matched')::integer,0),\n    'insertedAmount',coalesce((result->>'insertedAmount')::numeric,0),\n    'conflictCount',coalesce((result->>'conflictCount')::integer,0)\n  ) order by report_date),\n  'totals',jsonb_build_object(\n    'inserted',sum(coalesce((result->>'inserted')::integer,0)),\n    'matched',sum(coalesce((result->>'matched')::integer,0)),\n    'insertedAmount',sum(coalesce((result->>'insertedAmount')::numeric,0)),\n    'conflictCount',sum(coalesce((result->>'conflictCount')::integer,0))\n  )\n)::text from reviewed_payment_results;\n`;
const sqlPath='reviewed-payment-differences.sql';
writeFileSync(sqlPath,sql,{mode:0o600});
const execution=spawnSync('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1','--single-transaction','--file',sqlPath],{encoding:'utf8',env:process.env,timeout:600000,maxBuffer:8*1024*1024});
try{unlinkSync(sqlPath);}catch{}
if(execution.error||execution.status!==0){
  fail('DATABASE_APPLY_FAILED','The atomic reviewed-payment transaction failed and was rolled back.',{exitCode:execution.status??-1,stderr:String(execution.stderr||'').slice(-4000)});
}
const resultLine=String(execution.stdout||'').split(/\r?\n/).map(line=>line.trim()).reverse().find(line=>line.startsWith('{'));
let result;
try{result=JSON.parse(resultLine||'');}catch{fail('DATABASE_RESULT_INVALID','The database did not return a valid reconciliation result.',{stdout:String(execution.stdout||'').slice(-4000)});}
const inserted=Number(result?.totals?.inserted||0);
const matched=Number(result?.totals?.matched||0);
const conflicts=Number(result?.totals?.conflictCount||0);
if(inserted+matched!==expectedRows||conflicts!==0){
  fail('DATABASE_RESULT_MISMATCH','The committed result does not account for every reviewed payment.',{inserted,matched,conflicts,expectedRows,result});
}
const output={ok:true,committed:true,source:payload.source,hash:actualHash,expected:{rows:expectedRows,amount:expectedAmount,sourceDates:expectedSourceDates,postingDates:expectedPostingDates,postingDateBySource},result,completedAt:new Date().toISOString()};
writeFileSync(resultPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
console.log(`[reviewed-payments] COMMITTED inserted=${inserted} matched=${matched} conflicts=${conflicts}`);
