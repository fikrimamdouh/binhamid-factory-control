// بديل مجاني لبحث أسعار السوق: Gemini بطبقته المجانية مع أداة بحث Google.
// يُستخدم تلقائيًا عند ضبط GEMINI_API_KEY، فلا يتوقف البحث على مفتاح OpenAI المدفوع.
// يُخرج نفس عقد المحرك المدفوع (text/priceLevel) حتى يبقى العرض في البوت كما هو.
import { config } from './config.js';
import { buildFastPriceLevel } from './product-market-research-fast.js';

const MODELS=['gemini-2.5-flash','gemini-2.0-flash'];
const ENDPOINT=model=>`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const money=value=>Number(value||0).toLocaleString('en-US',{maximumFractionDigits:2});
const num=value=>{const parsed=Number(String(value??'').replace(/[^\d.]/g,''));return Number.isFinite(parsed)?parsed:0;};

export function validateFreeQuery(query){
  const text=String(query||'').trim();
  if(text.length<2)throw Object.assign(new Error('اكتب اسم القطعة أو رقمها بوضوح.'),{status:400,code:'PRODUCT_QUERY_TOO_SHORT'});
  return text.slice(0,240);
}

// النموذج يُطالَب بـJSON صرف: النص الحر يجعل استخراج الأرقام هشًا.
function buildPrompt(product,city){
  return`أنت مساعد مشتريات لمصنع خرسانة وبلوك في ${city} بالسعودية. ابحث عن سعر السوق الحالي لهذه القطعة:
"${product}"

ابحث في المتاجر والموردين المنشورين، وركّز على السعودية ثم الخليج. أعد JSON فقط بلا أي نص خارجه وبهذا الشكل:
{"identification":"وصف دقيق للقطعة","offers":[{"seller":"اسم البائع","location":"المدينة أو الدولة","price_sar":رقم بالريال,"unit_basis":"للقطعة أو للعبوة"}],"specs":["مواصفة"],"note":"ملاحظة قصيرة"}

قواعد ملزمة: أدرج فقط أسعارًا رأيتها فعلًا ولا تخترع رقمًا. حوّل كل سعر إلى الريال السعودي في price_sar. لا تضع روابط ولا عناوين مواقع في أي حقل. إن لم تجد سعرًا منشورًا أعد offers فارغة.`;
}

function parseJson(text=''){
  const match=String(text).match(/\{[\s\S]*\}/);
  if(!match)return null;
  try{return JSON.parse(match[0]);}catch{return null;}
}

function renderFree(parsed,offers,level){
  const lines=[];
  if(level.available){
    const band=level.overall;
    lines.push(`السعر المعتاد: نحو ${money(band.typical)} ر.س`,`معظم الأسعار: ${money(band.typicalLow)} – ${money(band.typicalHigh)} ر.س`,`عدد الأسعار المرصودة: ${band.sampleCount}`);
  }else lines.push('لم يظهر سعر منشور كافٍ؛ يلزم طلب عرض سعر مباشر.');
  if(parsed?.identification)lines.push(`تعريف الصنف: ${parsed.identification}`);
  if(parsed?.specs?.length)lines.push(`المواصفات: ${parsed.specs.slice(0,5).join('، ')}`);
  if(offers.length)lines.push(offers.slice(0,6).map(offer=>`• ${offer.seller||'بائع'} — ${offer.location||'غير محدد'}\n  السعر: ${money(offer.price_sar)} ر.س${offer.unit_basis?` (${offer.unit_basis})`:''}`).join('\n'));
  if(parsed?.note)lines.push(parsed.note);
  return lines.join('\n');
}

async function callGemini(model,prompt,timeoutMs,grounded){
  const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:1400}};
  if(grounded)body.tools=[{google_search:{}}];
  const response=await fetch(`${ENDPOINT(model)}?key=${encodeURIComponent(config.geminiKey)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
    signal:AbortSignal.timeout(timeoutMs)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.error?.message||'تعذر بحث الأسعار المجاني.'),{status:response.status,code:'FREE_PRODUCT_RESEARCH_FAILED'});
  return(data?.candidates?.[0]?.content?.parts||[]).map(part=>part.text||'').join('\n').trim();
}

// حد التنفيذ على Vercel 60 ثانية. أربع محاولات × 20ث كانت تتجاوزه فتُقتل الدالة
// قبل أن ترد على المستخدم؛ لذلك ميزانية كلية صارمة تترك مجالًا للمزوّد البديل.
const TOTAL_BUDGET_MS=32000;
const ATTEMPT_MS=14000;

export async function researchProductMarketFree(query,{city='نجران'}={}){
  const product=validateFreeQuery(query);
  if(!config.geminiKey)throw Object.assign(new Error('بحث الأسعار المجاني غير مفعّل. اضبط GEMINI_API_KEY في Vercel.'),{status:503,code:'FREE_PRODUCT_RESEARCH_NOT_CONFIGURED'});
  const prompt=buildPrompt(product,city),deadline=Date.now()+TOTAL_BUDGET_MS;
  let text='',lastError=null,searched=false;
  for(const model of MODELS){
    // البحث المؤسَّس أولًا للحصول على أسعار حقيقية؛ فإن رفض الحساب الأداة نُعيد
    // بلا بحث، لكن نُعلّم النتيجة بأنها غير مؤسَّسة فلا تُعرض كأسعار مرصودة.
    for(const grounded of [true,false]){
      const remaining=deadline-Date.now();
      if(remaining<3000)break;
      try{text=await callGemini(model,prompt,Math.min(ATTEMPT_MS,remaining),grounded);if(text){searched=grounded;break;}}
      catch(error){lastError=error;if(error?.name==='TimeoutError'&&Date.now()>=deadline)break;}
    }
    if(text||Date.now()>=deadline)break;
  }
  if(!text)throw lastError||Object.assign(new Error('تعذر بحث الأسعار المجاني الآن.'),{status:502,code:'FREE_PRODUCT_RESEARCH_EMPTY'});
  const parsed=parseJson(text)||{};
  const offers=(Array.isArray(parsed.offers)?parsed.offers:[]).map(offer=>({
    seller:String(offer?.seller||'').slice(0,120),
    location:String(offer?.location||'').slice(0,120),
    price_sar:num(offer?.price_sar),
    unit_basis:String(offer?.unit_basis||'').slice(0,60)
  })).filter(offer=>offer.price_sar>0);
  // بلا بحث فعلي تكون الأرقام من ذاكرة النموذج، وعرضها كأسعار سوق تضليل مباشر
  // قد يُبنى عليه قرار شراء — لذلك تُطرح ويُقال ذلك صراحةً.
  const trusted=searched?offers:[];
  const priceLevel=buildFastPriceLevel(trusted);
  const rendered=searched
    ?renderFree(parsed,trusted,priceLevel)
    :[parsed?.identification?`تعريف الصنف: ${parsed.identification}`:'',
      'تعذّر الوصول إلى بحث المتاجر الآن، فلم تُرصد أسعار منشورة موثوقة.',
      'اطلب عرض سعر من الموردين أدناه للحصول على السعر الفعلي.'].filter(Boolean).join('\n');
  return{product,text:rendered,priceLevel,grounded:searched,sources:[],searchedAt:new Date().toISOString(),provider:'gemini-free'};
}
