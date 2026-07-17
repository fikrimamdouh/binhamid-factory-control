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
    const [snapshot,database,auditRows,users,documents]=await Promise.all([
      buildManagerSnapshot(day,{persistAlerts:false}),
      collectDatabaseReadiness(),
      safeSelect('audit_log','select=id,actor_type,actor_id,action,entity_type,entity_id,details,created_at&order=created_at.desc&limit=200'),
      safeSelect('app_users','select=id,full_name,role,active,created_at&order=created_at.asc&limit=1000'),
      safeSelect('document_registry','select=id,document_type,title,status,verification_code,created_at&order=created_at.desc&limit=200')
    ]);
    const runtime=readiness();
    const environment=validateEnvironment('runtime');
    const assessment=evaluateControlReadiness({snapshot,database,runtime,environment,auditRows,users});
    json(res,200,{ok:true,day,assessment,database,runtime,environment:{ready:environment.ready,missingRequired:environment.missingRequired},snapshot,audit:{recent:auditRows},users:{active:users.filter(row=>row.active!==false),total:users.length},documents:{recent:documents}});
  }catch(error){errorResponse(res,error);}
}
