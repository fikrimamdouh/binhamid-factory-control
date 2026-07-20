export const WORKSHOP_STATUSES=Object.freeze([
  'draft','reported','triage','inspection','diagnosed','quotation_required','parts_waiting',
  'approval_pending','approved','in_repair','testing','ready_for_handover','completed',
  'closed','on_hold','cancelled','external_repair'
]);

const STATUS_SET=new Set(WORKSHOP_STATUSES);

export const WORKSHOP_TRANSITIONS=Object.freeze({
  draft:['reported','cancelled'],
  reported:['triage','inspection','on_hold','cancelled'],
  triage:['inspection','on_hold','cancelled'],
  inspection:['diagnosed','quotation_required','on_hold','cancelled'],
  diagnosed:['quotation_required','approval_pending','approved','in_repair','external_repair','on_hold','cancelled'],
  quotation_required:['parts_waiting','approval_pending','approved','on_hold','cancelled'],
  parts_waiting:['approval_pending','approved','in_repair','on_hold','cancelled'],
  approval_pending:['approved','on_hold','cancelled'],
  approved:['in_repair','external_repair','on_hold','cancelled'],
  in_repair:['testing','parts_waiting','on_hold','cancelled'],
  external_repair:['testing','parts_waiting','on_hold','cancelled'],
  testing:['ready_for_handover','in_repair','on_hold'],
  ready_for_handover:['completed','in_repair','on_hold'],
  completed:['closed','in_repair'],
  closed:['in_repair'],
  on_hold:['triage','inspection','diagnosed','quotation_required','parts_waiting','approval_pending','approved','in_repair','external_repair','cancelled'],
  cancelled:[]
});

const APPROVAL_ROLES=new Set(['admin','manager']);
const CLOSE_ROLES=new Set(['admin','manager']);
const REOPEN_ROLES=new Set(['admin','manager']);

function stateError(message,code,extra={}){return Object.assign(new Error(message),{status:409,code,...extra});}
function permissionError(message,code,extra={}){return Object.assign(new Error(message),{status:403,code,...extra});}
export function isWorkshopStatus(value){return STATUS_SET.has(String(value||''));}
export function allowedWorkshopTransitions(status){return[...(WORKSHOP_TRANSITIONS[String(status||'')]||[])];}

export function validateWorkshopTransition({from,to,role='pending',facts={}}){
  const current=String(from||''),next=String(to||''),actorRole=String(role||'pending');
  if(!isWorkshopStatus(current))throw stateError('حالة أمر الصيانة الحالية غير معروفة','WORKSHOP_STATUS_UNKNOWN',{status:current});
  if(!isWorkshopStatus(next))throw stateError('حالة أمر الصيانة المطلوبة غير معروفة','WORKSHOP_TARGET_STATUS_UNKNOWN',{status:next});
  if(current===next)return{allowed:true,noChange:true,requirements:[]};
  if(!allowedWorkshopTransitions(current).includes(next))throw stateError(`الانتقال من ${current} إلى ${next} غير مسموح`,'WORKSHOP_TRANSITION_NOT_ALLOWED',{from:current,to:next});
  if(next==='approved'&&!APPROVAL_ROLES.has(actorRole))throw permissionError('اعتماد أمر الصيانة مخصص للمدير','WORKSHOP_APPROVAL_REQUIRED',{role:actorRole});
  if(next==='closed'&&!CLOSE_ROLES.has(actorRole))throw permissionError('إغلاق أمر الصيانة مخصص للمشرف أو المدير','WORKSHOP_CLOSE_REQUIRED',{role:actorRole});
  if(current==='closed'&&next==='in_repair'&&!REOPEN_ROLES.has(actorRole))throw permissionError('إعادة فتح أمر مغلق تحتاج صلاحية مدير','WORKSHOP_REOPEN_REQUIRED',{role:actorRole});

  const requirements=[];
  if(['diagnosed','quotation_required','approval_pending','approved','in_repair','external_repair'].includes(next)&&!facts.hasDiagnosis)requirements.push('diagnosis');
  if(next==='testing'&&!facts.hasWorkEvidence)requirements.push('work_evidence');
  if(['ready_for_handover','completed','closed'].includes(next)&&!facts.hasSuccessfulTest)requirements.push('successful_test');
  if(next==='closed'&&!facts.handoverAccepted)requirements.push('handover_acceptance');
  if(next==='in_repair'&&facts.approvalRequired&&!facts.costApproved)requirements.push('cost_approval');
  if(requirements.length)throw stateError('بيانات أمر الصيانة غير مكتملة لهذا الانتقال','WORKSHOP_TRANSITION_REQUIREMENTS',{from:current,to:next,requirements});
  return{allowed:true,noChange:false,requirements:[]};
}

export function transitionTimestampPatch(status,at=new Date().toISOString()){
  const next=String(status||'');
  if(next==='in_repair')return{started_at:at,downtime_started_at:at};
  if(next==='completed')return{completed_at:at};
  if(next==='closed')return{closed_at:at,downtime_ended_at:at};
  if(next==='cancelled')return{cancelled_at:at};
  return{};
}

export function workshopStatusLabel(status){
  return({
    draft:'مسودة',reported:'تم الإبلاغ',triage:'فرز أولي',inspection:'قيد الفحص',diagnosed:'تم التشخيص',
    quotation_required:'يحتاج تسعيرًا',parts_waiting:'انتظار قطع غيار',approval_pending:'بانتظار الاعتماد',
    approved:'معتمد',in_repair:'قيد الإصلاح',testing:'قيد الاختبار',ready_for_handover:'جاهز للتسليم',
    completed:'مكتمل',closed:'مغلق',on_hold:'معلّق',cancelled:'ملغي',external_repair:'إصلاح خارجي'
  })[String(status||'')]||String(status||'غير معروف');
}
