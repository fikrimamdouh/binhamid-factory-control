import { errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { buildManagerSnapshot } from '../manager-metrics.js';
import { collectDatabaseReadiness } from './system-runtime.js';
import { readiness, validateEnvironment } from '../config.js';
import { select } from '../supabase.js';
import { evaluateControlReadiness } from '../control-readiness.js';

const safeSelect=async(table,query)=>{try{return await select(table,query)||[];}catch{return[];}};
const dayFrom=req=>{const day=new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams.get('day')||'';return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:new Date().toISOString().slice(0,10);};

export async function controlCenter(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'audit.view');
    const day=dayFrom(req);
    const [snapshot,database,auditRows,users,documents,assets,assetLinks,assetDuplicates,complianceDocuments,restoreTests,handoverRuns,discrepancies,custodies]=await Promise.all([
      buildManagerSnapshot(day,{persistAlerts:false}),
      collectDatabaseReadiness(),
      safeSelect('audit_log','select=id,actor_type,actor_id,action,entity_type,entity_id,details,created_at&order=created_at.desc&limit=200'),
      safeSelect('app_users','select=id,full_name,role,active,created_at&order=created_at.asc&limit=1000'),
      safeSelect('document_registry','select=id,document_type,title,status,verification_code,created_at&order=created_at.desc&limit=200'),
      safeSelect('unified_assets','active=eq.true&select=external_id,asset_type,plate_no,operational_status,diesel_expected,assigned_employee_external_id&limit=10000'),
      safeSelect('asset_source_links','select=asset_external_id,source_system,source_key,last_seen_at&limit=10000'),
      safeSelect('control_asset_duplicates','select=normalized_plate,asset_count,asset_external_ids&limit=1000'),
      safeSelect('control_expiring_documents','select=id,subject_type,subject_external_id,document_type,expiry_date,days_to_expiry,control_status&limit=10000'),
      safeSelect('restore_test_runs','status=eq.passed&select=id,environment,status,checksum_verified,schema_version,completed_at,created_at&order=completed_at.desc.nullslast,created_at.desc&limit=20'),
      safeSelect('handover_acceptance_runs','status=eq.signed&select=id,reference_no,version_label,status,completed_at,created_at&order=completed_at.desc.nullslast,created_at.desc&limit=20'),
      safeSelect('discrepancies','status=in.(open,under_review)&select=id,reference_no,discrepancy_type,severity,title,difference_amount,status,created_at&order=severity.desc,created_at.desc&limit=2000'),
      safeSelect('control_open_custodies','select=id,employee_external_id,outstanding_amount,pending_transactions,last_transaction_at&limit=5000')
    ]);
    const linked=new Set(assetLinks.map(row=>String(row.asset_external_id||''))),unlinkedAssets=assets.filter(row=>!linked.has(String(row.external_id||''))).length;
    const governance={
      unlinkedAssets,
      assetDuplicates,
      documents:{total:complianceDocuments.length,expired:complianceDocuments.filter(row=>row.control_status==='expired').length,critical:complianceDocuments.filter(row=>row.control_status==='critical').length,warning:complianceDocuments.filter(row=>row.control_status==='warning').length,missingExpiry:complianceDocuments.filter(row=>row.control_status==='missing_expiry').length},
      lastPassedRestore:restoreTests[0]||null,
      lastSignedHandover:handoverRuns[0]||null,
      discrepancies,
      pendingCustodyTransactions:custodies.reduce((total,row)=>total+Number(row.pending_transactions||0),0),
      custodyOutstanding:Number(custodies.reduce((total,row)=>total+Number(row.outstanding_amount||0),0).toFixed(2))
    };
    const runtime=readiness();
    const environment=validateEnvironment('runtime');
    const assessment=evaluateControlReadiness({snapshot,database,runtime,environment,auditRows,users,governance});
    json(res,200,{ok:true,day,assessment,database,runtime,environment:{ready:environment.ready,missingRequired:environment.missingRequired},snapshot,governance,audit:{recent:auditRows},users:{active:users.filter(row=>row.active!==false),total:users.length},documents:{recent:documents}});
  }catch(error){errorResponse(res,error);}
}
