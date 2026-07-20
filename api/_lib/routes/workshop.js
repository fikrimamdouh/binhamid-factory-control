import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import {
  addWorkshopDiagnostic,addWorkshopLabor,assignWorkshopTechnician,createWorkshopOrder,getWorkshopAging,
  getWorkshopOrder,getWorkshopReconciliation,listWorkshopOrders,requestWorkshopPart,transitionWorkshopOrder
} from '../workshop-service.js';

const clean=(value,max=300)=>String(value??'').trim().slice(0,max);
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
function identityActor(identity){return{...identity,actor:identity.appUserId||identity.actor||null};}

export async function workshop(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{
    if(req.method==='GET'){
      const p=params(req),action=clean(p.get('action'),40)||'list';
      await requireCapability(req,action==='reconciliation'?'workshop.manage':'workshop.view');
      if(action==='list')return json(res,200,{ok:true,orders:await listWorkshopOrders({status:p.get('status'),priority:p.get('priority'),assetExternalId:p.get('assetExternalId'),technicianExternalId:p.get('technicianExternalId'),search:p.get('search'),limit:p.get('limit')})});
      if(action==='detail')return json(res,200,{ok:true,order:await getWorkshopOrder(p.get('id')||p.get('referenceNo'))});
      if(action==='aging')return json(res,200,{ok:true,rows:await getWorkshopAging({status:p.get('status')})});
      if(action==='reconciliation')return json(res,200,{ok:true,rows:await getWorkshopReconciliation({status:p.get('status')})});
      throw Object.assign(new Error('إجراء عرض الورشة غير معروف'),{status:400,code:'WORKSHOP_ACTION_UNKNOWN'});
    }

    const input=await body(req),action=clean(input.action,50);
    let identity;
    if(action==='create'){
      identity=identityActor(await requireCapability(req,'workshop.create'));
      return json(res,201,{ok:true,order:await createWorkshopOrder(input,identity)});
    }
    if(action==='transition'){
      const target=clean(input.targetStatus,40),capability=target==='approved'?'workshop.approve':target==='closed'?'workshop.close':'workshop.update';
      identity=identityActor(await requireCapability(req,capability));
      return json(res,200,{ok:true,order:await transitionWorkshopOrder(input,identity)});
    }
    if(action==='assign'){
      identity=identityActor(await requireCapability(req,'workshop.manage'));
      return json(res,200,{ok:true,order:await assignWorkshopTechnician(input,identity)});
    }
    if(action==='diagnostic'){
      identity=identityActor(await requireCapability(req,'workshop.diagnose'));
      return json(res,201,{ok:true,diagnostic:await addWorkshopDiagnostic(input,identity)});
    }
    if(action==='labor'){
      identity=identityActor(await requireCapability(req,'workshop.labor'));
      return json(res,201,{ok:true,labor:await addWorkshopLabor(input,identity)});
    }
    if(action==='part_request'){
      identity=identityActor(await requireCapability(req,'workshop.parts.request'));
      return json(res,201,{ok:true,part:await requestWorkshopPart(input,identity)});
    }
    throw Object.assign(new Error('إجراء الورشة غير معروف'),{status:400,code:'WORKSHOP_ACTION_UNKNOWN'});
  }catch(error){errorResponse(res,error);}
}
