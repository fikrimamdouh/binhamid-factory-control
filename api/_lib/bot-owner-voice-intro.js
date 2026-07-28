import { config } from './config.js';
import { sendMessage, sendVoiceBuffer } from './telegram.js';
import { synthesizeTelegramReply } from './bot-voice.js';

const normalize=value=>String(value||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[ًٌٍَُِّْـ]/g,'').replace(/[؟?!.,،؛:]+/g,' ').replace(/\s+/g,' ').trim();

export const OWNER_VOICE_INTRO_TEXT='مرحبًا بك يا أبو مالك. معك المساعد الشخصي لمصنع بن حامد. واحد: أجهز لك التقارير والإقرارات وكشوف الحساب، وأحلل المبيعات والتحصيلات والمديونيات. اثنان: أتابع الديزل والمركبات والورشة والصيانة والحضور والانصراف. ثلاثة: أبحث لك عن الموردين والشركات والأسعار، وأسجل أوامر البيع والمشتريات والمهام. اكتب أو قل طلبك مباشرة، وسأنتقل إليه فورًا دون الحاجة إلى إلغاء الحالة السابقة.';

function requested(text=''){
  const raw=String(text||'').trim(),value=normalize(raw);
  return /^\/(voice_intro|intro_voice|welcome_voice)(?:@\w+)?$/i.test(raw)||/^(ابعت|ارسل|ابعث|شغل|قول) (لي )?(رساله|رسالة)? ?(ال)?ترحيب (ال)?صوتي(ه)?$/.test(value)||/^(عرف نفسك|رحب بيا|كلمني) بصوت$/.test(value);
}

function isOwner(message,identity){
  const owner=String(config.telegramOwnerId||'').trim(),sender=String(identity?.external_id||message?.from?.id||'').trim();
  return Boolean(owner&&sender===owner);
}

export async function handleOwnerVoiceIntroCommand(message,identity,text){
  if(!requested(text))return false;
  if(!isOwner(message,identity)){
    await sendMessage(message.chat.id,'الرسالة الترحيبية الصوتية الخاصة بالإدارة متاحة لمالك البوت فقط.',{disable_voice_reply:true});
    return true;
  }
  await sendMessage(message.chat.id,`<b>المساعد الشخصي لمصنع بن حامد</b>\n\n${OWNER_VOICE_INTRO_TEXT}`,{disable_voice_reply:true});
  try{
    const speech=await synthesizeTelegramReply(OWNER_VOICE_INTRO_TEXT);
    if(!speech.buffer){
      await sendMessage(message.chat.id,`تعذر إنشاء التسجيل الصوتي الآن${speech.detail?`: ${String(speech.detail).slice(0,180)}`:'.'}`,{disable_voice_reply:true}).catch(()=>{});
      return true;
    }
    await sendVoiceBuffer(message.chat.id,speech.buffer);
  }catch(error){
    console.warn('[telegram owner voice intro]',{message:String(error?.message||error).slice(0,220)});
    await sendMessage(message.chat.id,'تم إرسال النص، لكن تعذر إرسال التسجيل الصوتي الآن.',{disable_voice_reply:true}).catch(()=>{});
  }
  return true;
}
