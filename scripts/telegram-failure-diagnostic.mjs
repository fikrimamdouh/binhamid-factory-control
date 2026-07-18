import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const db=String(process.env.SUPABASE_DB_URL||'').trim();
const output='telegram-failure-diagnostic.json';
const classify=stderr=>/relation .* does not exist/i.test(String(stderr||''))?'RELATION_MISSING':/column .* does not exist/i.test(String(stderr||''))?'COLUMN_MISSING':/permission denied/i.test(String(stderr||''))?'PERMISSION_DENIED':'QUERY_FAILED';
if(!db){writeFileSync(output,JSON.stringify({ok:false,code:'DATABASE_URL_EMPTY'},null,2));process.exit(0);}
const sql=`select json_build_object(
  'failedByCode',(select coalesce(json_agg(x),'[]'::json) from (
    select coalesce(last_error_code,'NONE') code,count(*) count,max(updated_at) last_at,max(attempts) max_attempts,bool_or(retryable) retryable
    from telegram_update_receipts
    where updated_at>=now()-interval '24 hours' and status='failed'
    group by coalesce(last_error_code,'NONE') order by count(*) desc
  ) x),
  'latestFailures',(select coalesce(json_agg(x),'[]'::json) from (
    select payload_kind,coalesce(last_error_code,'NONE') code,
      left(regexp_replace(coalesce(last_error_message,''),'(Bearer\\s+[^ ]+|sb_secret_[A-Za-z0-9_-]+)','[redacted]','gi'),240) message,
      attempts,retryable,updated_at
    from telegram_update_receipts
    where updated_at>=now()-interval '24 hours' and status='failed'
    order by updated_at desc limit 20
  ) x),
  'processingOlderThanFiveMinutes',(select count(*) from telegram_update_receipts where status='processing' and updated_at<now()-interval '5 minutes'),
  'failedDocumentUpdates',(select count(*) from telegram_update_receipts where status='failed' and payload_kind='document' and updated_at>=now()-interval '24 hours'),
  'failedVoiceUpdates',(select count(*) from telegram_update_receipts where status='failed' and payload_kind='voice' and updated_at>=now()-interval '24 hours'),
  'failedPhotoUpdates',(select count(*) from telegram_update_receipts where status='failed' and payload_kind='photo' and updated_at>=now()-interval '24 hours'),
  'failedMessageUpdates',(select count(*) from telegram_update_receipts where status='failed' and payload_kind='message' and updated_at>=now()-interval '24 hours')
)::text;`;
const result=spawnSync('psql',[db,'-X','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:120000,env:process.env});
if(result.error||result.status!==0){writeFileSync(output,JSON.stringify({ok:false,code:classify(result.stderr||result.error?.message)},null,2));process.exit(0);}
try{const data=JSON.parse(String(result.stdout||'').trim());writeFileSync(output,JSON.stringify({ok:true,...data},null,2)+'\n',{mode:0o600});}
catch{writeFileSync(output,JSON.stringify({ok:false,code:'INVALID_JSON'},null,2));}
