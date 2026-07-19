import crypto from 'node:crypto';
import { insert, patch, rpc, select, upsert } from './supabase.js';
import { sendMessage } from './telegram.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const money=value=>{const n=Number(value);return Number.isFinite(n)?Math.round((n+Number.EPSILON)*100)/100:0;};
const terminal=new Set(['completed','rejected','cancelled','reversed']);

export function stableStringify(value){
  if(Array.isArray(value))return`[${value.map(stableStringify).join(',')}]`;
  if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function lifecycleForStatus(status=''){
  const value=clean(status,40).toLowerCase();
  if(value==='draft')return'draft';
  if(['approved','confirmed','scheduled','in_production','ready','dispatched','delivered'].includes(value))return'approved';
  if(['posted','invoiced'].includes(value))return'posted';
  if(['completed','closed','collected'].includes(value))return'completed';
  if(['rejected','cancelled','reversed','failed','retry_pending'].includes(value))return value;
  return'pending_review';
}

export function buildIdempotencyKey(input={}){
  const explicit=clean(input.idempotencyKey??input.idempotency_key,240);
  if(explicit)return explicit;
  const operationType=clean(input.operationType??input.operation_type,120),source=clean(input.source,30),sourceReference=clean(input.sourceReference??input.source_reference,240);
  const basis=sourceReference?{operationType,source,sourceReference}:{operationType,source,referenceNo:clean(input.referenceNo??input.reference_no,120),payload:input.payload&&typeof input.payload==='object'?input.payload:{}};
  return`op:${crypto.createHash('sha256').update(stableStringify(basis)).digest('hex')}`;
}

export function buildOperationEnvelope(input={}){
  const operationType=clean(input.operationType??input.operation_type,120),source=clean(input.source,30);
  if(!operationType)throw Object.assign(new Error('نوع العملية مطلوب'),{status:400,code:'OPERATION_TYPE_REQUIRED'});
  if(!source)throw Object.assign(new Error('مصدر العملية مطلوب'),{status:400,code:'OPERATION_SOURCE_REQUIRED'});
  const status=clean(input.status,40)||'draft',payload=input.payload&&typeof input.payload==='object'?input.payload:{};
  return{operation_type:operationType,entity_type:clean(input.entityType??input.entity_type,120)||operationType,reference_no:clean(input.referenceNo??input.reference_no,120)||null,department:clean(input.department,80)||'general',status,lifecycle_status:clean(input.lifecycleStatus??input.lifecycle_status,40)||lifecycleForStatus(status),title:clean(input.title,500)||null,summary:clean(input.summary,2000)||null,amount:money(input.amount),payload,domain_record:input.domainRecord&&typeof input.domainRecord==='object'?input.domainRecord:{},source,source_reference:clean(input.sourceReference??input.source_reference,240)||null,source_chat_id:clean(input.sourceChatId??input.source_chat_id,120)||null,source_message_id:clean(input.sourceMessageId??input.source_message_id,120)||null,actor_id:clean(input.actorId??input.actor_id,120)||null,actor_role:clean(input.actorRole??input.actor_role,80)||null,created_by_user_id:clean(input.createdByUserId??input.created_by_user_id,120)||null,assigned_to_user_id:clean(input.assignedToUserId??input.assigned_to_user_id,120)||null,before_data:input.beforeData&&typeof input.beforeData==='object'?input.beforeData:{},after_data:input.afterData&&typeof input.afterData==='object'?input.afterData:payload,idempotency_key:buildIdempotencyKey(input)};
}

function normalizeNotifications(notifications=[],key=''){
  return(Array.isArray(notifications)?notifications:[]).filter(item=>item&&item.message).map((item,index)=>({type:clean(item.type,80)||'operation',userId:clean(item.userId,120)||null,chatId:clean(item.chatId,120)||null,title:clean(item.title,300)||null,message:clean(item.message,12000),scheduledAt:clean(item.scheduledAt,80)||null,dedupeKey:clean(item.dedupeKey,240)||`${key}:notification:${index+1}`,payload:item.payload&&typeof item.payload==='object'?item.payload:{}}));
}
function rpcUnavailable(error){return/PGRST202|Could not find the function|execute_unified_operation|transition_unified_operation/i.test(`${error?.message||''} ${JSON.stringify(error?.data||{})}`);}
async function chatForUser(userId){const value=clean(userId,120);if(!value)return null;return(await select('user_channels',`user_id=eq.${encodeURIComponent(value)}&channel=eq.telegram&active=eq.true&select=external_id&order=last_seen_at.desc&limit=1`).catch(()=>[]))?.[0]?.external_id||null;}

async function compatibilityExecute(envelope,notifications){
  const byKey=(await select('operational_records',`payload->>idempotency_key=eq.${encodeURIComponent(envelope.idempotency_key)}&select=*&order=created_at.desc&limit=1`).catch(()=>[]))?.[0],byReference=byKey?null:(await select('operational_records',`entity_type=eq.${encodeURIComponent(envelope.entity_type)}&reference_no=eq.${encodeURIComponent(String(envelope.reference_no||''))}&select=*&limit=1`).catch(()=>[]))?.[0],existing=byKey||byReference;
  if(existing&&existing.payload?.idempotency_key===envelope.idempotency_key)return{ok:true,duplicate:true,operationId:existing.id,referenceNo:existing.reference_no,status:existing.status,lifecycleStatus:existing.payload?.lifecycle_status||lifecycleForStatus(existing.status),outboxIds:[],compatibilityMode:true};
  const reference=envelope.reference_no||`OP-${envelope.idempotency_key.slice(-16).toUpperCase()}`,stamp=now(),payload={...envelope.payload,operation_type:envelope.operation_type,idempotency_key:envelope.idempotency_key,lifecycle_status:envelope.lifecycle_status,source:envelope.source,source_reference:envelope.source_reference};
  const row={reference_no:reference,entity_type:envelope.entity_type,department:envelope.department,status:envelope.status,title:envelope.title,summary:envelope.summary,amount:envelope.amount,payload,created_by:envelope.created_by_user_id||null,assigned_to:envelope.assigned_to_user_id||null,source_channel:envelope.source,source_chat_id:envelope.source_chat_id,source_message_id:envelope.source_message_id,created_at:stamp,updated_at:stamp,closed_at:terminal.has(envelope.lifecycle_status)?stamp:null};
  const saved=(await upsert('operational_records',[row],'entity_type,reference_no'))?.[0]||row;
  await insert('audit_log',[{actor_type:envelope.source,actor_id:envelope.actor_id||'system',action:'unified_operation_created',entity_type:envelope.entity_type,entity_id:reference,details:{...payload,status:envelope.status,actor_role:envelope.actor_role},created_at:stamp}],{prefer:'return=minimal'}).catch(()=>{});
  const outbox=[];
  for(const notification of notifications){const rows=await insert('notification_outbox',[{notification_type:notification.type,recipient_user_id:notification.userId,recipient_chat_id:notification.chatId,title:notification.title,message:notification.message,payload:{...notification.payload,dedupe_key:notification.dedupeKey,operation_id:saved.id||null},status:'pending',scheduled_at:notification.scheduledAt||stamp}]).catch(()=>[]);if(rows?.[0]?.id)outbox.push(rows[0].id);}
  return{ok:true,duplicate:false,operationId:saved.id||null,referenceNo:reference,status:envelope.status,lifecycleStatus:envelope.lifecycle_status,outboxIds:outbox,compatibilityMode:true};
}

export async function executeOperation(input={}){
  const envelope=buildOperationEnvelope(input),notifications=normalizeNotifications(input.notifications,envelope.idempotency_key);
  try{return await rpc('execute_unified_operation',{p_operation:envelope,p_notifications:notifications});}
  catch(error){if(!rpcUnavailable(error))throw error;return compatibilityExecute(envelope,notifications);}
}
export async function getOperationByReference(reference){const value=clean(reference,120);if(!value)return null;return(await select('operational_records',`reference_no=eq.${encodeURIComponent(value)}&select=*&order=created_at.desc&limit=1`))?.[0]||null;}
export async function getOperationById(id){const value=clean(id,120);if(!value)return null;return(await select('operational_records',`id=eq.${encodeURIComponent(value)}&select=*&limit=1`))?.[0]||null;}
function duplicateTransitionResult(record,status,lifecycle,compatibilityMode=false){return{ok:true,duplicate:true,operationId:record.id,referenceNo:record.reference_no,status,lifecycleStatus:lifecycle,outboxIds:[],...(compatibilityMode?{compatibilityMode:true}:{})};}

async function compatibilityTransition(input,notifications,knownRecord=null){
  const record=knownRecord||(input.operationId?await getOperationById(input.operationId):await getOperationByReference(input.referenceNo));
  if(!record)throw Object.assign(new Error('العملية غير موجودة'),{status:404,code:'OPERATION_NOT_FOUND'});
  const status=clean(input.nextStatus,40)||record.status,lifecycle=clean(input.nextLifecycleStatus,40)||lifecycleForStatus(status);
  if(!input.allowSameStatus&&record.status===status&&(record.lifecycle_status||record.payload?.lifecycle_status||lifecycleForStatus(record.status))===lifecycle)return duplicateTransitionResult(record,status,lifecycle,true);
  const stamp=now(),payload={...(record.payload||{}),...(input.afterData||{}),status,lifecycle_status:lifecycle,status_note:clean(input.note,2000)};
  await patch('operational_records',`id=eq.${encodeURIComponent(record.id)}`,{status,payload,updated_at:stamp,closed_at:terminal.has(lifecycle)?(record.closed_at||stamp):record.closed_at});
  await insert('audit_log',[{actor_type:clean(input.source,30)||'system',actor_id:clean(input.actorId,120)||'system',action:'unified_operation_status',entity_type:record.entity_type,entity_id:record.reference_no,details:{operation_id:record.id,status,lifecycle_status:lifecycle,note:clean(input.note,2000),actor_role:clean(input.actorRole,80)},created_at:stamp}],{prefer:'return=minimal'}).catch(()=>{});
  const outbox=[];
  for(const notification of notifications){const rows=await insert('notification_outbox',[{notification_type:notification.type,recipient_user_id:notification.userId,recipient_chat_id:notification.chatId,title:notification.title,message:notification.message,payload:{...notification.payload,dedupe_key:notification.dedupeKey,operation_id:record.id},status:'pending',scheduled_at:notification.scheduledAt||stamp}]).catch(()=>[]);if(rows?.[0]?.id)outbox.push(rows[0].id);}
  return{ok:true,duplicate:false,operationId:record.id,referenceNo:record.reference_no,status,lifecycleStatus:lifecycle,outboxIds:outbox,compatibilityMode:true};
}

export async function transitionOperation(input={}){
  const operationId=clean(input.operationId,120),referenceNo=clean(input.referenceNo,120),nextStatus=clean(input.nextStatus,40),nextLifecycleStatus=clean(input.nextLifecycleStatus,40),current=operationId?await getOperationById(operationId):referenceNo?await getOperationByReference(referenceNo):null;
  if(current){const targetStatus=nextStatus||current.status,targetLifecycle=nextLifecycleStatus||lifecycleForStatus(targetStatus),currentLifecycle=current.lifecycle_status||current.payload?.lifecycle_status||lifecycleForStatus(current.status);if(!input.allowSameStatus&&current.status===targetStatus&&currentLifecycle===targetLifecycle)return duplicateTransitionResult(current,targetStatus,targetLifecycle);}
  const notifications=normalizeNotifications(input.notifications,`transition:${referenceNo||operationId}:${nextStatus}`),args={p_operation_id:operationId||null,p_reference_no:referenceNo||null,p_next_status:nextStatus||null,p_next_lifecycle_status:nextLifecycleStatus||null,p_actor:{id:clean(input.actorId,120)||null,role:clean(input.actorRole,80)||null,source:clean(input.source,30)||'system',source_reference:clean(input.sourceReference,240)||null},p_note:clean(input.note,2000)||null,p_after_data:input.afterData&&typeof input.afterData==='object'?input.afterData:{},p_notifications:notifications};
  try{return await rpc('transition_unified_operation',args);}
  catch(error){if(!rpcUnavailable(error))throw error;return compatibilityTransition(input,notifications,current);}
}

async function patchOutbox(id,values,fallback){try{return await patch('notification_outbox',`id=eq.${encodeURIComponent(id)}`,values);}catch(error){if(!fallback)throw error;return patch('notification_outbox',`id=eq.${encodeURIComponent(id)}`,fallback);}}
export async function dispatchOperationNotifications(outboxIds=[]){
  const ids=[...new Set((Array.isArray(outboxIds)?outboxIds:[]).map(String).filter(Boolean))];if(!ids.length)return{queued:0,sent:0,failed:0,deadLetter:0};
  const rows=await select('notification_outbox',`id=in.(${ids.map(encodeURIComponent).join(',')})&status=in.(pending,failed,retrying)&select=*&order=created_at.asc&limit=500`).catch(()=>[]),result={queued:rows.length,sent:0,failed:0,deadLetter:0};
  for(const row of rows){
    const attempts=Number(row.attempt_count||row.attempts||0)+1,started=now();await patchOutbox(row.id,{status:'retrying',attempt_count:attempts,attempts,last_attempt_at:started,error_text:null},{status:'processing',attempts,last_attempt_at:started,error_text:null}).catch(()=>{});
    try{const chatId=row.recipient_chat_id||await chatForUser(row.recipient_user_id);if(!chatId)throw new Error('RECIPIENT_CHAT_REQUIRED');const options=row.payload?.telegram_options&&typeof row.payload.telegram_options==='object'?row.payload.telegram_options:{};await sendMessage(chatId,row.message,options);await patchOutbox(row.id,{status:'sent',sent_at:now(),recipient_chat_id:String(chatId),error_text:null},{status:'sent',sent_at:now(),recipient_chat_id:String(chatId),error_text:null});result.sent++;}
    catch(error){const dead=attempts>=5,status=dead?'dead_letter':'failed',message=clean(error?.message||error,1000);await patchOutbox(row.id,{status,error_text:message,next_attempt_at:dead?null:new Date(Date.now()+Math.min(3600000,attempts*300000)).toISOString(),dead_letter_at:dead?now():null,attempt_count:attempts,attempts},{status:dead?'failed':'failed',error_text:message,attempts});if(dead)result.deadLetter++;else result.failed++;}
  }
  return result;
}
