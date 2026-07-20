import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSHOP_STATUSES,allowedWorkshopTransitions,isWorkshopStatus,transitionTimestampPatch,
  validateWorkshopTransition,workshopStatusLabel
} from '../api/_lib/workshop-state-machine.js';

const complete={hasDiagnosis:true,hasWorkEvidence:true,hasSuccessfulTest:true,handoverAccepted:true,costApproved:true,approvalRequired:false};

test('workshop lifecycle publishes all official states',()=>{
  assert.equal(WORKSHOP_STATUSES.length,17);
  for(const state of ['draft','reported','diagnosed','in_repair','testing','ready_for_handover','completed','closed','external_repair'])assert.equal(isWorkshopStatus(state),true);
  assert.equal(isWorkshopStatus('done'),false);
  assert.deepEqual(allowedWorkshopTransitions('testing'),['ready_for_handover','in_repair','on_hold']);
});

test('free text cannot skip diagnosis, testing or handover gates',()=>{
  assert.throws(()=>validateWorkshopTransition({from:'inspection',to:'in_repair',role:'mechanic',facts:{}}),error=>error.code==='WORKSHOP_TRANSITION_NOT_ALLOWED');
  assert.throws(()=>validateWorkshopTransition({from:'diagnosed',to:'in_repair',role:'mechanic',facts:{hasDiagnosis:false}}),error=>error.code==='WORKSHOP_TRANSITION_REQUIREMENTS'&&error.requirements.includes('diagnosis'));
  assert.throws(()=>validateWorkshopTransition({from:'in_repair',to:'testing',role:'mechanic',facts:{hasWorkEvidence:false}}),error=>error.requirements.includes('work_evidence'));
  assert.throws(()=>validateWorkshopTransition({from:'testing',to:'ready_for_handover',role:'mechanic',facts:{hasSuccessfulTest:false}}),error=>error.requirements.includes('successful_test'));
  assert.throws(()=>validateWorkshopTransition({from:'completed',to:'closed',role:'manager',facts:{...complete,handoverAccepted:false}}),error=>error.requirements.includes('handover_acceptance'));
});

test('approval, close and reopen remain role guarded',()=>{
  assert.throws(()=>validateWorkshopTransition({from:'approval_pending',to:'approved',role:'mechanic',facts:{hasDiagnosis:true}}),error=>error.code==='WORKSHOP_APPROVAL_REQUIRED');
  assert.doesNotThrow(()=>validateWorkshopTransition({from:'approval_pending',to:'approved',role:'manager',facts:{hasDiagnosis:true}}));
  assert.throws(()=>validateWorkshopTransition({from:'completed',to:'closed',role:'mechanic',facts:complete}),error=>error.code==='WORKSHOP_CLOSE_REQUIRED');
  assert.doesNotThrow(()=>validateWorkshopTransition({from:'completed',to:'closed',role:'manager',facts:complete}));
  assert.throws(()=>validateWorkshopTransition({from:'closed',to:'in_repair',role:'mechanic',facts:{...complete,approvalRequired:false}}),error=>error.code==='WORKSHOP_REOPEN_REQUIRED');
});

test('transition timestamp patches are deterministic',()=>{
  const at='2026-07-20T08:00:00.000Z';
  assert.deepEqual(transitionTimestampPatch('in_repair',at),{started_at:at,downtime_started_at:at});
  assert.deepEqual(transitionTimestampPatch('completed',at),{completed_at:at});
  assert.deepEqual(transitionTimestampPatch('closed',at),{closed_at:at,downtime_ended_at:at});
  assert.equal(workshopStatusLabel('parts_waiting'),'انتظار قطع غيار');
});
