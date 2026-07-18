import { body, errorResponse, json, method } from '../http.js';
import { requireCapability } from '../permissions.js';
import { calculateAndStoreMixCost, listLatestMixCosts, loadMixCostInput } from '../mix-design-costing.js';
import { insert, patch, rpc, select } from '../supabase.js';

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const uuid=value=>{const id=clean(value,40);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw Object.assign(new Error('المعرف غير صحيح'),{status:400,code:'ID_INVALID'});return id;};
const number=(value,{min=0,max=Number.MAX_SAFE_INTEGER,required=true}={})=>{if((value===null||value===undefined||value==='')&&!required)return null;const parsed=Number(value);if(!Number.isFinite(parsed)||parsed<min||parsed>max)throw Object.assign(new Error('القيمة الرقمية غير صحيحة'),{status:400,code:'NUMBER_INVALID'});return parsed;};
const allowed=(value,values,label='القيمة')=>{const result=clean(value,80);if(!values.includes(result))throw Object.assign(new Error(`${label} غير صحيحة`),{status:400,code:'ENUM_INVALID'});return result;};
function params(req){return new URL(req.url||'/api/router',`https://${String(req.headers.host||'localhost')}`).searchParams;}
async function draftDesign(id){const row=(await select('mix_designs',`id=eq.${encodeURIComponent(id)}&select=id,status,code,version_no&limit=1`))?.[0];if(!row)throw Object.assign(new Error('الخلطة غير موجودة'),{status:404,code:'MIX_DESIGN_NOT_FOUND'});if(row.status!=='draft')throw Object.assign(new Error('لا يمكن تعديل خلطة غير مسودة؛ أنشئ إصدارًا جديدًا'),{status:409,code:'MIX_DESIGN_VERSION_REQUIRED'});return row;}
const materialFields=input=>({code:clean(input.code,60),name_ar:clean(input.nameAr??input.name_ar,160),name_en:clean(input.nameEn??input.name_en,160)||null,category:allowed(input.category,['cement','sand','aggregate','water','admixture','fly_ash','silica','ice','other'],'تصنيف المادة'),base_unit:allowed(input.baseUnit??input.base_unit,['kg','ton','liter','m3','bag'],'وحدة المادة'),density:number(input.density,{min:0.000001,required:false}),bag_weight_kg:number(input.bagWeightKg??input.bag_weight_kg,{min:0.000001,required:false}),active:input.active!==false,updated_at:new Date().toISOString()});

async function getRoute(req,res){
  const p=params(req),action=clean(p.get('action'),40)||'summary';
  if(action==='summary'){
    await requireCapability(req,'mix_design.view');
    const [materials,designs,latestCosts]=await Promise.all([select('mix_materials','select=*&order=code.asc&limit=1000'),select('mix_designs','select=*&order=code.asc,version_no.desc&limit=1000'),listLatestMixCosts()]);
    return json(res,200,{ok:true,materials,designs,latestCosts});
  }
  if(action==='materials'){await requireCapability(req,'mix_design.view');return json(res,200,{ok:true,materials:await select('mix_materials','select=*&order=code.asc&limit=1000')});}
  if(action==='prices'){
    await requireCapability(req,'mix_design.view');const materialId=uuid(p.get('materialId'));
    return json(res,200,{ok:true,prices:await select('mix_material_prices',`material_id=eq.${encodeURIComponent(materialId)}&select=*&order=effective_from.desc&limit=500`)});
  }
  if(action==='designs'){await requireCapability(req,'mix_design.view');return json(res,200,{ok:true,designs:await select('mix_designs','select=*&order=code.asc,version_no.desc&limit=1000')});}
  if(action==='design'){
    await requireCapability(req,'mix_design.view');const id=uuid(p.get('id'));
    const [design,items,overheads,runs]=await Promise.all([select('mix_designs',`id=eq.${encodeURIComponent(id)}&select=*&limit=1`),select('mix_design_items',`mix_design_id=eq.${encodeURIComponent(id)}&select=*,mix_materials(id,code,name_ar,name_en,category,base_unit,density,bag_weight_kg)&order=sequence_no.asc`),select('mix_design_overheads',`mix_design_id=eq.${encodeURIComponent(id)}&select=*&order=cost_type.asc`),select('mix_cost_calculation_runs',`mix_design_id=eq.${encodeURIComponent(id)}&select=*&order=calculated_at.desc&limit=50`)]);
    if(!design?.[0])throw Object.assign(new Error('الخلطة غير موجودة'),{status:404,code:'MIX_DESIGN_NOT_FOUND'});return json(res,200,{ok:true,design:design[0],items,overheads,runs});
  }
  if(action==='calculation_preview'){
    await requireCapability(req,'mix_design.calculate');const id=uuid(p.get('id')),priceDate=clean(p.get('priceDate'),10);return json(res,200,{ok:true,input:await loadMixCostInput(id,priceDate)});
  }
  throw Object.assign(new Error('إجراء تكلفة الخلطة غير معروف'),{status:400,code:'MIX_ACTION_UNKNOWN'});
}

async function postRoute(req,res){
  const input=await body(req,1_000_000),action=clean(input.action,50);
  if(action==='material_create'){
    const identity=await requireCapability(req,'mix_design.manage'),values=materialFields(input);if(!values.code||!values.name_ar)throw Object.assign(new Error('كود واسم المادة مطلوبان'),{status:400,code:'MIX_MATERIAL_REQUIRED'});
    const row=(await insert('mix_materials',[{...values,created_at:new Date().toISOString()}]))?.[0];return json(res,201,{ok:true,material:row,actor:identity.appUserId});
  }
  if(action==='material_update'){
    const identity=await requireCapability(req,'mix_design.manage'),id=uuid(input.id),rows=await patch('mix_materials',`id=eq.${encodeURIComponent(id)}`,materialFields(input));if(!rows?.length)throw Object.assign(new Error('المادة غير موجودة'),{status:404,code:'MIX_MATERIAL_NOT_FOUND'});return json(res,200,{ok:true,material:rows[0],actor:identity.appUserId});
  }
  if(action==='price_create'){
    const identity=await requireCapability(req,'mix_material_prices.manage'),materialId=uuid(input.materialId),values={material_id:materialId,supplier_id:clean(input.supplierId,120)||null,price:number(input.price),price_unit:allowed(input.priceUnit,['kg','ton','liter','m3','bag'],'وحدة السعر'),effective_from:clean(input.effectiveFrom,10),effective_to:clean(input.effectiveTo,10)||null,transport_cost:number(input.transportCost??0),handling_cost:number(input.handlingCost??0),wastage_percent:number(input.wastagePercent??0,{min:0,max:100}),vat_included:Boolean(input.vatIncluded),vat_rate:number(input.vatRate??15,{min:0,max:100}),currency:clean(input.currency,8)||'SAR',source_reference:clean(input.sourceReference,240)||null,approved:false};
    if(!/^\d{4}-\d{2}-\d{2}$/.test(values.effective_from))throw Object.assign(new Error('تاريخ بداية السعر مطلوب'),{status:400,code:'PRICE_DATE_REQUIRED'});
    const row=(await insert('mix_material_prices',[values]))?.[0];return json(res,201,{ok:true,price:row,actor:identity.appUserId});
  }
  if(action==='price_approve'){
    const identity=await requireCapability(req,'mix_material_prices.manage'),id=uuid(input.id),rows=await patch('mix_material_prices',`id=eq.${encodeURIComponent(id)}`,{approved:true,approved_by:identity.appUserId||identity.actor,approved_at:new Date().toISOString()});if(!rows?.length)throw Object.assign(new Error('السعر غير موجود'),{status:404,code:'MIX_PRICE_NOT_FOUND'});return json(res,200,{ok:true,price:rows[0]});
  }
  if(action==='design_create'){
    const identity=await requireCapability(req,'mix_design.manage'),code=clean(input.code,60),name=clean(input.name,160);if(!code||!name)throw Object.assign(new Error('كود واسم الخلطة مطلوبان'),{status:400,code:'MIX_DESIGN_REQUIRED'});
    const existing=await select('mix_designs',`code=eq.${encodeURIComponent(code)}&select=version_no&order=version_no.desc&limit=1`),version=(existing?.[0]?.version_no||0)+1,row=(await insert('mix_designs',[{code,name,product_type:allowed(input.productType??'concrete',['concrete','block','other'],'نوع المنتج'),strength_class:clean(input.strengthClass,80)||null,unit:allowed(input.unit??'m3',['m3','unit','batch'],'وحدة الخلطة'),yield_m3:number(input.yieldM3??1,{min:0.000001}),version_no:version,status:'draft',notes:clean(input.notes,2000)||null,created_by:identity.appUserId||identity.actor}]))?.[0];return json(res,201,{ok:true,design:row});
  }
  if(action==='design_clone'){
    const identity=await requireCapability(req,'mix_design.manage'),result=await rpc('clone_mix_design_version',{p_design_id:uuid(input.id),p_actor:identity.appUserId||identity.actor});return json(res,201,{ok:true,result:Array.isArray(result)?result[0]:result});
  }
  if(action==='design_archive'){
    const identity=await requireCapability(req,'mix_design.manage'),id=uuid(input.id),rows=await patch('mix_designs',`id=eq.${encodeURIComponent(id)}`,{status:'archived',updated_at:new Date().toISOString()});if(!rows?.length)throw Object.assign(new Error('الخلطة غير موجودة'),{status:404,code:'MIX_DESIGN_NOT_FOUND'});return json(res,200,{ok:true,design:rows[0],actor:identity.appUserId});
  }
  if(action==='item_upsert'){
    const identity=await requireCapability(req,'mix_design.manage'),designId=uuid(input.designId);await draftDesign(designId);const values={mix_design_id:designId,material_id:uuid(input.materialId),quantity:number(input.quantity,{min:0.000001}),unit:allowed(input.unit,['kg','ton','liter','m3','bag'],'وحدة المكون'),wastage_percent_override:number(input.wastagePercentOverride,{min:0,max:100,required:false}),sequence_no:number(input.sequenceNo??1,{min:1,max:10000}),notes:clean(input.notes,1000)||null};let row;if(input.id){const rows=await patch('mix_design_items',`id=eq.${encodeURIComponent(uuid(input.id))}&mix_design_id=eq.${encodeURIComponent(designId)}`,values);row=rows?.[0];}else row=(await insert('mix_design_items',[values]))?.[0];if(!row)throw Object.assign(new Error('تعذر حفظ مكون الخلطة'),{status:409,code:'MIX_ITEM_SAVE_FAILED'});return json(res,200,{ok:true,item:row,actor:identity.appUserId});
  }
  if(action==='overhead_upsert'){
    const identity=await requireCapability(req,'mix_design.manage'),designId=uuid(input.designId);await draftDesign(designId);const values={mix_design_id:designId,cost_type:allowed(input.costType,['production_labor','batching_energy','loader','pump','quality_testing','depreciation','maintenance','delivery','other'],'نوع التكلفة'),amount:number(input.amount),allocation_basis:allowed(input.allocationBasis,['per_m3','per_batch','percentage_material_cost','fixed'],'أساس التوزيع'),notes:clean(input.notes,1000)||null};let row;if(input.id){const rows=await patch('mix_design_overheads',`id=eq.${encodeURIComponent(uuid(input.id))}&mix_design_id=eq.${encodeURIComponent(designId)}`,values);row=rows?.[0];}else row=(await insert('mix_design_overheads',[values]))?.[0];if(!row)throw Object.assign(new Error('تعذر حفظ تكلفة الخلطة'),{status:409,code:'MIX_OVERHEAD_SAVE_FAILED'});return json(res,200,{ok:true,overhead:row,actor:identity.appUserId});
  }
  if(action==='calculate'){
    const identity=await requireCapability(req,'mix_design.calculate'),result=await calculateAndStoreMixCost(uuid(input.designId),identity.appUserId||identity.actor,{priceDate:clean(input.priceDate,10),targetMarginPercent:number(input.targetMarginPercent??0,{min:0,max:99.999}),vatRate:number(input.vatRate??15,{min:0,max:100})});return json(res,200,{ok:true,result});
  }
  if(action==='approve'){
    const identity=await requireCapability(req,'mix_design.approve'),result=await rpc('approve_mix_cost_run',{p_run_id:uuid(input.runId),p_actor:identity.appUserId||identity.actor});return json(res,200,{ok:true,result:Array.isArray(result)?result[0]:result});
  }
  throw Object.assign(new Error('إجراء تكلفة الخلطة غير معروف'),{status:400,code:'MIX_ACTION_UNKNOWN'});
}

export async function mixDesigns(req,res){
  if(!method(req,res,['GET','POST']))return;
  try{return req.method==='GET'?await getRoute(req,res):await postRoute(req,res);}catch(error){return errorResponse(res,error);}
}
