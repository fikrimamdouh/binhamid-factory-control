import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { approveCostCalculation, getCostReport, getCostSetup, reopenCostCalculation, runCostCalculation } from '../cost-engine.js';
import { buildCostProfitabilityReport, generateCostProfitabilityPdf } from '../cost-profitability-report.js';

function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
async function requireComprehensiveAccess(req){await requireCapability(req,'costs.view');return requireCapability(req,'costs.customer_profitability.view');}

export async function costs(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){
      const p=params(req),action=clean(p.get('action'),40)||'report',period=clean(p.get('period'),10)||new Date().toISOString().slice(0,7);
      if(action==='comprehensive'){await requireComprehensiveAccess(req);return json(res,200,{ok:true,report:await buildCostProfitabilityReport(period)});}
      await requireCapability(req,'costs.view');
      if(action==='setup')return json(res,200,{ok:true,...await getCostSetup()});
      if(action==='report')return json(res,200,{ok:true,...await getCostReport(period)});
      throw Object.assign(new Error('إجراء التكلفة غير معروف'),{status:400,code:'COST_ACTION_UNKNOWN'});
    }
    const input=await body(req),action=clean(input.action,40);
    if(action==='comprehensive_pdf'){
      await requireComprehensiveAccess(req);const result=await generateCostProfitabilityPdf(clean(input.period,10)||new Date().toISOString().slice(0,7));
      if(!result.pdf)return json(res,200,{ok:true,pdf:false,report:result.report,pdfError:result.pdfError,filename:result.filename});
      res.statusCode=200;res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${result.filename}"`);res.setHeader('Cache-Control','no-store');return res.end(result.buffer);
    }
    const identity=await requireCapability(req,action==='approve'||action==='reopen'?'costs.approve':'costs.calculate'),actor=identity.appUserId||identity.actor;
    if(action==='calculate')return json(res,200,{ok:true,result:await runCostCalculation(input.period,actor,Boolean(input.dryRun))});
    if(action==='approve')return json(res,200,{ok:true,result:await approveCostCalculation(clean(input.runId,100),actor)});
    if(action==='reopen')return json(res,200,{ok:true,result:await reopenCostCalculation(input.period,actor,clean(input.reason,1000))});
    throw Object.assign(new Error('إجراء التكلفة غير معروف'),{status:400,code:'COST_ACTION_UNKNOWN'});
  }catch(error){errorResponse(res,error);}
}
