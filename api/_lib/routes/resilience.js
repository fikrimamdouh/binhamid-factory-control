import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { insert, patch, select } from '../supabase.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
async function audit(actor,action,entityType,entityId,details={}){await insert('audit_log',[{actor_type:'web',actor_id:actor,action,entity_type:entityType,entity_id:entityId,details}],{prefer:'return=minimal'}).catch(()=>{});}

async function overview(){
  const [outbox,alerts,backups,rotations]=await Promise.all([
    select('notification_outbox','status=in.(pending,processing,failed,dead_letter,cancelled)&select=id,notification_type,recipient_user_id,recipient_chat_id,title,message,payload,status,scheduled_at,sent_at,error_text,attempts,last_attempt_at,dead_letter_at,created_at&order=created_at.desc&limit=1000'),
    select('operational_alerts','select=id,alert_key,alert_type,severity,status,entity_type,entity_id,title,message,payload,first_detected_at,last_detected_at,sent_at,acknowledged_at,acknowledged_by,resolved_at,resolved_by,attempts,last_error,next_attempt_at&order=last_detected_at.desc&limit=1000'),
    select('backup_runs','select=id,environment,backup_name,schema_version,status,storage_path,manifest,checksum_sha256,encrypted,size_bytes,started_at,completed_at,verified_at,error_text&order=started_at.desc&limit=200'),
    select('token_rotation_registry','select=secret_name,last_rotated_at,next_due_at,owner_role,rotation_notes,updated_at&order=next_due_at.asc&limit=100')
  ]);
  return{outbox:outbox||[],alerts:alerts||[],backups:backups||[],tokenRotations:rotations||[]};
}

async function mutate(input,identity){
  const action=clean(input.action,60),id=clean(input.id,100),actor=identity.appUserId||identity.actor;
  if(action==='notification_retry'){
    if(!id)throw Object.assign(new Error('معرف الرسالة مطلوب'),{status:400});
    const rows=await patch('notification_outbox',`id=eq.${encodeURIComponent(id)}&status=in.(failed,dead_letter,cancelled)`,{status:'pending',scheduled_at:new Date().toISOString(),error_text:null});
    await audit(actor,'notification_requeued','notification_outbox',id,{previous_status:'failed_or_dead_letter'});return{item:rows?.[0]||null};
  }
  if(action==='notification_cancel'){
    if(!id)throw Object.assign(new Error('معرف الرسالة مطلوب'),{status:400});
    const rows=await patch('notification_outbox',`id=eq.${encodeURIComponent(id)}&status=in.(pending,processing,failed,dead_letter)`,{status:'cancelled',error_text:clean(input.reason,500)||'ألغيت إداريًا'});
    await audit(actor,'notification_cancelled','notification_outbox',id,{reason:clean(input.reason,500)});return{item:rows?.[0]||null};
  }
  if(action==='alert_acknowledge'||action==='alert_resolve'){
    if(!id)throw Object.assign(new Error('معرف التنبيه مطلوب'),{status:400});
    const resolved=action==='alert_resolve',values=resolved?{status:'resolved',resolved_at:new Date().toISOString(),resolved_by:actor}:{status:'acknowledged',acknowledged_at:new Date().toISOString(),acknowledged_by:actor};
    const rows=await patch('operational_alerts',`id=eq.${encodeURIComponent(id)}`,values);await audit(actor,resolved?'operational_alert_resolved':'operational_alert_acknowledged','operational_alert',id,{note:clean(input.note,1000)});return{item:rows?.[0]||null};
  }
  if(action==='backup_record'){
    await requireCapability(input.__req,'backups.manage');
    const backupName=clean(input.backupName,240),checksum=clean(input.checksumSha256,64),status=clean(input.status,30)||'completed';if(!backupName||!['completed','failed','verified'].includes(status))throw Object.assign(new Error('بيانات النسخة الاحتياطية غير صحيحة'),{status:400});
    const rows=await insert('backup_runs',[{environment:clean(input.environment,40)||'production',backup_name:backupName,schema_version:Number(input.schemaVersion)||0,status,storage_path:clean(input.storagePath,500)||null,manifest:input.manifest&&typeof input.manifest==='object'?input.manifest:{},checksum_sha256:checksum||null,encrypted:Boolean(input.encrypted),size_bytes:Number(input.sizeBytes)||null,completed_at:status==='failed'?null:new Date().toISOString(),verified_at:status==='verified'?new Date().toISOString():null,error_text:status==='failed'?clean(input.error,1000):null}]);
    await audit(actor,'backup_run_recorded','backup_run',rows?.[0]?.id||backupName,{backup_name:backupName,status,checksum});return{item:rows?.[0]||null};
  }
  if(action==='token_rotation_record'){
    await requireCapability(input.__req,'backups.manage');
    const secretName=clean(input.secretName,120);if(!secretName||secretName.includes('='))throw Object.assign(new Error('اسم السر غير صحيح'),{status:400});
    const nextDue=new Date(Date.now()+90*86400000).toISOString(),rows=await patch('token_rotation_registry',`secret_name=eq.${encodeURIComponent(secretName)}`,{last_rotated_at:new Date().toISOString(),next_due_at:nextDue,updated_at:new Date().toISOString()});
    await audit(actor,'token_rotation_recorded','secret_registry',secretName,{next_due_at:nextDue});return{item:rows?.[0]||null};
  }
  throw Object.assign(new Error('إجراء الاستمرارية غير معروف'),{status:400});
}

export async function resilience(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){
      const p=params(req),scope=clean(p.get('scope'),40)||'all';
      await requireCapability(req,scope==='backups'?'backups.manage':'audit.view');
      const data=await overview();return json(res,200,{ok:true,...data});
    }
    const input=await body(req),identity=await requireCapability(req,['backup_record','token_rotation_record'].includes(clean(input.action,60))?'backups.manage':'audit.view');
    input.__req=req;const result=await mutate(input,identity);delete input.__req;return json(res,200,{ok:true,...result});
  }catch(error){errorResponse(res,error);}
}
