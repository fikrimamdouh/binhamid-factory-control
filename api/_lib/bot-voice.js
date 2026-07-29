import { config } from './config.js';
import { enableTelegramVoiceReply } from './bot-voice-context.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// حد الـ prompt في whisper-1 هو 224 توكن، وما يزيد عليه يُقص صامتًا ويشوّه الناتج.
// لذلك نرسل معجمًا مختصرًا لـwhisper-1 والمعجم الكامل لنماذج gpt-4o التي لا تقيّد الطول.
const CORE_TERMS='سعر، أسعار، عمود كردان، خلاطة، تقرير مسبق، تقرير اليوم، احتياجات الخرسانة، ميزان مراجعة، دفتر أستاذ، مدير مالي، طلب ميزانية، التزام مورد، مطالبة مصروف، كنية الموظف';
const EXTRA_TERMS='بلوك، خرسانة جاهزة، خلاطات، مضخات، إنتاج البلوك، ديزل، وقود، لوحة سيارة، معدة، سائق، فاتورة، تحصيل، مبيعات، محاسبة، سيولة، مديونية، مخاطر مالية، قرار إداري، محضر اجتماع، عهدة، عقد وتجديد، صيانة، عطل، أمر إصلاح، قطع غيار، رواتب، موردون، موزعون، وكلاء';
const SHORT_HINT=`مصطلحات مصنع بن حامد: ${CORE_TERMS}. اكتب الأرقام والتواريخ بوضوح.`;
const FULL_HINT=`مصطلحات مصنع بن حامد: ${CORE_TERMS}، ${EXTRA_TERMS}. اكتب الأرقام والتواريخ والكميات بوضوح.`;
export const transcriptionHint=model=>/whisper/i.test(String(model||''))?SHORT_HINT:FULL_HINT;

function buildForm(buffer,contentType,model,language){
  const form=new FormData();
  form.append('model',model);
  if(language)form.append('language',language);
  form.append('response_format','json');
  form.append('temperature','0');
  form.append('prompt',transcriptionHint(model));
  form.append('file',new Blob([buffer],{type:contentType||'audio/ogg'}),'telegram-voice.ogg');
  return form;
}

export const TRANSCRIBE_TIMEOUT_MS=15000;

// «سعر» و«شعر» متقاربتان صوتيًا وتُنتجان بحثًا عن صالونات شعر بدل قطع الغيار.
// نصحّحهما فقط عند وجود مصطلح ميكانيكي في نفس الجملة حتى لا نفسد كلامًا مشروعًا.
const MECHANICAL_CONTEXT=/عمود|كردان|فلتر|رولمان|بلي|مضخ|خلاط|محرك|موتور|سير|بطاري|هيدروليك|قطع غيار|جربوكس|كلتش|فرامل|صمام|بلف|ترس|خرطوم|كمبروسر|معده|معدة|شيول|حفار|قلاب/i;

export function correctTranscription(text=''){
  const value=String(text||'');
  if(!MECHANICAL_CONTEXT.test(value))return value;
  return value.replace(/(^|[\s،.:؛])شعر(?=[\s،.:؛]|$)/g,'$1سعر');
}

async function requestTranscription(buffer,contentType,model,language){
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{
    method:'POST',headers:{Authorization:`Bearer ${config.openaiKey}`},body:buildForm(buffer,contentType,model,language),signal:AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data?.error?.message||`تعذر تحويل الصوت باستخدام ${model}`);error.status=response.status;throw error;}
  return String(data?.text||'').trim();
}

export async function transcribeTelegramVoice(buffer,contentType='audio/ogg',options={}){
  if(!config.openaiKey)return{text:'',reason:'missing_key',detail:'OPENAI_API_KEY غير مضبوط في Vercel'};
  if(!buffer?.length)return{text:'',reason:'empty_audio',detail:'التسجيل فارغ أو تعذر تنزيله'};
  const models=[config.transcribeModel,'gpt-4o-mini-transcribe','whisper-1'].filter((value,index,array)=>value&&array.indexOf(value)===index).slice(0,2);
  const primary=String(options.language||config.transcribeLanguage||'ar').trim();
  // المحاولة الأولى بالعربية، والثانية بلا قيد لغة حتى لا نجبر كلام الأردية أو الهندية أو البنغالية على العربية.
  const attempts=models.map((model,index)=>({model,language:index===0?primary:''}));
  let lastError=null;
  for(let index=0;index<attempts.length;index++){
    const{model,language}=attempts[index];
    try{
      const text=await requestTranscription(buffer,contentType,model,language);
      if(text){enableTelegramVoiceReply(options.chatId);return{text:correctTranscription(text),model,language:language||'auto',reason:''};}
      lastError=new Error('التسجيل لم يحتوي كلامًا واضحًا');
    }catch(error){lastError=error;if([401,403].includes(Number(error.status)))return{text:'',reason:'auth',detail:error.message};if(Number(error.status)===429)return{text:'',reason:'quota',detail:error.message};if(index<attempts.length-1)await sleep(250);}
  }
  return{text:'',reason:'transcription_failed',detail:lastError?.message||'تعذر فهم التسجيل'};
}

const ENTITY_MAP={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&nbsp;':' '};
export const SPEECH_MAX_CHARS=700;

// قراءة تقرير كامل بصوت واحد متصل تُنتج ردًا صوتيًا رديئًا، فنقتصر على مقطع مفهوم
// ونقطعه عند نهاية جملة بدل بترها في منتصف رقم أو اسم.
export function speechText(value='',max=SPEECH_MAX_CHARS){
  const clean=String(value||'')
    .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>|<\/div>|<\/li>/gi,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g,entity=>ENTITY_MAP[entity]||' ')
    .replace(/https?:\/\/\S+/g,'').replace(/[━═]{2,}/g,' ').replace(/[•▪◦]/g,'، ')
    .replace(/\s*\n\s*/g,'. ').replace(/\s{2,}/g,' ').replace(/\.{2,}/g,'.').trim();
  if(clean.length<=max)return clean;
  const cut=clean.slice(0,max);
  const boundary=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('، '),cut.lastIndexOf(' '));
  return(boundary>Math.floor(max*0.6)?cut.slice(0,boundary):cut).trim();
}

export const TTS_TIMEOUT_MS=12000;

export async function synthesizeTelegramReply(text){
  const input=speechText(text);
  if(!input)return{buffer:null,reason:'empty'};
  if(!config.openaiKey)return{buffer:null,reason:'missing_key'};
  const model=config.ttsModel||'gpt-4o-mini-tts',payload={model,voice:config.ttsVoice||'coral',input,response_format:'opus',speed:1};
  if(/^gpt-/i.test(model))payload.instructions='تحدث بالعربية بصوت واضح وطبيعي وعملي. استخدم نطقًا عربيًا مفهومًا ولهجة مصرية خفيفة في الجمل الحوارية. اقرأ الأرقام والتواريخ والمبالغ ببطء ودقة، ولا تضف أي كلام غير موجود في النص.';
  try{
    const response=await fetch('https://api.openai.com/v1/audio/speech',{
      method:'POST',headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(TTS_TIMEOUT_MS)
    });
    if(!response.ok){const data=await response.json().catch(()=>({}));return{buffer:null,reason:Number(response.status)===429?'quota':'tts_failed',detail:data?.error?.message||`HTTP ${response.status}`};}
    const buffer=Buffer.from(await response.arrayBuffer());
    return buffer.length?{buffer,model,voice:payload.voice,contentType:'audio/ogg',filename:'reply.ogg',reason:''}:{buffer:null,reason:'empty_audio'};
  }catch(error){return{buffer:null,reason:'tts_failed',detail:String(error?.message||error)};}
}

export function voiceFailureMessage(result={}){
  if(result.reason==='missing_key')return 'تم حفظ الرسالة الصوتية، لكن خدمة الفهم الصوتي غير مفعلة على الخادم. يجب إضافة OPENAI_API_KEY في إعدادات Vercel ثم إعادة النشر.';
  if(result.reason==='auth')return 'تم حفظ الرسالة الصوتية، لكن مفتاح خدمة الذكاء الصوتي غير صالح أو لا يملك صلاحية. راجع OPENAI_API_KEY في Vercel.';
  if(result.reason==='quota')return 'تم حفظ الرسالة الصوتية، لكن رصيد أو حد استخدام خدمة التحويل الصوتي متوقف حاليًا. راجع حساب OpenAI المرتبط بالمفتاح.';
  return 'تم حفظ الرسالة الصوتية، لكن لم أستطع فهم الكلام بوضوح بعد محاولتين. أعد التسجيل قريبًا من الهاتف، بدون ضوضاء، واذكر الطلب ورقم اللوحة ببطء.';
}
