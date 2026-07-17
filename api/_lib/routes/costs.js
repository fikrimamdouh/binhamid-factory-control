import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { approveCostCalculation, getCostReport, getCostSetup, reopenCostCalculation, runCostCalculation } from '../cost-engine.js';

function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);

export async function costs(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){
      await requireCapability(req,'costs.view');
      const p=params(req),action=clean(p.get('action'),40)||'report';
      if(action==='setup')return json(res,200,{ok:true,...await getCostSetup()});
      if(action==='report')return json(res,200,{ok:true,...await getCostReport(clean(p.get('period'),10)||new Date().toISOString().slice(0,7))});
      throw Object.assign(new Error('إجراء التكلفة غير معروف'),{status:400});
    }
    const input=await body(req),action=clean(input.action,40),identity=await requireCapability(req,action==='approve'||action==='reopen'?'costs.approve':'costs.calculate'),actor=identity.appUserId||identity.actor;
    if(action==='calculate')return json(res,200,{ok:true,result:await runCostCalculation(input.period,actor,Boolean(input.dryRun))});
    if(action==='approve')return json(res,200,{ok:true,result:await approveCostCalculation(clean(input.runId,100),actor)});
    if(action==='reopen')return json(res,200,{ok:true,result:await reopenCostCalculation(input.period,actor,clean(input.reason,1000))});
    throw Object.assign(new Error('إجراء التكلفة غير معروف'),{status:400});
  }catch(error){errorResponse(res,error);}
}
