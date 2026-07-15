import { config } from './config.js';
export async function transcribe(buffer, filename = 'voice.ogg', contentType = 'audio/ogg') {
  if (!config.openaiKey) return null;
  const form = new FormData();
  form.append('model', config.transcribeModel);
  form.append('language', 'ar');
  form.append('file', new Blob([buffer], { type: contentType }), filename);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}` }, body: form });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || 'تعذر تحويل الصوت إلى نص'), { status: 502 });
  return String(data.text || '').trim();
}
export async function synthesize(text) {
  if (!config.openaiKey || !text) return null;
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ttsModel, voice: config.ttsVoice, input: String(text).slice(0, 1800), response_format: 'mp3' })
  });
  if (!response.ok) { const data = await response.json().catch(()=>({})); throw Object.assign(new Error(data?.error?.message || 'تعذر إنشاء الرد الصوتي'), { status: 502 }); }
  return Buffer.from(await response.arrayBuffer());
}
