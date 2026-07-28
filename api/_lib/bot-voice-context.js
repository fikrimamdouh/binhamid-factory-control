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
  if(!voiceReplyPending(chatId))return false;
  if(extra?.disable_voice_reply||extra?.voice_reply_result!==true)return false;
  const value=String(text||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return value.length>=12;
}
