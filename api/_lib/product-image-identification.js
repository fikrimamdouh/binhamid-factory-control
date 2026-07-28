import { config } from './config.js';
import { assertResponseComplete, modelUnavailable, reasoningFor, responsesOutputText } from './openai-responses.js';

const outputText=data=>responsesOutputText(data);
const MISSING=/^(?:لا يوجد|غير واضح|غير محدد|غير ظاهر|none|unknown|n\/a|-)$/i;
// نقتطع عند أول فاصل بنيوي (شرطة مائلة، قوس، فاصلة، سطر) ثم عند حد الكلمة.
export function shortPhrase(value='',max=90){
  const head=String(value||'').split(/[\/(\n،,]/)[0].replace(/\s+/g,' ').trim();
  if(head.length<=max)return head;
  const cut=head.slice(0,max),space=cut.lastIndexOf(' ');
  return(space>Math.floor(max*0.5)?cut.slice(0,space):cut).trim();
}
function field(text,name){const value=(text.match(new RegExp(`^${name}:\\s*(.+)$`,'mi'))||[])[1]?.trim()||'';return MISSING.test(value)?'':value;}
function parseVision(text=''){
  const query=field(text,'SEARCH_QUERY');
  const identification=field(text,'IDENTIFICATION')||'قطعة غير محددة';
  const codes=field(text,'READABLE_CODES')||'لا توجد أكواد واضحة';
  const confidence=(text.match(/^CONFIDENCE:\s*(high|medium|low)$/mi)||[])[1]?.toLowerCase()||'low';
  // الماركة ونوع المعدة هما ما يحوّل البحث من «فلتر» إلى «فلتر شيول فولفو» —
  // بدونهما تعود نتائج عامة لا تصلح للشراء.
  return{query,identification,codes,confidence,brand:field(text,'BRAND'),equipment:field(text,'EQUIPMENT'),raw:text};
}
function usefulCodes(value=''){
  const text=String(value||'').trim();
  if(!text||/لا توجد|غير واضح|none|n\/a/i.test(text))return[];
  return [...new Set(text.split(/[,،;|\n]+/).map(x=>x.trim()).filter(x=>x.length>=3))];
}
function weak(result={}){
  const text=`${result.query||''} ${result.identification||''} ${result.codes||''}`;
  return result.confidence==='low'||result.query.length<6||/غير واضح|غير مقروء|غير محدد|الصورة.*غير|unclear|unreadable|unknown/i.test(text)||!usefulCodes(result.codes).length;
}
function score(result={}){
  const confidence={high:30,medium:18,low:5}[result.confidence]||0;
  const codes=Math.min(30,usefulCodes(result.codes).length*10);
  const query=Math.min(25,Math.max(0,result.query.length-5));
  const identification=/غير محدد|unknown/i.test(result.identification||'')?0:15;
  return confidence+codes+query+identification;
}
async function analyze({imageUrl,model,caption,attempt,prior='',timeoutMs=18000}){
  const retry=attempt>1;
  const instructions=retry
    ?`أعد فحص صورة قطعة الغيار بصورة مستقلة ودقيقة. القراءة الأولى كانت ضعيفة، فلا تكرر عبارة «الصورة غير واضحة» لمجرد أن بعض النص صغير. افحص الشعار، شكل القطعة، نقاط التثبيت، ألوان الملصق، التغليف، الأرقام الجزئية، الحروف المعكوسة أو المائلة، والمقاسات. كوّن عبارة بحث مفيدة حتى عند غياب رقم كامل، مستخدمًا وصفًا بصريًا محددًا وأي كود جزئي. لا تخمن رقمًا غير ظاهر. اقرأ الشعار المحفور أو المطبوع لتحديد الماركة (Caterpillar، Volvo، Komatsu، JCB، Hyundai، Doosan، SANY، Shacman، Howo، Scania، MAN، Mercedes، Iveco، Renault، Hino، Isuzu، Fuso، Kamaz، XCMG، Putzmeister، Schwing، Cummins، Perkins، Deutz، Bosch، Donaldson…) واستنتج نوع المعدة إن ظهر (شيول، حفار، خلاطة خرسانة، مضخة خرسانة، قلاب، كسارة، بلدوزر، رافعة). أخرج ست سطور فقط وبنفس العناوين الإنجليزية: SEARCH_QUERY، IDENTIFICATION، BRAND، EQUIPMENT، READABLE_CODES، CONFIDENCE. اكتب «لا يوجد» في الماركة أو المعدة إن لم تظهر، ولا تخمّن.`
    :`أنت خبير قطع غيار ومشتريات صناعية وقراءة ملصقات. افحص الصورة كاملة بدقة عالية، بما في ذلك الشعار، شكل القطعة، نقاط التثبيت، الألوان، التغليف، المقاسات، الأرقام الجزئية، النص المائل أو المعكوس. لا ترفض الصورة لمجرد أن بعض الكتابة صغيرة، ولا تقل «الصورة غير واضحة» إلا إذا لم يظهر أي جسم قابل للوصف. لا تخمن علامة أو رقم قطعة غير ظاهر. كوّن عبارة بحث عربية وإنجليزية قابلة للاستخدام، ولو بالوصف البصري المحدد مع الأكواد الجزئية. اقرأ الشعار المحفور أو المطبوع لتحديد الماركة (Caterpillar، Volvo، Komatsu، JCB، Hyundai، Doosan، SANY، Shacman، Howo، Scania، MAN، Mercedes، Iveco، Renault، Hino، Isuzu، Fuso، Kamaz، XCMG، Putzmeister، Schwing، Cummins، Perkins، Deutz، Bosch، Donaldson…) واستنتج نوع المعدة إن ظهر (شيول، حفار، خلاطة خرسانة، مضخة خرسانة، قلاب، كسارة، بلدوزر، رافعة). أخرج ست سطور فقط: SEARCH_QUERY: أفضل عبارة بحث تجمع الماركة والقطعة ورقمها. IDENTIFICATION: وصف دقيق للقطعة. BRAND: اسم الماركة أو «لا يوجد». EQUIPMENT: نوع المعدة أو «لا يوجد». READABLE_CODES: كل الأكواد والأرقام المقروءة مفصولة بفواصل. CONFIDENCE: high أو medium أو low.`;
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      store:false,
      max_output_tokens:3000,
      ...reasoningFor(model),
      instructions,
      input:[{role:'user',content:[
        {type:'input_text',text:`حلل صورة القطعة للبحث الشرائي. وصف المستخدم: ${String(caption||'لا يوجد').slice(0,300)}${prior?`\nالقراءة السابقة للاستفادة النقدية فقط، لا لتكرارها: ${String(prior).slice(0,1000)}`:''}`},
        {type:'input_image',image_url:imageUrl,detail:'high'}
      ]}]
    }),
    signal:AbortSignal.timeout(timeoutMs)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.error?.message||'تعذر تحليل صورة القطعة.'),{status:Number(response.status)||502,code:'PRODUCT_IMAGE_ANALYSIS_FAILED',model});
  assertResponseComplete(data,{code:'PRODUCT_IMAGE_TRUNCATED',model});
  return parseVision(outputText(data));
}

export const VISION_LIMITS=Object.freeze({totalMs:26000,firstPassMs:18000,secondPassMs:12000,minSecondPassMs:9000});

// نجرب نموذج الرؤية المضبوط ثم نتدرج، فقراءة رقم محفور على ملصق تحتاج نموذجًا أقوى من نموذج النص.
export function visionModelCandidates(){
  const configured=String(config.visionModel||'').trim(),text=String(config.textModel||'').trim();
  const preferred=configured||(text==='gpt-5.4-mini'||!text?'gpt-5.6':text);
  return[...new Set([preferred,text,'gpt-5-mini'].filter(Boolean))].slice(0,3);
}

async function runFirstPass({imageUrl,caption,deadline}){
  let lastError=null;
  for(const model of visionModelCandidates()){
    const remaining=deadline-Date.now();
    if(remaining<6000)break;
    try{return{result:await analyze({imageUrl,model,caption,attempt:1,timeoutMs:Math.min(VISION_LIMITS.firstPassMs,remaining-1000)}),model};}
    catch(error){
      lastError=error;
      console.warn('[product image first pass]',{model,status:Number(error?.status||0),code:String(error?.code||''),message:String(error?.message||'').slice(0,240)});
      if(!modelUnavailable(error))throw error;
    }
  }
  throw lastError||Object.assign(new Error('تعذر تحليل صورة القطعة بالذكاء الاصطناعي.'),{status:502,code:'PRODUCT_IMAGE_ANALYSIS_FAILED'});
}

export async function identifyProductImage(buffer,mimeType='image/jpeg',caption='',{budgetMs=0}={}){
  if(!config.openaiKey)throw Object.assign(new Error('البحث بالصورة غير مفعّل. يلزم ضبط OPENAI_API_KEY في Vercel.'),{status:503,code:'PRODUCT_IMAGE_NOT_CONFIGURED'});
  if(!buffer?.length)throw Object.assign(new Error('الصورة فارغة أو تعذر تنزيلها.'),{status:400,code:'PRODUCT_IMAGE_EMPTY'});
  if(buffer.length>12*1024*1024)throw Object.assign(new Error('حجم صورة القطعة أكبر من الحد المسموح للبحث.'),{status:413,code:'PRODUCT_IMAGE_TOO_LARGE'});
  const safeMime=/^image\/(jpeg|png|webp|gif)$/i.test(String(mimeType||''))?String(mimeType).toLowerCase():'image/jpeg';
  const imageUrl=`data:${safeMime};base64,${Buffer.from(buffer).toString('base64')}`;
  const deadline=Date.now()+Math.max(8000,Math.min(VISION_LIMITS.totalMs,Number(budgetMs)>0?Number(budgetMs):VISION_LIMITS.totalMs));
  const{result:first,model}=await runFirstPass({imageUrl,caption,deadline});
  let best=first,passes=1;
  const secondPassBudget=deadline-Date.now();
  if(weak(first)&&secondPassBudget>=VISION_LIMITS.minSecondPassMs){
    try{
      const second=await analyze({imageUrl,model,caption,attempt:2,prior:first.raw,timeoutMs:Math.min(VISION_LIMITS.secondPassMs,secondPassBudget-1000)});
      passes=2;if(score(second)>score(first))best=second;
    }catch(error){console.warn('[product image second pass]',{model,message:String(error?.message||'').slice(0,240)});}
  }
  const codes=usefulCodes(best.codes).join('، ')||'لا توجد أكواد مؤكدة';
  // النموذج يعيد أحيانًا وصفًا طويلًا بقوائم بين أقواس؛ إدخاله كما هو في محرك البحث
  // ينتج استعلامًا لا يطابق شيئًا. نأخذ المقطع الأول القصير فقط.
  // نضمن حضور الماركة ونوع المعدة داخل عبارة البحث حتى لو أغفلهما النموذج،
  // فهما الفارق بين نتيجة قابلة للشراء ونتيجة عامة.
  let query=shortPhrase(best.query,90);
  const brand=shortPhrase(best.brand,30),equipment=shortPhrase(best.equipment,30);
  const has=value=>value&&query.toLowerCase().includes(value.toLowerCase());
  if(brand&&!has(brand))query=`${brand} ${query}`.trim();
  if(equipment&&!has(equipment))query=`${query} ${equipment}`.trim();
  if(query.length<2){
    const fallback=[shortPhrase(best.identification,60),...usefulCodes(best.codes).slice(0,2),shortPhrase(caption,40)].filter(Boolean).join(' ');
    query=fallback.trim();
  }
  if(query.length<2)throw Object.assign(new Error('لم أستطع تكوين عبارة بحث من الصورة. أرسلها كملف صورة أصلي أو أرفق اسم المعدة.'),{status:422,code:'PRODUCT_IMAGE_QUERY_EMPTY'});
  return{query:shortPhrase(query,120),identification:String(best.identification||'قطعة غير محددة').slice(0,500),brand,equipment,codes:codes.slice(0,400),confidence:best.confidence,analysisPasses:passes,needsMoreDetail:weak(best)};
}
