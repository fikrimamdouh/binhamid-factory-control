import { config } from './config.js';

export async function transcribe(buffer, filename = 'voice.ogg', contentType = 'audio/ogg') {
  if (!config.openaiKey) return null;
  const form = new FormData();
  form.append('model', config.transcribeModel);
  form.append('language', 'ar');
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}` }, body: form, signal:AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || 'تعذر تحويل الصوت إلى نص'), { status: 502 });
  return String(data.text || '').trim();
}

function responseText(data={}){
  if(data.output_text)return String(data.output_text);
  return (data.output||[]).flatMap(item=>item.content||[]).filter(x=>x.type==='output_text'||typeof x.text==='string').map(x=>x.text||'').join('\n').trim();
}
function parseJson(text=''){
  const clean=String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(clean);}catch{}
  const start=clean.indexOf('{'),end=clean.lastIndexOf('}');
  if(start>=0&&end>start){try{return JSON.parse(clean.slice(start,end+1));}catch{}}
  return null;
}
const ROUTE_SCHEMA={
  type:'object',
  additionalProperties:false,
  required:['reply','intent','department','destination','summary','confidence','needs_confirmation'],
  properties:{
    reply:{type:'string'},
    intent:{type:'string',enum:['greeting','thanks','report','maintenance','fuel','payroll','collection','sales','quotation','finance','department_message','general']},
    department:{type:'string',enum:['workshop','finance','block','concrete','management','fuel','general','unassigned']},
    destination:{type:'string'},
    summary:{type:'string'},
    confidence:{type:'number',minimum:0,maximum:1},
    needs_confirmation:{type:'boolean'}
  }
};
function modelCandidates(){
  return [...new Set([String(config.textModel||'').trim(),'gpt-5-mini','gpt-4.1-mini'].filter(Boolean))].slice(0,3);
}
function hollowReply(value=''){
  const text=String(value||'').trim();
  if(text.length<3)return true;
  return /عندما يكون الطلب متعلق[ًاا] ببيانات المصنع|سأحدد المسار والإجراء|اكتب طلبك مباشرة دون|فهمت كلامك(?: يا)?[^.،]*[.،]?$/i.test(text);
}
async function requestAnalysis({model,instructions,payload}){
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      store:false,
      instructions,
      input:JSON.stringify(payload),
      max_output_tokens:900,
      text:{format:{type:'json_schema',name:'factory_message_route',description:'فهم رسالة مستخدم بوت المصنع والرد عليها وتحديد مسارها عند الحاجة',strict:true,schema:ROUTE_SCHEMA}}
    }),
    signal:AbortSignal.timeout(22000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.error?.message||'تعذر تشغيل الفهم الذكي'),{status:Number(response.status)||502,code:data?.error?.code||'AI_RESPONSE_FAILED',model});
  const parsed=parseJson(responseText(data));
  if(!parsed)throw Object.assign(new Error('عاد الفهم الذكي بنتيجة غير قابلة للقراءة'),{status:502,code:'AI_JSON_INVALID',model});
  return parsed;
}

export async function analyzeFactoryMessage({text,userName,roleLabel,departmentLabel,history=[],fallbackRoute={}}={}){
  if(!config.openaiKey||!String(text||'').trim())return null;
  const instructions=`أنت المساعد الشخصي التنفيذي لمصنع بن حامد للبلوك والخرسانة الجاهزة. افهم المقصود أولًا ثم أجب المستخدم على طلبه نفسه، لا على مجرد تصنيف الطلب.

قواعد الرد:
- تحدث بالعربية الطبيعية وبلهجة المستخدم عند وضوحها، وباختصار مفيد.
- استخدم الاسم فقط عندما يكون طبيعيًا، ولا تبدأ كل رد بعبارة «فهمت».
- ممنوع الرد بقوالب هروب مثل: «عندما يكون الطلب متعلقًا ببيانات المصنع سأحدد المسار» أو «اكتب طلبك مباشرة» أو إعادة صياغة كلام المستخدم بلا إجابة.
- إن كان سؤالًا عامًا أو طلب شرح أو حساب أو رأي: أجب مباشرة داخل reply، واجعل intent=general، ولا تحوله إلى معاملة.
- إن كان سؤالًا عن بيانات المصنع ولا توجد البيانات الفعلية داخل المدخل: اذكر بوضوح ما تستطيع استنتاجه وما لا تملكه، وحدد الشاشة أو التقرير المطلوب بدل اختلاق أرقام.
- إن كان أمرًا تشغيليًا واضحًا: اشرح الإجراء التالي بدقة، وحدد المسار المناسب. لا تدّع الحفظ أو الاعتماد أو الترحيل ما لم ينفذه مسار مخصص خارج هذا التحليل.
- إن كان الكلام ناقصًا لكن يمكن تقديم إجابة جزئية مفيدة، قدمها ثم اذكر المعلومة الناقصة في جملة واحدة.
- استفد من آخر المحادثة لفهم الضمائر والطلبات المتتابعة.

المسارات المتاحة فقط: الورشة والصيانة، المالية والحسابات، الرواتب وشؤون الموظفين، سجل الديزل، مبيعات البلوك، تحصيلات البلوك، مبيعات الخرسانة، تحصيلات الخرسانة، لوحة مدير المصنع، مركز الاتصال.

أمثلة سلوكية:
- «العميل دفع ليه لسه مديون؟» => اشرح أن الرصيد يعتمد على الفواتير والتحصيلات الموزعة، ووجّه لكشف حساب العميل دون ادعاء رؤية رقم غير موجود.
- «بكرة عندنا صبة 80 متر أجهز إيه؟» => أعط قائمة تجهيز تشغيلية مفيدة وحدد مسار تقرير الخرسانة المسبق.
- «يعني إيه هامش الربح؟» => اشرح المصطلح مباشرة ولا تسجل معاملة.
- «عاوز أسجل اقتراح» => وجّه لمسار اقتراح الإدارة واطلب بدء النموذج، ولا تكتفِ بوصف المسار.

reply يجب أن يكون جوابًا كاملًا ومفيدًا من 1 إلى 6 جمل، وألا يتجاوز 900 حرف.`;
  const payload={user:{name:userName,role:roleLabel,department:departmentLabel},message:String(text).slice(0,4000),recent_history:(history||[]).slice(-8),fallback_route:fallbackRoute};
  let lastError=null;
  for(const model of modelCandidates()){
    try{
      const result=await requestAnalysis({model,instructions,payload});
      if(hollowReply(result.reply))throw Object.assign(new Error('الرد الذكي كان عامًا وغير مفيد'),{status:502,code:'AI_HOLLOW_REPLY',model});
      return result;
    }catch(error){lastError=error;console.warn('[factory ai attempt]',{model,status:Number(error?.status||0),code:error?.code||'',message:String(error?.message||'').slice(0,240)});}
  }
  throw lastError||Object.assign(new Error('تعذر تشغيل الفهم الذكي'),{status:502,code:'AI_UNAVAILABLE'});
}

export async function synthesize(text) {
  if (!config.openaiKey || !text) return null;
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ttsModel, voice: config.ttsVoice, input: String(text).slice(0, 1800), response_format: 'mp3' }),signal:AbortSignal.timeout(20000)
  });
  if (!response.ok) { const data = await response.json().catch(()=>({})); throw Object.assign(new Error(data?.error?.message || 'تعذر إنشاء الرد الصوتي'), { status: 502 }); }
  return Buffer.from(await response.arrayBuffer());
}
