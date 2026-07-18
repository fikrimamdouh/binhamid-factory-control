import { config } from './config.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function buildForm(buffer,contentType,model){
  const form=new FormData();
  form.append('model',model);
  form.append('language','ar');
  form.append('response_format','json');
  form.append('temperature','0');
  form.append('prompt','مصنع بن حامد، بلوك، خرسانة جاهزة، تقرير مسبق، تقرير اليوم، احتياجات الخرسانة، خلطات ومضخات وخلاطات، إنتاج البلوك، ديزل، وقود، لوحة سيارة، معدة، سائق، فاتورة، تحصيل، مبيعات، محاسبة، ميزان مراجعة، دفتر أستاذ، صيانة، عطل، أمر إصلاح، قطع غيار، رواتب. اكتب الأرقام والتواريخ والكميات بوضوح.');
  form.append('file',new Blob([buffer],{type:contentType||'audio/ogg'}),'telegram-voice.ogg');
  return form;
}

async function requestTranscription(buffer,contentType,model){
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{
    method:'POST',
    headers:{Authorization:`Bearer ${config.openaiKey}`},
    body:buildForm(buffer,contentType,model),
    signal:AbortSignal.timeout(8500)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data?.error?.message||`تعذر تحويل الصوت باستخدام ${model}`);
    error.status=response.status;throw error;
  }
  return String(data?.text||'').trim();
}

export async function transcribeTelegramVoice(buffer,contentType='audio/ogg'){
  if(!config.openaiKey)return{text:'',reason:'missing_key',detail:'OPENAI_API_KEY غير مضبوط في Vercel'};
  const models=[config.transcribeModel,'gpt-4o-mini-transcribe','whisper-1'].filter((value,index,array)=>value&&array.indexOf(value)===index).slice(0,2);
  let lastError=null;
  for(let index=0;index<models.length;index++){
    try{
      const text=await requestTranscription(buffer,contentType,models[index]);
      if(text)return{text,model:models[index],reason:''};
      lastError=new Error('التسجيل لم يحتوي كلامًا واضحًا');
    }catch(error){
      lastError=error;
      if([401,403].includes(Number(error.status)))return{text:'',reason:'auth',detail:error.message};
      if(Number(error.status)===429)return{text:'',reason:'quota',detail:error.message};
      if(index<models.length-1)await sleep(250);
    }
  }
  return{text:'',reason:'transcription_failed',detail:lastError?.message||'تعذر فهم التسجيل'};
}

export function voiceFailureMessage(result={}){
  if(result.reason==='missing_key')return 'تم حفظ الرسالة الصوتية، لكن خدمة الفهم الصوتي غير مفعلة على الخادم. يجب إضافة OPENAI_API_KEY في إعدادات Vercel ثم إعادة النشر.';
  if(result.reason==='auth')return 'تم حفظ الرسالة الصوتية، لكن مفتاح خدمة الذكاء الصوتي غير صالح أو لا يملك صلاحية. راجع OPENAI_API_KEY في Vercel.';
  if(result.reason==='quota')return 'تم حفظ الرسالة الصوتية، لكن رصيد أو حد استخدام خدمة التحويل الصوتي متوقف حاليًا. راجع حساب OpenAI المرتبط بالمفتاح.';
  return 'تم حفظ الرسالة الصوتية، لكن لم أستطع فهم الكلام بوضوح بعد محاولتين. أعد التسجيل قريبًا من الهاتف، بدون ضوضاء، واذكر الطلب ورقم اللوحة ببطء.';
}
