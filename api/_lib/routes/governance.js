import { body,errorResponse,json,method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { insert,patch,rpc,select,upsert } from '../supabase.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const num=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;};
const bool=value=>value===true||value==='true'||value===1||value==='1';
const actorOf=identity=>identity.fullName||identity.appUserId||identity.actor||'system';
const isoDate=value=>{const text=clean(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw Object.assign(new Error('التاريخ يجب أن يكون بصيغة YYYY-MM-DD'),{status:400});return text;};
const required=(value,message,max=1000)=>{const text=clean(value,max);if(!text)throw Object.assign(new Error(message),{status:400});return text;};
async function audit(actor,action,entityType,entityId,details={}){await insert('audit_log',[{actor_type:'web',actor_id:actor,action,entity_type:entityType,entity_id:String(entityId||''),details}],{prefer:'return=minimal'}).catch(()=>{});}

async function overview(){
  const [periods,creditOverrides,creditExposure,assets,assetLinks,documents,custodies,restoreTests,handoverRuns,handoverSignoffs,discrepancies]=await Promise.all([
    select('financial_periods','select=*&order=period_start.desc&limit=120'),
    select('credit_override_requests','select=*&order=requested_at.desc&limit=500'),
    select('control_credit_exposure','select=*&order=over_limit_amount.desc,outstanding_balance.desc&limit=5000'),
    select('unified_assets','select=*&order=active.desc,operational_status,external_id&limit=10000'),
    select('asset_source_links','select=*&order=last_seen_at.desc&limit=5000'),
    select('control_expiring_documents','select=*&order=expiry_date.asc.nullslast&limit=5000'),
    select('control_open_custodies','select=*&order=outstanding_amount.desc&limit=5000'),
    select('restore_test_runs','select=*&order=created_at.desc&limit=200'),
    select('handover_acceptance_runs','select=*&order=started_at.desc&limit=200'),
    select('handover_signoffs','select=*&order=signed_at.desc&limit=800'),
    select('discrepancies','status=in.(open,under_review)&select=id,reference_no,discrepancy_type,severity,title,difference_amount,status,assigned_to,created_at&order=severity.desc,created_at.desc&limit=2000')
  ]);
  const assetStats={total:assets.length,active:assets.filter(row=>row.active).length,unlinked:assets.filter(row=>!assetLinks.some(link=>link.asset_external_id===row.external_id)).length,stopped:assets.filter(row=>['stopped','maintenance','out_of_service'].includes(row.operational_status)).length,dieselExpected:assets.filter(row=>row.diesel_expected===true).length};
  const documentStats={total:documents.length,expired:documents.filter(row=>row.control_status==='expired').length,critical:documents.filter(row=>row.control_status==='critical').length,warning:documents.filter(row=>row.control_status==='warning').length,missingExpiry:documents.filter(row=>row.control_status==='missing_expiry').length};
  const creditStats={outstanding:Number(creditExposure.reduce((sum,row)=>sum+num(row.outstanding_balance),0).toFixed(2)),overLimitCustomers:creditExposure.filter(row=>num(row.over_limit_amount)>0).length,overLimitAmount:Number(creditExposure.reduce((sum,row)=>sum+num(row.over_limit_amount),0).toFixed(2)),pendingOverrides:creditOverrides.filter(row=>row.status==='pending').length};
  const custodyStats={open:custodies.length,outstanding:Number(custodies.reduce((sum,row)=>sum+num(row.outstanding_amount),0).toFixed(2)),pendingTransactions:custodies.reduce((sum,row)=>sum+num(row.pending_transactions),0)};
  return{periods,creditOverrides,creditExposure,assets,assetLinks,documents,custodies,restoreTests,handoverRuns,handoverSignoffs,discrepancies,stats:{assets:assetStats,documents:documentStats,credit:creditStats,custody:custodyStats,openDiscrepancies:discrepancies.length,lastPassedRestore:restoreTests.find(row=>row.status==='passed')||null,lastSignedHandover:handoverRuns.find(row=>row.status==='signed')||null}};
}

async function mutate(req,input){
  const action=required(input.action,'الإجراء مطلوب',80);
  const capability={
    financial_period_close:'financial_period.manage',financial_period_reopen:'financial_period.manage',
    credit_override_request:'credit_override.request',credit_override_decide:'credit_override.approve',
    asset_upsert:'assets.manage',asset_link:'assets.manage',compliance_upsert:'compliance.manage',compliance_verify:'compliance.manage',
    custody_request:'custody.manage',custody_decide:'custody.approve',restore_test_record:'restore_test.manage',
    handover_start:'handover.manage',handover_signoff:'handover.manage'
  }[action];
  if(!capability)throw Object.assign(new Error('إجراء الحوكمة غير معروف'),{status:400});
  const identity=await requireCapability(req,capability),actor=actorOf(identity);

  if(action==='financial_period_close')return{item:await rpc('close_financial_period',{p_period_start:isoDate(input.periodStart),p_period_end:isoDate(input.periodEnd),p_actor:actor,p_reason:required(input.reason,'سبب الإقفال مطلوب')})};
  if(action==='financial_period_reopen')return{item:await rpc('reopen_financial_period',{p_period_id:required(input.id,'معرف الفترة مطلوب',80),p_actor:actor,p_reason:required(input.reason,'سبب إعادة الفتح مطلوب')})};
  if(action==='credit_override_request')return{item:await rpc('request_credit_override',{p_customer_external_id:required(input.customerExternalId,'كود العميل مطلوب',120),p_requested_amount:num(input.requestedAmount),p_reason:required(input.reason,'سبب الاستثناء مطلوب'),p_actor:actor})};
  if(action==='credit_override_decide')return{item:await rpc('decide_credit_override',{p_request_id:required(input.id,'معرف الطلب مطلوب',80),p_decision:input.approve?'approved':'rejected',p_actor:actor,p_note:clean(input.note),p_expires_at:input.approve?(input.expiresAt||null):null})};

  if(action==='asset_upsert'){
    const externalId=required(input.externalId,'معرف الأصل مطلوب',160),assetType=clean(input.assetType,30)||'vehicle',status=clean(input.operationalStatus,40)||'in_service';
    if(!['vehicle','equipment','fixed_asset'].includes(assetType)||!['in_service','parked','stopped','maintenance','out_of_service','sold'].includes(status))throw Object.assign(new Error('نوع الأصل أو حالته غير صحيحة'),{status:400});
    const rows=await upsert('unified_assets',[{external_id:externalId,asset_type:assetType,asset_name:clean(input.assetName,240)||externalId,plate_no:clean(input.plateNo,80)||null,asset_no:clean(input.assetNo,120)||null,serial_no:clean(input.serialNo,160)||null,make:clean(input.make,120)||null,model:clean(input.model,120)||null,operational_status:status,diesel_expected:input.dieselExpected===null||input.dieselExpected===undefined?null:bool(input.dieselExpected),assigned_employee_external_id:clean(input.assignedEmployeeExternalId,160)||null,cost_center_code:clean(input.costCenterCode,80)||null,active:input.active===undefined?true:bool(input.active),metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{},updated_at:new Date().toISOString()}],'external_id');
    await audit(actor,'unified_asset_upserted','unified_asset',externalId,{asset_type:assetType,operational_status:status,plate_no:clean(input.plateNo,80)||null});return{item:rows?.[0]||null};
  }
  if(action==='asset_link'){
    const assetExternalId=required(input.assetExternalId,'معرف الأصل مطلوب',160),sourceSystem=required(input.sourceSystem,'مصدر الأصل مطلوب',80),sourceKey=required(input.sourceKey,'مفتاح المصدر مطلوب',200);
    const rows=await upsert('asset_source_links',[{asset_external_id:assetExternalId,source_system:sourceSystem,source_key:sourceKey,source_payload:input.sourcePayload&&typeof input.sourcePayload==='object'?input.sourcePayload:{},last_seen_at:new Date().toISOString()}],'source_system,source_key');
    await audit(actor,'asset_source_linked','unified_asset',assetExternalId,{source_system:sourceSystem,source_key:sourceKey});return{item:rows?.[0]||null};
  }
  if(action==='compliance_upsert'){
    const values={subject_type:required(input.subjectType,'نوع صاحب المستند مطلوب',30),subject_external_id:required(input.subjectExternalId,'معرف صاحب المستند مطلوب',160),document_type:required(input.documentType,'نوع المستند مطلوب',100),document_no:clean(input.documentNo,160)||null,issue_date:input.issueDate?isoDate(input.issueDate):null,expiry_date:input.expiryDate?isoDate(input.expiryDate):null,storage_path:clean(input.storagePath,500)||null,status:clean(input.status,30)||'valid',active:input.active===undefined?true:bool(input.active),metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{},updated_at:new Date().toISOString()};
    if(!['employee','asset','company'].includes(values.subject_type)||!['valid','expiring','expired','missing','cancelled'].includes(values.status))throw Object.assign(new Error('بيانات المستند غير صحيحة'),{status:400});
    const rows=input.id?await patch('compliance_documents',`id=eq.${encodeURIComponent(input.id)}`,values):await insert('compliance_documents',[values]);
    const item=rows?.[0]||null;await audit(actor,'compliance_document_upserted','compliance_document',item?.id||input.id,{subject_type:values.subject_type,subject_external_id:values.subject_external_id,document_type:values.document_type,expiry_date:values.expiry_date});return{item};
  }
  if(action==='compliance_verify'){
    const id=required(input.id,'معرف المستند مطلوب',80),rows=await patch('compliance_documents',`id=eq.${encodeURIComponent(id)}`,{verified_by:actor,verified_at:new Date().toISOString(),status:clean(input.status,30)||'valid',updated_at:new Date().toISOString()});await audit(actor,'compliance_document_verified','compliance_document',id,{status:clean(input.status,30)||'valid'});return{item:rows?.[0]||null};
  }
  if(action==='custody_request')return{item:await rpc('request_custody_transaction',{p_employee_external_id:required(input.employeeExternalId,'معرف الموظف مطلوب',160),p_transaction_type:required(input.transactionType,'نوع حركة العهدة مطلوب',30),p_amount:num(input.amount),p_description:clean(input.description),p_actor:actor,p_attachment_path:clean(input.attachmentPath,500)||null})};
  if(action==='custody_decide')return{item:await rpc('approve_custody_transaction',{p_transaction_id:required(input.id,'معرف حركة العهدة مطلوب',80),p_actor:actor,p_approve:bool(input.approve),p_note:clean(input.note)})};
  if(action==='restore_test_record'){
    const values={backup_run_id:clean(input.backupRunId,80)||null,environment:required(input.environment,'بيئة الاختبار مطلوبة',80),status:clean(input.status,30)||'planned',checksum_verified:bool(input.checksumVerified),schema_version:num(input.schemaVersion)||null,row_counts:input.rowCounts&&typeof input.rowCounts==='object'?input.rowCounts:{},evidence:input.evidence&&typeof input.evidence==='object'?input.evidence:{},started_by:actor,started_at:input.startedAt||null,completed_at:input.completedAt||null,notes:clean(input.notes)};
    if(values.environment==='production'||!['planned','running','passed','failed','cancelled'].includes(values.status))throw Object.assign(new Error('اختبار الاستعادة يجب أن يكون على بيئة غير إنتاجية'),{status:400});
    const rows=input.id?await patch('restore_test_runs',`id=eq.${encodeURIComponent(input.id)}`,values):await insert('restore_test_runs',[values]);const item=rows?.[0]||null;await audit(actor,'restore_test_recorded','restore_test',item?.id||input.id,{environment:values.environment,status:values.status,checksum_verified:values.checksum_verified,schema_version:values.schema_version});return{item};
  }
  if(action==='handover_start')return{item:await rpc('start_handover_acceptance',{p_version_label:required(input.versionLabel,'رقم نسخة التسليم مطلوب',160),p_actor:actor,p_scope:input.scope&&typeof input.scope==='object'?input.scope:{}})};
  if(action==='handover_signoff')return{item:await rpc('sign_handover_acceptance',{p_run_id:required(input.id,'معرف محضر التسليم مطلوب',80),p_signoff_role:required(input.signoffRole,'صفة الموقع مطلوبة',40),p_signer_name:required(input.signerName,'اسم الموقع مطلوب',200),p_decision:required(input.decision,'قرار التوقيع مطلوب',30),p_note:clean(input.note)})};
  throw Object.assign(new Error('إجراء الحوكمة غير معروف'),{status:400});
}

export async function governance(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){await requireCapability(req,'governance.view');const data=await overview();return json(res,200,{ok:true,...data,generatedAt:new Date().toISOString()});}
    const input=await body(req),result=await mutate(req,input);return json(res,200,{ok:true,...result});
  }catch(error){errorResponse(res,error);}
}
