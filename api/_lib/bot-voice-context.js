import { AsyncLocalStorage } from 'node:async_hooks';

const storage=new AsyncLocalStorage();

export function enableTelegramVoiceReply(){
  storage.enterWith({enabled:true,sent:false});
}

export function voiceReplyPending(){
  const state=storage.getStore();
  return Boolean(state?.enabled&&!state.sent);
}

export function markVoiceReplySent(){
  const state=storage.getStore();
  if(state)state.sent=true;
}

export function shouldSpeakTelegramText(text='',extra={}){
  if(!voiceReplyPending())return false;
  const value=String(text||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  if(value.length<12)return false;
  if(/^(تم استلام رسالتك الصوتية|تم فهم التسجيل|جارٍ|جاري|لحظة|انتظر)/.test(value))return false;
  if(/^(اكتب|اختر|أرسل|ارسل|اضغط|حدد)\b/.test(value)&&value.length<240)return false;
  if(extra?.disable_voice_reply)return false;
  return true;
}
