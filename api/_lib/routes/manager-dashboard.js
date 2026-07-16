import { errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { buildManagerSnapshot } from '../manager-metrics.js';

function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}

export async function dashboard(req,res){
  if(!method(req,res,['GET']))return;
  try{
    await requireCapability(req,'dashboard.manager');
    const p=params(req),day=String(p.get('day')||new Date().toISOString().slice(0,10)).slice(0,10),persist=p.get('persistAlerts')!=='false';
    const snapshot=await buildManagerSnapshot(day,{persistAlerts:persist});
    json(res,200,{ok:true,snapshot,lastUpdated:snapshot.generatedAt});
  }catch(error){errorResponse(res,error);}
}
