import { body, errorResponse, json, method } from '../http.js';
import { insert, patch, select } from '../supabase.js';
import { requireCapability } from '../permissions.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const compact=value=>clean(value,500).toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g,'');
const now=()=>new Date().toISOString();
const PLATE_FIELDS=['plate','plate_no','plate_number','license_plate','license_plate_no','registration_no','registration_number','vehicle_no','number','code','name','external_id'];
const MAKE_FIELDS=['make','brand','manufacturer','model','type','description','name'];

function values(row,fields){return fields.map(field=>clean(row?.[field],500)).filter(Boolean);}
function matchesTarget(row,targetPlate,targetMake){
  const plates=values(row,PLATE_FIELDS),makes=values(row,MAKE_FIELDS).join(' '),plateMatch=plates.some(value=>compact(value)===targetPlate);
  if(plateMatch)return !targetMake||!makes||compact(makes).includes(targetMake);
  return plates.some(value=>compact(value).startsWith(targetPlate))&&Boolean(targetMake&&compact(makes).includes(targetMake));
}
async function audit(identity,action,entityId,details){
  await insert('audit_log',[{actor_type:'web',actor_id:identity?.fullName||identity?.appUserId||identity?.actor||'system',action,entity_type:'vehicle',entity_id:clean(entityId,200),details}],{prefer:'return=minimal'}).catch(error=>console.error('[permanent cleanup audit]',error));
}
async function deactivateRows(table,rows,values){
  let changed=0;
  for(const row of rows){
    const externalId=clean(row?.external_id,200),id=clean(row?.id,200),filter=externalId?`external_id=eq.${encodeURIComponent(externalId)}`:id?`id=eq.${encodeURIComponent(id)}`:'';
    if(!filter)continue;
    await patch(table,filter,{...values,updated_at:now()});
    changed++;
  }
  return changed;
}
async function deleteVehicleByPlate(input,identity){
  const plate=compact(input.plate),make=compact(input.make);
  if(plate!=='DGD7293')throw Object.assign(new Error('هذه العملية مقيدة باللوحة DGD-7293 فقط.'),{status:400,code:'CLEANUP_TARGET_REJECTED'});
  const [vehicles,assets]=await Promise.all([
    select('vehicles','select=*&limit=2000'),
    select('unified_assets','select=*&limit=2000').catch(error=>{console.error('[permanent cleanup unified_assets read]',error);return[];})
  ]);
  const vehicleMatches=(vehicles||[]).filter(row=>matchesTarget(row,plate,make)),assetMatches=(assets||[]).filter(row=>matchesTarget(row,plate,make));
  const stamp=now(),vehiclesChanged=await deactivateRows('vehicles',vehicleMatches,{active:false,driver_external_id:null}),assetsChanged=await deactivateRows('unified_assets',assetMatches,{active:false,assigned_employee_external_id:null});
  await audit(identity,'vehicle_permanently_removed_from_active_roster','DGD-7293',{plate:'DGD-7293',make:'Renault',vehiclesChanged,assetsChanged,dieselExclusionChanged:false,at:stamp});
  return{plate:'DGD-7293',make:'Renault',vehiclesChanged,assetsChanged,removed:vehiclesChanged+assetsChanged>0,dieselExclusionChanged:false};
}

export async function permanentCleanup(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const identity=await requireCapability(req,'attendance.manage'),input=await body(req),action=clean(input.action,80);
    if(action!=='delete_vehicle_by_plate')throw Object.assign(new Error('إجراء التنظيف غير معروف.'),{status:400,code:'CLEANUP_ACTION_UNKNOWN'});
    return json(res,200,{ok:true,result:await deleteVehicleByPlate(input,identity)});
  }catch(error){errorResponse(res,error);}
}
