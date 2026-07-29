import { config } from './config.js';
import { assertResponseComplete, reasoningFor, responsesOutputText, usableModels } from './openai-responses.js';

// البحث كان يُرسل كلام المستخدم حرفيًا إلى Google Places، وهو محرك يطابق أسماء
// المحلات. فـ«عمود الكردان 50 سم» كان يجلب ورش تصليح اسمها كذلك، لا بائعي قطع.
// الحل: نحوّل الطلب إلى فئة تجارية ومرادفات وماركات، ثم نبحث بها.

const clean=(value,max=120)=>String(value??'').trim().slice(0,max);
const uniq=list=>[...new Set((list||[]).map(v=>clean(v)).filter(Boolean))];

// مراكز توريد قطع الغيار الصناعية الحقيقية في السعودية. نجران سوق صغير،
// وأغلب الموردين في هذه المدن ويشحنون.
export const SUPPLY_HUBS=Object.freeze(['الرياض','جدة','الدمام','الخبر','نجران','خميس مشيط']);

// خريطة احتياطية تعمل بلا أي نداء خارجي، حتى لو فشل النموذج أو نفد الوقت.
const CATEGORY_MAP=[
  [/كردان|عمود\s*إدار|بروبلر|propeller|drive\s*shaft/i,['قطع غيار معدات ثقيلة','عمود إدارة كردان'],['drive shaft parts','propeller shaft supplier']],
  [/رمان\s*بلي|رولمان|محمل|محامل|بيرنغ|bearing/i,['محامل ومحمل صناعي','رمان بلي ومحامل'],['industrial bearings supplier','SKF FAG bearings']],
  [/فلتر|فلاتر|filter/i,['فلاتر معدات ومحركات'],['filters supplier heavy equipment']],
  [/سير|حزام|belt/i,['سيور صناعية ونقل حركة'],['industrial belts supplier']],
  [/مضخ|طلمبة|pump/i,['مضخات وقطع غيارها'],['industrial pumps supplier']],
  [/خلاط|حلة\s*الخلاط|mixer/i,['قطع غيار خلاطات خرسانة'],['concrete mixer spare parts']],
  [/هيدروليك|هوز|خرطوم|hydraulic/i,['هيدروليك وخراطيم ضغط'],['hydraulic hoses fittings supplier']],
  [/إطار|اطار|كاوتش|tyre|tire/i,['إطارات معدات ثقيلة'],['heavy equipment tyres supplier']],
  [/بطاري|battery/i,['بطاريات معدات ومركبات'],['industrial batteries supplier']],
  [/زيت|شحم|oil|grease/i,['زيوت وشحوم صناعية'],['industrial lubricants supplier']],
  [/موتور|محرك\s*كهرب|كهرباء|motor/i,['محركات كهربائية وقطعها'],['electric motors supplier']],
  [/قالب|مولد\s*بلوك|block\s*mould/i,['قوالب ومعدات مصانع البلوك'],['block machine moulds supplier']]
];

export const GENERIC_CATEGORIES=Object.freeze(['قطع غيار معدات ثقيلة','مورد قطع غيار صناعية']);

// نحذف المقاسات والأرقام من عبارات البحث عن الأماكن: «50 سم» تضر ولا تفيد
// لأن اسم المحل لا يحتوي مقاسًا. الأرقام تبقى مفيدة لبحث الويب فقط.
export function placeSafeTerm(value=''){
  return clean(String(value||'')
    .replace(/(?:^|\s)\d+\s*(?:سم|مم|مل|انش|إنش|بوصة|cm|mm|inch)(?=\s|$)/gi,' ')
    .replace(/\s+/g,' ').trim(),80);
}

export function fallbackPlan(query=''){
  const text=String(query||'');
  const matched=CATEGORY_MAP.filter(([pattern])=>pattern.test(text));
  const categoriesAr=uniq(matched.flatMap(([,ar])=>ar));
  const categoriesEn=uniq(matched.flatMap(([,,en])=>en));
  return{
    part:placeSafeTerm(text),
    categoriesAr:categoriesAr.length?categoriesAr:[...GENERIC_CATEGORIES],
    categoriesEn,
    brands:[],
    source:'fallback'
  };
}

const PLAN_SCHEMA={
  type:'object',additionalProperties:false,
  required:['part','categories_ar','categories_en','brands'],
  properties:{
    part:{type:'string',description:'اسم القطعة المختصر بلا مقاسات'},
    categories_ar:{type:'array',items:{type:'string'},description:'فئات تجارية عربية يبحث بها عن محلات تبيع هذه القطعة'},
    categories_en:{type:'array',items:{type:'string'}},
    brands:{type:'array',items:{type:'string'}}
  }
};

const INSTRUCTIONS='أنت خبير مشتريات قطع غيار صناعية في السعودية. حوّل طلب المستخدم إلى فئات تجارية يمكن البحث بها عن محلات تبيع القطعة. الفئة تصف نوع النشاط التجاري لا اسم القطعة، مثل «محامل صناعية» أو «قطع غيار معدات ثقيلة». لا تضع مقاسات ولا أرقام قطع في الفئات. اذكر الماركات المعروفة لهذه القطعة إن وُجدت. أعد من فئتين إلى أربع فئات عربية ومثلها إنجليزية.';

export async function buildSupplierSearchPlan(query,{timeoutMs=8000}={}){
  const base=fallbackPlan(query);
  if(!config.openaiKey||!String(query||'').trim())return base;
  const model=usableModels([String(config.textModel||'').trim(),'gpt-5.4-mini','gpt-5-mini'])[0];
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model,instructions:INSTRUCTIONS,input:clean(query,300),store:false,max_output_tokens:1200,
        ...reasoningFor(model,'minimal'),
        text:{format:{type:'json_schema',name:'supplier_search_plan',description:'خطة بحث عن موردي قطعة صناعية',strict:true,schema:PLAN_SCHEMA}}
      }),
      signal:AbortSignal.timeout(timeoutMs)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data?.error?.message||'تعذر بناء خطة البحث'),{status:Number(response.status)||502});
    assertResponseComplete(data,{code:'SUPPLIER_PLAN_TRUNCATED',model});
    const parsed=JSON.parse(responsesOutputText(data));
    const categoriesAr=uniq(parsed.categories_ar);
    return{
      part:placeSafeTerm(parsed.part)||base.part,
      categoriesAr:categoriesAr.length?categoriesAr.slice(0,4):base.categoriesAr,
      categoriesEn:uniq(parsed.categories_en).slice(0,3),
      brands:uniq(parsed.brands).slice(0,3),
      source:'model'
    };
  }catch(error){
    console.warn('[supplier search plan]',{model,message:String(error?.message||'').slice(0,200)});
    return base;
  }
}

// نبني عبارات بحث الأماكن: كل فئة في كل مدينة توريد، بدل استعلام واحد بكلام المستخدم.
export function planPlaceQueries(plan,city='كل السعودية',{maxQueries=18}={}){
  const hubs=city&&city!=='كل السعودية'?[city,...SUPPLY_HUBS.filter(hub=>hub!==city)]:[...SUPPLY_HUBS];
  const terms=uniq([...(plan?.categoriesAr||[]),...(plan?.brands||[]).map(brand=>`${brand} ${plan.part||''}`)]).slice(0,4);
  const safeTerms=terms.length?terms:[...GENERIC_CATEGORIES];
  const queries=[];
  for(const hub of hubs){
    for(const term of safeTerms){
      if(queries.length>=maxQueries)return queries;
      queries.push(`${term} ${hub}`);
    }
  }
  return queries;
}
