import { insert, patch, rpc, select, upsert } from './supabase.js';
import { validateWorkshopTransition } from './workshop-state-machine.js';

const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value,80));
const requestId=value=>{const id=clean(value,180);if(!id)throw serviceError('معرف منع التكرار مطلوب',400,'WORKSHOP_REQUEST_ID_REQUIRED');return id;};
const numberOrNull=value=>value===null||value===undefined||value===''?null:Number(value);
const boolValue=(value,fallback=false)=>value===undefined||value===null?fallback:Boolean(value);
function serviceError(message,status=400,code='WORKSHOP_INVALID_REQUEST',extra={}){return Object.assign(new Error(message),{status,code,...extra});}
function first(value){return Array.isArray(value)?value[0]??null:value??null;}
function referenceFrom(value){const row=first(value);return clean(row?.next_document_no??row,100);}
function actorId(identity={}){return clean(identity.appUserId||identity.user_id||identity.userId||identity.actor||identity.id,100)||null;}
function actorRole(identity={}){return clean(identity.role,50)||'pending';}
function sourceChannel(input={}){return clean(input.sourceChannel,30)||'web';}
function encodeFilter(value){return encodeURIComponent(String(value));}

const errorMap={
  WORKSHOP_REQUEST_ID_REQUIRED:['معرف منع التكرار مطلوب',400],
  WORKSHOP_REFERENCE_REQUIRED:['رقم أمر الصيانة مطلوب',400],
  WORKSHOP_PROBLEM_REQUIRED:['وصف العطل مطلوب',400],
  WORKSHOP_PRIORITY_INVALID:['أولوية أمر الصيانة غير صحيحة',400],
  WORKSHOP_ASSET_REQUIRED:['يجب ربط أمر الصيانة بأصل فعلي',400],
  WORKSHOP_ASSET_NOT_FOUND:['الأصل غير موجود أو غير نشط',404],
  WORKSHOP_ORDER_NOT_FOUND:['أمر الصيانة غير موجود',404],
  WORKSHOP_VERSION_CONFLICT:['تم تعديل أمر الصيانة من مستخدم آخر. أعد تحميله',409],
  WORKSHOP_TRANSITION_NOT_ALLOWED:['انتقال حالة أمر الصيانة غير مسموح',409],
  WORKSHOP_APPROVAL_REQUIRED:['اعتماد أمر الصيانة مخصص للمدير',403],
  WORKSHOP_CLOSE_REQUIRED:['إغلاق أمر الصيانة مخصص للمدير',403],
  WORKSHOP_REOPEN_REQUIRED:['إعادة فتح أمر الصيانة تحتاج صلاحية مدير',403],
  WORKSHOP_DIAGNOSIS_REQUIRED:['يجب تسجيل التشخيص أولًا',409],
  WORKSHOP_COST_APPROVAL_REQUIRED:['يجب اعتماد التكلفة قبل بدء الإصلاح',409],
  WORKSHOP_WORK_EVIDENCE_REQUIRED:['يجب تسجيل ساعات أو ملخص تنفيذ قبل الاختبار',409],
  WORKSHOP_SUCCESSFUL_TEST_REQUIRED:['يجب تسجيل اختبار ناجح قبل التسليم أو الإغلاق',409],
  WORKSHOP_HANDOVER_REQUIRED:['يجب تسجيل استلام الأصل قبل الإغلاق',409],
  WORKSHOP_TECHNICIAN_REQUIRED:['الفني المسؤول مطلوب',400],
  WORKSHOP_ASSIGN_PERMISSION_REQUIRED:['ليست لديك صلاحية تعيين الفني',403]
};
function mapServiceError(error){
  const text=String(error?.message||'');
  const code=Object.keys(errorMap).find(key=>text.includes(key));
  if(!code)return error;
  const [message,status]=errorMap[code];
  return Object.assign(new Error(message),{status,code,upstream:error});
}
async function callRpc(name,args){try{return first(await rpc(name,args));}catch(error){throw mapServiceError(error);}}

export async function listWorkshopOrders(filters={}){
  const status=clean(filters.status,40),priority=clean(filters.priority,20),asset=clean(filters.assetExternalId,120),technician=clean(filters.technicianExternalId,120),search=clean(filters.search,120),limit=Math.min(Math.max(Number(filters.limit)||50,1),200);
  const query=['select=*'];
  if(status)query.push(`status=eq.${encodeFilter(status)}`);
  if(priority)query.push(`priority=eq.${encodeFilter(priority)}`);
  if(asset)query.push(`asset_external_id=eq.${encodeFilter(asset)}`);
  if(technician)query.push(`assigned_technician_id=eq.${encodeFilter(technician)}`);
  if(search){const value=encodeFilter(`*${search.replace(/[,*()]/g,' ')}*`);query.push(`or=(reference_no.ilike.${value},plate_snapshot.ilike.${value},problem.ilike.${value})`);}
  query.push('order=reported_at.desc.nullslast,created_at.desc',`limit=${limit}`);
  return await select('maintenance_orders',query.join('&'))||[];
}

export async function getWorkshopOrder(idOrReference){
  const value=clean(idOrReference,120);if(!value)throw serviceError('معرف أمر الصيانة مطلوب',400,'WORKSHOP_ORDER_ID_REQUIRED');
  const filter=uuid(value)?`id=eq.${encodeFilter(value)}`:`reference_no=eq.${encodeFilter(value)}`;
  const rows=await select('maintenance_orders',`${filter}&select=*&limit=1`),order=rows?.[0];
  if(!order)throw serviceError('أمر الصيانة غير موجود',404,'WORKSHOP_ORDER_NOT_FOUND');
  const id=order.id;
  const [history,diagnostics,labor,parts,attachments,projection,cost]=await Promise.all([
    select('maintenance_status_history',`maintenance_id=eq.${encodeFilter(id)}&select=*&order=created_at.asc&limit=500`).catch(()=>[]),
    select('maintenance_diagnostics',`maintenance_id=eq.${encodeFilter(id)}&select=*&order=created_at.desc&limit=100`).catch(()=>[]),
    select('maintenance_labor_entries',`maintenance_id=eq.${encodeFilter(id)}&select=*&order=started_at.desc&limit=500`).catch(()=>[]),
    select('maintenance_parts',`maintenance_id=eq.${encodeFilter(id)}&select=*&order=created_at.desc&limit=500`).catch(()=>[]),
    select('maintenance_attachments',`maintenance_id=eq.${encodeFilter(id)}&select=*&order=created_at.desc&limit=500`).catch(()=>[]),
    select('operational_records',`maintenance_order_id=eq.${encodeFilter(id)}&select=*&limit=1`).catch(()=>[]),
    select('workshop_order_cost_summary',`maintenance_id=eq.${encodeFilter(id)}&select=*&limit=1`).catch(()=>[])
  ]);
  return{...order,history,diagnostics,labor,parts,attachments,operationalRecord:projection?.[0]||null,cost:cost?.[0]||null};
}

export async function createWorkshopOrder(input,identity){
  const assetExternalId=clean(input.assetExternalId,120),problem=clean(input.problem,4000),priority=clean(input.priority,20)||'normal',id=requestId(input.requestId);
  if(!assetExternalId)throw serviceError('يجب اختيار أصل فعلي',400,'WORKSHOP_ASSET_REQUIRED');
  if(!problem)throw serviceError('وصف العطل مطلوب',400,'WORKSHOP_PROBLEM_REQUIRED');
  const existing=(await select('workshop_command_receipts',`command_key=eq.${encodeFilter(id)}&action=eq.create_order&select=result&limit=1`).catch(()=>[]))?.[0];
  if(existing?.result)return{...existing.result,duplicate:true};
  const reference=referenceFrom(await rpc('next_document_no',{p_prefix:'RO'}));
  if(!reference)throw serviceError('تعذر إنشاء رقم أمر الصيانة',502,'WORKSHOP_REFERENCE_FAILED');
  return callRpc('workshop_create_order',{
    p_reference_no:reference,p_asset_external_id:assetExternalId,p_problem:problem,p_priority:priority,
    p_vehicle_stopped:boolValue(input.vehicleStopped,false),p_fault_category:clean(input.faultCategory,120)||null,
    p_actor:actorId(identity),p_actor_role:actorRole(identity),p_source_channel:sourceChannel(input),
    p_source_chat_id:clean(input.sourceChatId,120)||null,p_source_message_id:clean(input.sourceMessageId,120)||null,
    p_request_id:id,p_metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{}
  });
}

async function transitionFacts(order){
  const id=encodeFilter(order.id);
  const [diagnostics,labor]=await Promise.all([
    select('maintenance_diagnostics',`maintenance_id=eq.${id}&select=id&limit=1`).catch(()=>[]),
    select('maintenance_labor_entries',`maintenance_id=eq.${id}&select=id,hours,ended_at&limit=100`).catch(()=>[])
  ]);
  return{
    hasDiagnosis:Boolean(diagnostics?.length),
    hasWorkEvidence:Boolean(labor?.some(row=>Number(row.hours||0)>0||row.ended_at)||clean(order.resolution_summary,10)),
    hasSuccessfulTest:Boolean(order.test_passed),
    handoverAccepted:order.handover_status==='accepted',
    approvalRequired:Boolean(order.approval_required),
    costApproved:Boolean(order.cost_approved_at)
  };
}

export async function transitionWorkshopOrder(input,identity){
  const order=await getWorkshopOrder(input.maintenanceId||input.referenceNo),targetStatus=clean(input.targetStatus,40),id=requestId(input.requestId),patchInput=input.patch&&typeof input.patch==='object'?input.patch:{};
  const facts=await transitionFacts({...order,test_passed:patchInput.testPassed??order.test_passed,handover_status:patchInput.handoverStatus||order.handover_status});
  if(patchInput.testPassed!==undefined)facts.hasSuccessfulTest=Boolean(patchInput.testPassed);
  if(patchInput.handoverStatus!==undefined)facts.handoverAccepted=patchInput.handoverStatus==='accepted';
  validateWorkshopTransition({from:order.status,to:targetStatus,role:actorRole(identity),facts});
  return callRpc('workshop_transition_order',{
    p_maintenance_id:order.id,p_target_status:targetStatus,p_actor:actorId(identity),p_actor_role:actorRole(identity),
    p_source_channel:sourceChannel(input),p_note:clean(input.note,2000)||null,p_reason:clean(input.reason,1000)||null,
    p_request_id:id,p_expected_version:input.expectedVersion===undefined?Number(order.version):Number(input.expectedVersion),p_patch:patchInput
  });
}

export async function assignWorkshopTechnician(input,identity){
  const order=await getWorkshopOrder(input.maintenanceId||input.referenceNo),technician=clean(input.technicianExternalId,120),id=requestId(input.requestId);
  if(!technician)throw serviceError('الفني المسؤول مطلوب',400,'WORKSHOP_TECHNICIAN_REQUIRED');
  return callRpc('workshop_assign_technician',{
    p_maintenance_id:order.id,p_technician_external_id:technician,p_actor:actorId(identity),p_actor_role:actorRole(identity),
    p_request_id:id,p_expected_version:input.expectedVersion===undefined?Number(order.version):Number(input.expectedVersion)
  });
}

export async function addWorkshopDiagnostic(input,identity){
  const order=await getWorkshopOrder(input.maintenanceId||input.referenceNo),diagnosis=clean(input.diagnosis,5000),id=requestId(input.requestId);
  if(!diagnosis)throw serviceError('نص التشخيص مطلوب',400,'WORKSHOP_DIAGNOSIS_REQUIRED');
  const rows=await upsert('maintenance_diagnostics',[{
    maintenance_id:order.id,technician_external_id:clean(input.technicianExternalId,120)||actorId(identity),diagnosis,
    probable_cause:clean(input.probableCause,3000)||null,root_cause:clean(input.rootCause,3000)||null,
    proposed_action:clean(input.proposedAction,4000)||null,needs_parts:boolValue(input.needsParts,false),
    needs_external_repair:boolValue(input.needsExternalRepair,false),risk_level:clean(input.riskLevel,20)||'normal',
    source_channel:sourceChannel(input),created_by:actorId(identity),request_id:id
  }],'request_id');
  const row=rows?.[0];
  if(row&&Number(order.version)>=0)await patch('maintenance_orders',`id=eq.${encodeFilter(order.id)}&version=eq.${Number(order.version)}`,{
    diagnosis,root_cause:clean(input.rootCause,3000)||order.root_cause||null,version:Number(order.version)+1,updated_at:new Date().toISOString()
  });
  await insert('audit_log',[{actor_type:'workshop-service',actor_id:actorId(identity)||'system',action:'maintenance_diagnostic_added',entity_type:'maintenance_order',entity_id:order.id,details:{diagnostic_id:row?.id||null,reference_no:order.reference_no,request_id:id,role:actorRole(identity)}}]);
  return row;
}

export async function addWorkshopLabor(input,identity){
  const order=await getWorkshopOrder(input.maintenanceId||input.referenceNo),id=requestId(input.requestId),startedAt=clean(input.startedAt,50)||new Date().toISOString(),endedAt=clean(input.endedAt,50)||null,hours=Math.max(Number(input.hours)||0,0),cost=Math.max(Number(input.costPerHour)||0,0);
  if(!clean(input.workType,200))throw serviceError('نوع العمل مطلوب',400,'WORKSHOP_WORK_TYPE_REQUIRED');
  const rows=await upsert('maintenance_labor_entries',[{
    maintenance_id:order.id,technician_external_id:clean(input.technicianExternalId,120)||order.assigned_technician_id||actorId(identity),
    work_type:clean(input.workType,200),started_at:startedAt,ended_at:endedAt,hours,cost_per_hour:cost,
    notes:clean(input.notes,3000)||null,source_channel:sourceChannel(input),created_by:actorId(identity),request_id:id
  }],'request_id');
  return rows?.[0]||null;
}

export async function requestWorkshopPart(input,identity){
  const order=await getWorkshopOrder(input.maintenanceId||input.referenceNo),id=requestId(input.requestId),quantity=Math.max(Number(input.quantity)||0,0);
  if(!clean(input.itemName,300))throw serviceError('اسم قطعة الغيار مطلوب',400,'WORKSHOP_PART_NAME_REQUIRED');
  if(quantity<=0)throw serviceError('كمية قطعة الغيار يجب أن تكون أكبر من صفر',400,'WORKSHOP_PART_QUANTITY_REQUIRED');
  const rows=await upsert('maintenance_parts',[{
    maintenance_id:order.id,item_external_id:clean(input.itemExternalId,120)||null,item_code:clean(input.itemCode,120)||null,
    item_name:clean(input.itemName,300),unit:clean(input.unit,50)||null,quantity_requested:quantity,
    urgency:clean(input.urgency,20)||'normal',status:'requested',source_channel:sourceChannel(input),created_by:actorId(identity),request_id:id
  }],'request_id');
  return rows?.[0]||null;
}

export async function getWorkshopAging(filters={}){
  const status=clean(filters.status,40),query=['select=*'];if(status)query.push(`status=eq.${encodeFilter(status)}`);query.push('order=age_hours.desc','limit=500');return select('workshop_order_aging',query.join('&'));
}
export async function getWorkshopReconciliation(filters={}){
  const status=clean(filters.status,30)||'pending',query=[`status=eq.${encodeFilter(status)}`,'select=*','order=created_at.asc','limit=500'];return select('maintenance_reconciliation_queue',query.join('&'));
}

export const workshopServiceInternals={clean,uuid,mapServiceError,numberOrNull,actorId};
