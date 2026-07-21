import { config } from './config.js';
import { upsert } from './supabase.js';

function ensure() { if (!config.telegramToken) throw Object.assign(new Error('Telegram Bot Token غير مضبوط'), { status: 503 }); }
async function fetchRetry(url, options = {}, tries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await fetch(url, options); }
    catch (error) {
      lastError = error;
      const signal = String(error?.cause?.code || error?.cause?.message || error?.message || '');
      const transient = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR|socket|network|fetch failed|terminated|TLS/i.test(signal);
      if (!transient || attempt === tries) throw error;
      await new Promise(resolve => setTimeout(resolve, 350 * attempt));
    }
  }
  throw lastError;
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function inferTelegramButtonStyle(button={}){
  if(button.style)return button.style;
  const value=`${String(button.text||'')} ${String(button.callback_data||'')}`.toLowerCase();
  if(/حذف|الغاء|إلغاء|رفض|ايقاف|إيقاف|خروج|تراجع|cancel|delete|reject|decline|stop|close/.test(value))return'danger';
  if(/تأكيد|تاكيد|اعتماد|حفظ|ارسال|إرسال|تنفيذ|استلام|موافق|اكمال|إكمال|تم|confirm|approve|accept|save|send|submit|complete|success/.test(value))return'success';
  if(/فتح|عرض|تعديل|بحث|التالي|السابق|رجوع|القائمه|القائمة|الرئيسيه|الرئيسية|تحديث|تفاصيل|open|view|edit|search|next|prev|back|menu|home|refresh|details/.test(value))return'primary';
  return'';
}

export function styleTelegramMarkup(replyMarkup){
  if(!replyMarkup||typeof replyMarkup!=='object')return replyMarkup;
  for(const key of ['inline_keyboard','keyboard']){
    const rows=replyMarkup[key];
    if(!Array.isArray(rows))continue;
    replyMarkup[key]=rows.map(row=>(row||[]).map(button=>{
      if(!button||typeof button!=='object')return button;
      const style=inferTelegramButtonStyle(button);
      return style&&!button.style?{...button,style}:button;
    }));
  }
  return replyMarkup;
}

export async function telegram(method, payload = {}) {
  ensure();
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'Telegram API error'), { status: 502, upstreamStatus: response.status, telegramErrorCode: data.error_code, data });
  return data.result;
}

async function recordOutgoing(result, method, fallback = {}) {
  try {
    if (!result?.chat?.id || !result?.message_id) return;
    const messageType = result.voice ? 'voice' : result.document ? 'document' : result.photo ? 'photo' : result.location ? 'location' : 'text';
    const row = {
      update_id: `out:${result.chat.id}:${result.message_id}`,
      chat_id: String(result.chat.id),
      message_id: String(result.message_id),
      group_id: null,
      sender_user_id: null,
      sender_external_id: 'bot',
      sender_name: 'مساعد مصنع بن حامد',
      chat_type: String(result.chat.type || ''),
      message_type: messageType,
      text: result.text || result.caption || fallback.text || fallback.caption || '',
      transcription: null,
      file_id: result.voice?.file_id || result.document?.file_id || result.photo?.at?.(-1)?.file_id || null,
      file_name: result.document?.file_name || fallback.filename || null,
      mime_type: result.document?.mime_type || result.voice?.mime_type || fallback.contentType || null,
      file_path: null,
      related_entity_type: null,
      related_entity_id: null,
      direction: 'outgoing',
      delivery_status: 'sent',
      reply_to_message_id: result.reply_to_message?.message_id ? String(result.reply_to_message.message_id) : null,
      bot_method: method,
      action_name: fallback.actionName || null,
      action_payload: fallback.actionPayload || {},
      raw: { message: result, method },
      created_at: new Date((result.date || Date.now() / 1000) * 1000).toISOString()
    };
    await upsert('telegram_messages', [row], 'chat_id,message_id');
  } catch (error) {
    // Conversation logging must never prevent the bot reply from reaching the user.
    console.warn('[telegram outgoing log]', error?.message || error);
  }
}

export async function sendMessage(chatId, text, extra = {}) {
  const { action_name: actionName, action_payload: actionPayload, ...telegramExtra } = extra || {};
  if(telegramExtra.reply_markup)telegramExtra.reply_markup=styleTelegramMarkup(telegramExtra.reply_markup);
  const result = await telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...telegramExtra });
  await recordOutgoing(result, 'sendMessage', { text, actionName, actionPayload });
  return result;
}

export async function answerCallback(id, text = '') {
  try{return await telegram('answerCallbackQuery', { callback_query_id: id, text, show_alert: false });}
  catch(error){
    const message=String(error?.message||'');
    if(/query is too old|response timeout expired|query ID is invalid/i.test(message)){
      console.warn('[telegram callback expired]',{message:message.slice(0,180)});
      return null;
    }
    throw error;
  }
}
export async function getFile(fileId) { return telegram('getFile', { file_id: fileId }); }
async function getFileWithRetry(fileId,tries=3){
  let lastError;
  for(let attempt=1;attempt<=tries;attempt++){
    try{return await getFile(fileId);}
    catch(error){
      lastError=error;
      const permanent=/file is too big|wrong file identifier|bad request: file/i.test(String(error?.message||''));
      if(permanent||attempt===tries)throw error;
      await wait(400*attempt);
    }
  }
  throw lastError;
}
export async function downloadTelegramFile(fileId,options={}) {
  const maxBytes=Number(options.maxBytes||config.maxImportFileBytes||0),expectedSize=Number(options.expectedSize||0);
  if(maxBytes&&expectedSize>maxBytes)throw Object.assign(new Error('file is too big'),{status:413,code:'TELEGRAM_FILE_TOO_LARGE'});
  const info=await getFileWithRetry(fileId),reportedSize=Number(info?.file_size||expectedSize||0);
  if(!info?.file_path)throw Object.assign(new Error('Telegram file path is missing'),{status:502,code:'TELEGRAM_FILE_PATH_MISSING'});
  if(maxBytes&&reportedSize>maxBytes)throw Object.assign(new Error('file is too big'),{status:413,code:'TELEGRAM_FILE_TOO_LARGE'});
  let response,lastStatus=0;
  for(let attempt=1;attempt<=3;attempt++){
    response=await fetchRetry(`https://api.telegram.org/file/bot${config.telegramToken}/${info.file_path}`);
    lastStatus=response.status;
    if(response.ok)break;
    if(![408,425,429,500,502,503,504].includes(response.status)||attempt===3)break;
    await response.arrayBuffer().catch(()=>null);
    await wait(450*attempt);
  }
  if (!response?.ok) throw Object.assign(new Error('تعذر تنزيل ملف Telegram'), { status: 502, upstreamStatus:lastStatus,code:'TELEGRAM_FILE_DOWNLOAD_FAILED' });
  const buffer=Buffer.from(await response.arrayBuffer());
  if(!buffer.length)throw Object.assign(new Error('Telegram file is empty'),{status:502,code:'TELEGRAM_FILE_EMPTY'});
  if(maxBytes&&buffer.length>maxBytes)throw Object.assign(new Error('file is too big'),{status:413,code:'TELEGRAM_FILE_TOO_LARGE'});
  return { buffer, filePath: info.file_path, contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
export function keyboard(rows) { return { reply_markup: styleTelegramMarkup({ inline_keyboard: rows }) }; }
export function replyKeyboard(rows, options = {}) { return { reply_markup: styleTelegramMarkup({ keyboard: rows, resize_keyboard: true, one_time_keyboard: Boolean(options.oneTime), selective: true }) }; }

export async function sendVoiceBuffer(chatId, buffer, caption = '') {
  ensure();
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('voice', new Blob([buffer], { type: 'audio/mpeg' }), 'reply.mp3');
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/sendVoice`, { method: 'POST', body: form });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'تعذر إرسال الرد الصوتي'), { status: 502 });
  await recordOutgoing(data.result, 'sendVoice', { caption, filename: 'reply.mp3', contentType: 'audio/mpeg' });
  return data.result;
}

export async function sendDocumentBuffer(chatId, buffer, filename, contentType = 'application/octet-stream', caption = '') {
  ensure();
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buffer], { type: contentType }), filename || 'document.bin');
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/sendDocument`, { method: 'POST', body: form });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'تعذر إرسال المستند'), { status: 502 });
  await recordOutgoing(data.result, 'sendDocument', { caption, filename, contentType });
  return data.result;
}
