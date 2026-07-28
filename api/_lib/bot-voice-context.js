import { AsyncLocalStorage } from 'node:async_hooks';

const storage=new AsyncLocalStorage();

export function enableTelegramVoiceReply(chatId){
  storage.enterWith({enabled:true,sent:false,chatId:String(chatId||'__unbound__')});
}

function stateForChat(chatId){
  const state=storage.getStore(),target=String(chatId||'');
  if(state?.enabled&&state.chatId==='__unbound__'&&target)state.chatId=target;
  return{state,target};
}

export function voiceReplyPending(chatId){
  const{state,target}=stateForChat(chatId);
  return Boolean(state?.enabled&&!state.sent&&state.chatId&&state.chatId===target);
}

export function markVoiceReplySent(chatId){
  const{state,target}=stateForChat(chatId);
  if(state?.chatId&&state.chatId===target)state.sent=true;
}

export function shouldSpeakTelegramText(chatId,text='',extra={}){
  if(!voiceReplyPending(chatId)||extra?.disable_voice_reply)return false;
  const value=String(text||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  if(value.length<12)return false;
  return !/^(تم استلام الرساله الصوتيه|تم استلام الرسالة الصوتية|تم فهم التسجيل|جاري |جارٍ |لحظه|لحظة|انتظر)/i.test(value);
}
