import { insert, patch, select } from './supabase.js';

const n=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;};
const clean=value=>String(value||'').trim();
const MASS_UNITS=new Set(['kg','ton','bag']);
const VOLUME_UNITS=new Set(['liter','m3']);
function mixError(code,message,details={}){return Object.assign(new Error(message),{code,...details});}
function positive(value,code,label){const amount=Number(value);if(!Number.isFinite(amount)||amount<=0)throw mixError(code,`${label} يجب أن يكون أكبر من صفر`);return amount;}
function bagWeight(material={}){return positive(material.bag_weight_kg??material.bagWeightKg,'MIX_BAG_WEIGHT_REQUIRED',`وزن الكيس للمادة ${material.name_ar||material.code||''}`);}
function density(material={}){return positive(material.density,'MIX_DENSITY_REQUIRED',`كثافة المادة ${material.name_ar||material.code||''}`);}

export function convertMixQuantity(quantity,fromUnit,toUnit,material={}){
  const amount=positive(quantity,'MIX_QUANTITY_INVALID','الكمية'),from=clean(fromUnit),to=clean(toUnit);
  if(from===to)return amount;
  if(!MASS_UNITS.has(from)&&!VOLUME_UNITS.has(from))throw mixError('MIX_UNIT_UNSUPPORTED',`الوحدة غير مدعومة: ${from}`);
  if(!MASS_UNITS.has(to)&&!VOLUME_UNITS.has(to))throw mixError('MIX_UNIT_UNSUPPORTED',`الوحدة غير مدعومة: ${to}`);
  let dimension=MASS_UNITS.has(from)?'mass':'volume',base;
  if(from==='kg')base=amount;
  else if(from==='ton')base=amount*1000;
  else if(from==='bag')base=amount*bagWeight(material);
  else if(from==='liter')base=amount;
  else base=amount*1000;
  const targetDimension=MASS_UNITS.has(to)?'mass':'volume';
  if(dimension!==targetDimension){
    const rho=density(material);
    if(dimension==='volume'){base=(base/1000)*rho;dimension='mass';}
    else{base=(base/rho)*1000;dimension='volume';}
  }
  if(to==='kg')return base;
  if(to==='ton')return base/1000;
  if(to==='bag')return base/bagWeight(material);
  if(to==='liter')return base;
  return base/1000;
}

export function priceBeforeVat(price={}){
  const gross=n(price.price),rate=n(price.vat_rate??price.vatRate??15);
  if(gross<0)throw mixError('MIX_PRICE_INVALID','سعر المادة لا يمكن أن يكون سالبًا');
  if(rate<0||rate>=100)throw mixError('MIX_VAT_RATE_INVALID','نسبة الضريبة غير صحيحة');
  return price.vat_included||price.vatIncluded?gross/(1+rate/100):gross;
}

export function chooseEffectiveMixPrice(prices=[],priceDate){
  const date=String(priceDate||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw mixError('MIX_PRICE_DATE_INVALID','تاريخ الأسعار غير صحيح');
  const matches=(prices||[]).filter(row=>row.approved!==false&&String(row.effective_from||'').slice(0,10)<=date&&(!row.effective_to||String(row.effective_to).slice(0,10)>=date));
  if(!matches.length)throw mixError('MIX_PRICE_MISSING','لا يوجد سعر معتمد ساري للمادة');
  if(matches.length>1)throw mixError('MIX_PRICE_OVERLAP','يوجد أكثر من سعر معتمد ساري للمادة');
  return matches[0];
}

export function calculateMixCost({design={},items=[],overheads=[],targetMarginPercent=0,vatRate=15,priceDate}={}){
  const yieldM3=positive(design.yield_m3??design.yieldM3??1,'MIX_YIELD_INVALID','إنتاجية الخلطة');
  if(!items.length)throw mixError('MIX_ITEMS_REQUIRED','الخلطة لا تحتوي مكونات');
  const targetMargin=n(targetMarginPercent);if(targetMargin<0||targetMargin>=100)throw mixError('MIX_MARGIN_INVALID','هامش الربح يجب أن يكون من صفر إلى أقل من 100%');
  const salesVat=n(vatRate);if(salesVat<0||salesVat>=100)throw mixError('MIX_VAT_RATE_INVALID','نسبة ضريبة البيع غير صحيحة');
  let materialCost=0,wastageCost=0;
  const itemResults=items.map(item=>{
    const material=item.material||item.mix_materials||{},price=item.price;if(!price)throw mixError('MIX_PRICE_MISSING',`لا يوجد سعر للمادة ${material.name_ar||material.code||item.material_id||''}`,{materialId:item.material_id});
    const pricedQuantity=convertMixQuantity(item.quantity,item.unit,price.price_unit,material),unitPrice=priceBeforeVat(price)+n(price.transport_cost)+n(price.handling_cost),baseCost=pricedQuantity*unitPrice,wastagePercent=item.wastage_percent_override??price.wastage_percent??0,wasteRate=n(wastagePercent);
    if(wasteRate<0||wasteRate>100)throw mixError('MIX_WASTAGE_INVALID',`نسبة هالك غير صحيحة للمادة ${material.name_ar||material.code||''}`);
    const waste=baseCost*wasteRate/100;materialCost+=baseCost;wastageCost+=waste;
    return{materialId:item.material_id||material.id,code:material.code||'',name:material.name_ar||material.name_en||material.code||'',inputQuantity:n(item.quantity),inputUnit:item.unit,pricedQuantity,priceUnit:price.price_unit,unitPriceBeforeVat:unitPrice,baseCost,wastagePercent:wasteRate,wastageCost:waste,totalCost:baseCost+waste,priceId:price.id||null};
  });
  const materialWithWaste=materialCost+wastageCost;let overheadCost=0,deliveryCost=0;
  const overheadResults=(overheads||[]).map(row=>{
    const amount=n(row.amount);if(amount<0)throw mixError('MIX_OVERHEAD_INVALID','التكلفة الإضافية لا يمكن أن تكون سالبة');
    let batchCost=0;
    if(row.allocation_basis==='per_m3')batchCost=amount*yieldM3;
    else if(row.allocation_basis==='percentage_material_cost')batchCost=materialWithWaste*amount/100;
    else if(row.allocation_basis==='per_batch'||row.allocation_basis==='fixed')batchCost=amount;
    else throw mixError('MIX_OVERHEAD_BASIS_INVALID',`أساس توزيع غير مدعوم: ${row.allocation_basis}`);
    if(row.cost_type==='delivery')deliveryCost+=batchCost;else overheadCost+=batchCost;
    return{costType:row.cost_type,allocationBasis:row.allocation_basis,amount,batchCost};
  });
  const batchCost=materialWithWaste+overheadCost+deliveryCost,totalCostPerM3=batchCost/yieldM3,recommendedPrice=targetMargin<100?totalCostPerM3/(1-targetMargin/100):null,markupPercent=totalCostPerM3>0?(recommendedPrice-totalCostPerM3)/totalCostPerM3*100:0,vatInclusivePrice=recommendedPrice*(1+salesVat/100);
  return{designId:design.id||null,code:design.code||'',name:design.name||'',versionNo:n(design.version_no??design.versionNo??1),yieldM3,priceDate:String(priceDate||''),materialCost,wastageCost,overheadCost,deliveryCost,batchCost,totalCostPerM3,targetMarginPercent:targetMargin,recommendedPrice,markupPercent,vatRate:salesVat,vatInclusivePrice,items:itemResults,overheads:overheadResults,reliable:true};
}

function idsFilter(values){return [...new Set(values.map(value=>String(value||'')).filter(value=>/^[0-9a-f-]{36}$/i.test(value)))].join(',');}
export async function loadMixCostInput(designId,priceDate){
  const id=String(designId||'');if(!/^[0-9a-f-]{36}$/i.test(id))throw mixError('MIX_DESIGN_ID_INVALID','معرف الخلطة غير صحيح');
  const design=(await select('mix_designs',`id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];if(!design)throw mixError('MIX_DESIGN_NOT_FOUND','الخلطة غير موجودة');
  const [items,overheads]=await Promise.all([
    select('mix_design_items',`mix_design_id=eq.${encodeURIComponent(id)}&select=id,mix_design_id,material_id,quantity,unit,wastage_percent_override,sequence_no,notes,mix_materials(id,code,name_ar,name_en,category,base_unit,density,bag_weight_kg,active)&order=sequence_no.asc`),
    select('mix_design_overheads',`mix_design_id=eq.${encodeURIComponent(id)}&select=*&order=cost_type.asc`)
  ]);
  if(!items?.length)throw mixError('MIX_ITEMS_REQUIRED','الخلطة لا تحتوي مكونات');
  const materialIds=idsFilter(items.map(row=>row.material_id)),prices=materialIds?await select('mix_material_prices',`material_id=in.(${materialIds})&approved=eq.true&select=*&order=effective_from.desc&limit=1000`):[];
  const joined=items.map(item=>{const candidates=(prices||[]).filter(row=>String(row.material_id)===String(item.material_id));return{...item,material:item.mix_materials,price:chooseEffectiveMixPrice(candidates,priceDate)};});
  return{design,items:joined,overheads:overheads||[],priceDate};
}

export async function calculateAndStoreMixCost(designId,actor,{priceDate,targetMarginPercent=0,vatRate=15}={}){
  const input=await loadMixCostInput(designId,priceDate),result=calculateMixCost({...input,targetMarginPercent,vatRate}),snapshot={calculation_version:1,design:input.design,items:result.items,overheads:result.overheads,assumptions:{priceDate,targetMarginPercent,vatRate,yieldM3:result.yieldM3}};
  const row=(await insert('mix_cost_calculation_runs',[{mix_design_id:designId,price_date:priceDate,material_cost:result.materialCost,wastage_cost:result.wastageCost,overhead_cost:result.overheadCost,delivery_cost:result.deliveryCost,total_cost_per_m3:result.totalCostPerM3,recommended_price:result.recommendedPrice,target_margin_percent:result.targetMarginPercent,markup_percent:result.markupPercent,snapshot,actor:String(actor||'system'),status:'calculated'}]))?.[0];
  return{...result,runId:row?.id||null,snapshot};
}

export async function approveMixCostRun(runId,actor){
  const id=String(runId||'');if(!/^[0-9a-f-]{36}$/i.test(id))throw mixError('MIX_RUN_ID_INVALID','معرف حساب الخلطة غير صحيح');
  const run=(await select('mix_cost_calculation_runs',`id=eq.${encodeURIComponent(id)}&status=eq.calculated&select=*&limit=1`))?.[0];if(!run)throw mixError('MIX_RUN_NOT_APPROVABLE','تشغيل التكلفة غير موجود أو معتمد سابقًا');
  await patch('mix_cost_calculation_runs',`mix_design_id=eq.${encodeURIComponent(run.mix_design_id)}&status=eq.approved`,{status:'superseded'});
  const approved=(await patch('mix_cost_calculation_runs',`id=eq.${encodeURIComponent(id)}`,{status:'approved'}))?.[0];
  await patch('mix_designs',`id=eq.${encodeURIComponent(run.mix_design_id)}&status=in.(draft,pending_approval)`,{status:'approved',approved_by:String(actor||'system'),approved_at:new Date().toISOString(),updated_at:new Date().toISOString()});
  return approved;
}

export async function listLatestMixCosts(){return select('mix_design_latest_cost','select=*&order=code.asc,version_no.desc&limit=500').catch(()=>[]);}
