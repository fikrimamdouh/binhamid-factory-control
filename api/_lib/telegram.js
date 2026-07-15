import { config } from './config.js';
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
      await new Promise(r => setTimeout(r, 350 * attempt));
    }
  }
  throw lastError;
}
export async function telegram(method, payload = {}) {
  ensure();
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'Telegram API error'), { status: 502, data });
  return data.result;
}
export const sendMessage = (chatId, text, extra = {}) => telegram('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
export const answerCallback = (id, text = '') => telegram('answerCallbackQuery', { callback_query_id: id, text, show_alert: false });
export async function getFile(fileId) { return telegram('getFile', { file_id: fileId }); }
export async function downloadTelegramFile(fileId) {
  const info = await getFile(fileId);
  const response = await fetchRetry(`https://api.telegram.org/file/bot${config.telegramToken}/${info.file_path}`);
  if (!response.ok) throw Object.assign(new Error('تعذر تنزيل ملف Telegram'), { status: 502 });
  return { buffer: Buffer.from(await response.arrayBuffer()), filePath: info.file_path, contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
export function keyboard(rows) { return { reply_markup: { inline_keyboard: rows } }; }
export async function sendVoiceBuffer(chatId, buffer, caption = '') {
  ensure();
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('voice', new Blob([buffer], { type: 'audio/mpeg' }), 'reply.mp3');
  const response = await fetchRetry(`https://api.telegram.org/bot${config.telegramToken}/sendVoice`, { method: 'POST', body: form });
  const data = await response.json();
  if (!data.ok) throw Object.assign(new Error(data.description || 'تعذر إرسال الرد الصوتي'), { status: 502 });
  return data.result;
}

