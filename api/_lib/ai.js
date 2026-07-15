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
export async function analyzeFactoryMessage({text,userName,roleLabel,departmentLabel,history=[],fallbackRoute={}}={}){
  if(!config.openaiKey||!String(text||'').trim())return null;
  const instructions=`أنت المساعد الشخصي الذكي لمصنع بن حامد للبلوك والخرسانة الجاهزة. تحدث بطريقة بشرية طبيعية ومهنية ومختصرة، وبنفس لغة المستخدم. خاطب المستخدم باسمه. افهم اللهجة المصرية والخليجية والعربية والإنجليزية والأردية قدر الإمكان.
مهمتك: الرد الطبيعي، تلخيص المقصود، وتحديد أين ستظهر الرسالة داخل النظام قبل أي ترحيل.
المسارات المتاحة فقط: الورشة والصيانة، المالية والحسابات، الرواتب وشؤون الموظفين، سجل الديزل، مبيعات البلوك، تحصيلات البلوك، مبيعات الخرسانة، تحصيلات الخرسانة، لوحة مدير المصنع، مركز الاتصال.
لا تدّع أن عملية مالية أو اعتمادًا أو ترحيلًا نهائيًا تم. الرسائل النصية تحفظ أولًا في مركز الاتصال للمراجعة. بلاغ الصيانة يحتاج تأكيدًا. إذا كان الكلام مجرد تحية أو سؤال عام فجاوب طبيعيًا بلا ادعاء تنفيذ.
أعد JSON فقط بهذه الحقول: reply, intent, department, destination, summary, confidence, needs_confirmation.
intent أحد: greeting, thanks, report, maintenance, fuel, payroll, collection, sales, quotation, finance, department_message, general.
department أحد: workshop, finance, block, concrete, management, fuel, general, unassigned.
confidence رقم من 0 إلى 1. reply لا يزيد عن 500 حرف.`;
  const payload={user:{name:userName,role:roleLabel,department:departmentLabel},message:String(text).slice(0,3000),recent_history:(history||[]).slice(-8),fallback_route:fallbackRoute};
  const model=config.textModel==='gpt-5.4-mini'?'gpt-5.6':config.textModel;
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({model,instructions,input:JSON.stringify(payload),max_output_tokens:700}),signal:AbortSignal.timeout(14000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data?.error?.message||'تعذر تشغيل الفهم الذكي'),{status:502});
  return parseJson(responseText(data));
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
