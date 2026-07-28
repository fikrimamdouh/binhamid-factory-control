import { config } from './config.js';
import { enableTelegramVoiceReply } from './bot-voice-context.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function buildForm(buffer,contentType,model){
  const form=new FormData();
  form.append('model',model);
  form.append('language','ar');
  form.append('response_format','json');
  form.append('temperature','0');
  form.append('prompt','مصنع بن حامد، بلوك، خرسانة جاهزة، تقرير مسبق، تقرير اليوم، احتياجات الخرسانة، خلطات ومضخات وخلاطات، إنتاج البلوك، ديزل، وقود، لوحة سيارة، معدة، سائق، فاتورة، تحصيل، مبيعات، محاسبة، مدير مالي، سيولة، مديونية، مخاطر مالية، قرار إداري، محضر اجتماع، طلب ميزانية، التزام مورد، مطالبة مصروف، عهدة، عقد وتجديد، كنية الموظف، ميزان مراجعة، دفتر أستاذ، صيانة، عطل، أمر إصلاح، قطع غيار، رواتب، شركات، مؤسسات، مصانع، وكلاء، موزعون، موردون، محلات. اكتب الأرقام والتواريخ والكميات بوضوح.');
  form.append('file',new Blob([buffer],{type:contentType||'audio/ogg'}),'telegram-voice.ogg');
  return form;
}

async function requestTranscription(buffer,contentType,model){
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{
    method:'POST',headers:{Authorization:`Bearer ${config.openaiKey}`},body:buildForm(buffer,contentType,model),signal:AbortSignal.timeout(8500)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data?.error?.message||`تعذر تحويل الصوت باستخدام ${model}`);error.status=response.status;throw error;}
  return String(data?.text||'').trim();
}

export async function transcribeTelegramVoice(buffer,contentType='audio/ogg'){
  if(!config.openaiKey)return{text:'',reason:'missing_key',detail:'OPENAI_API_KEY غير مضبوط في Vercel'};
  const models=[config.transcribeModel,'gpt-4o-mini-transcribe','whisper-1'].filter((value,index,array)=>value&&array.indexOf(value)===index).slice(0,2);
  let lastError=null;
  for(let index=0;index<models.length;index++){
    try{
      const text=await requestTranscription(buffer,contentType,models[index]);
      if(text){enableTelegramVoiceReply();return{text,model:models[index],reason:''};}
      lastError=new Error('التسجيل لم يحتوي كلامًا واضحًا');
    }catch(error){lastError=error;if([401,403].includes(Number(error.status)))return{text:'',reason:'auth',detail:error.message};if(Number(error.status)===429)return{text:'',reason:'quota',detail:error.message};if(index<models.length-1)await sleep(250);}
  }
  return{text:'',reason:'transcription_failed',detail:lastError?.message||'تعذر فهم التسجيل'};
}

const ENTITY_MAP={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&nbsp;':' '};
export function speechText(value='',max=1600){
  return String(value||'')
    .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>|<\/div>|<\/li>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g,entity=>ENTITY_MAP[entity]||' ')
    .replace(/https?:\/\/\S+/g,'').replace(/[━═]{2,}/g,' ').replace(/[•▪◦]/g,'، ')
    .replace(/\s*\n\s*/g,'. ').replace(/\s{2,}/g,' ').replace(/\.{2,}/g,'.').trim().slice(0,max);
}

export async function synthesizeTelegramReply(text){
  const input=speechText(text);
  if(!input)return{buffer:null,reason:'empty'};
  if(!config.openaiKey)return{buffer:null,reason:'missing_key'};
  const model=config.ttsModel||'gpt-4o-mini-tts',payload={model,voice:config.ttsVoice||'coral',input,response_format:'mp3',speed:1};
  if(/^gpt-/i.test(model))payload.instructions='تحدث بالعربية بصوت واضح وطبيعي وعملي. استخدم نطقًا عربيًا مفهومًا ولهجة مصرية خفيفة في الجمل الحوارية. اقرأ الأرقام والتواريخ والمبالغ ببطء ودقة، ولا تضف أي كلام غير موجود في النص.';
  try{
    const response=await fetch('https://api.openai.com/v1/audio/speech',{
      method:'POST',headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)
    });
    if(!response.ok){const data=await response.json().catch(()=>({}));return{buffer:null,reason:Number(response.status)===429?'quota':'tts_failed',detail:data?.error?.message||`HTTP ${response.status}`};}
    const buffer=Buffer.from(await response.arrayBuffer());
    return buffer.length?{buffer,model,voice:payload.voice,reason:''}:{buffer:null,reason:'empty_audio'};
  }catch(error){return{buffer:null,reason:'tts_failed',detail:String(error?.message||error)};}
}

export function voiceFailureMessage(result={}){
  if(result.reason==='missing_key')return 'تم حفظ الرسالة الصوتية، لكن خدمة الفهم الصوتي غير مفعلة على الخادم. يجب إضافة OPENAI_API_KEY في إعدادات Vercel ثم إعادة النشر.';
  if(result.reason==='auth')return 'تم حفظ الرسالة الصوتية، لكن مفتاح خدمة الذكاء الصوتي غير صالح أو لا يملك صلاحية. راجع OPENAI_API_KEY في Vercel.';
  if(result.reason==='quota')return 'تم حفظ الرسالة الصوتية، لكن رصيد أو حد استخدام خدمة التحويل الصوتي متوقف حاليًا. راجع حساب OpenAI المرتبط بالمفتاح.';
  return 'تم حفظ الرسالة الصوتية، لكن لم أستطع فهم الكلام بوضوح بعد محاولتين. أعد التسجيل قريبًا من الهاتف، بدون ضوضاء، واذكر الطلب ورقم اللوحة ببطء.';
}
