import { select, rpc } from './supabase.js';
import { requiredSelect } from './required-data.js';

const money=value=>{const parsed=Number(value||0);return Number.isFinite(parsed)?parsed:0;};
export function normalizePeriod(value){
  const text=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}(-\d{2})?$/.test(text))throw Object.assign(new Error('صيغة الشهر غير صحيحة'),{status:400});
  const [year,month]=text.split('-');return `${year}-${month}-01`;
}

export function calculateUnitEconomics(rows=[]){
  const output={};
  for(const row of rows){
    const center=String(row.cost_center||row.costCenter||'');if(!center)continue;
    const revenue=money(row.revenue),cost=money(row.actual_cost??row.actualCost),quantity=money(row.sold_quantity??row.quantity),unclassified=money(row.unclassified_cost??row.unclassifiedCost),completeness=money(row.completeness_percent??row.completenessPercent);
    output[center]={
      costCenter:center,revenue,actualCost:cost,quantity,
      unitCost:quantity>0?cost/quantity:null,
      averageSalePrice:quantity>0?revenue/quantity:null,
      grossMargin:revenue-cost,
      marginPerUnit:quantity>0?(revenue-cost)/quantity:null,
      directCost:money(row.direct_cost??row.directCost),
      indirectCost:money(row.indirect_cost??row.indirectCost),
      unclassifiedCost:unclassified,
      completenessPercent:completeness,
      reliable:completeness>=95&&unclassified===0
    };
  }
  return output;
}

export async function getCostReport(periodValue){
  const periodStart=normalizePeriod(periodValue||new Date().toISOString().slice(0,7));
  const [rows,periods,unclassified]=await Promise.all([
    requiredSelect('cost_unit_monthly_report',`period_start=eq.${periodStart}&select=*&order=cost_center.asc`,'تقرير تكلفة الوحدة','COST_UNIT_REPORT_READ_FAILED'),
    requiredSelect('cost_periods',`period_start=eq.${periodStart}&select=*&limit=1`,'فترة التكلفة','COST_PERIOD_READ_FAILED'),
    requiredSelect('cost_ledger',`period_start=eq.${periodStart}&metadata->>unclassified=eq.true&select=id,entry_type,cost_center,source_type,source_reference,amount,quantity,unit,metadata,occurred_at&order=occurred_at.desc&limit=1000`,'التكاليف غير المصنفة','COST_UNCLASSIFIED_READ_FAILED')
  ]);
  const period=periods[0]||null;
  const runs=period?await requiredSelect('cost_calculation_runs',`period_id=eq.${encodeURIComponent(period.id)}&select=*&order=run_no.desc&limit=20`,'تشغيلات حساب التكلفة','COST_RUNS_READ_FAILED'):[];
  const economics=calculateUnitEconomics(rows);
  return{periodStart,period,runs,rows,economics,unclassified,complete:Object.values(economics).length>0&&Object.values(economics).every(item=>item.reliable)};
}

export async function runCostCalculation(periodValue,actor,dryRun=false){
  const periodStart=normalizePeriod(periodValue);
  const result=await rpc('run_cost_period',{p_period_start:periodStart,p_actor:actor,p_dry_run:Boolean(dryRun)});
  return Array.isArray(result)?result[0]:result;
}
export async function approveCostCalculation(runId,actor){
  if(!runId)throw Object.assign(new Error('رقم تشغيل التكلفة مطلوب'),{status:400});
  const result=await rpc('approve_cost_run',{p_run_id:runId,p_actor:actor});return Array.isArray(result)?result[0]:result;
}
export async function reopenCostCalculation(periodValue,actor,reason){
  if(!String(reason||'').trim())throw Object.assign(new Error('سبب إعادة فتح الفترة مطلوب'),{status:400});
  const result=await rpc('reopen_cost_period',{p_period_start:normalizePeriod(periodValue),p_actor:actor,p_reason:String(reason).trim().slice(0,1000)});return Array.isArray(result)?result[0]:result;
}

export async function getCostSetup(){
  const [centers,rules,assets,employees,periods]=await Promise.all([
    requiredSelect('cost_centers','select=*&order=code.asc&limit=100','مراكز التكلفة','COST_CENTERS_READ_FAILED'),
    select('cost_allocation_rules','select=*,source:cost_centers!cost_allocation_rules_source_center_id_fkey(code,name_ar),target:cost_centers!cost_allocation_rules_target_center_id_fkey(code,name_ar)&order=code.asc&limit=500').catch(()=>requiredSelect('cost_allocation_rules','select=*&order=code.asc&limit=500','قواعد توزيع التكلفة','COST_RULES_READ_FAILED')),
    requiredSelect('asset_cost_center_assignments','select=*,cost_centers(code,name_ar)&active=eq.true&order=updated_at.desc&limit=2000','توزيع الأصول على مراكز التكلفة','COST_ASSET_ASSIGNMENTS_READ_FAILED'),
    requiredSelect('employee_cost_assignments','select=*,cost_centers(code,name_ar)&active=eq.true&order=updated_at.desc&limit=3000','توزيع الموظفين على مراكز التكلفة','COST_EMPLOYEE_ASSIGNMENTS_READ_FAILED'),
    requiredSelect('cost_periods','select=*&order=period_start.desc&limit=36','فترات التكلفة','COST_PERIODS_READ_FAILED')
  ]);
  return{centers,rules,assetAssignments:assets,employeeAssignments:employees,periods};
}
