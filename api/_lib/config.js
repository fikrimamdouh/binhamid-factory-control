export const config = {
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'factory-documents',
  adminToken: process.env.BINHAMID_ADMIN_TOKEN || '',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  telegramOwnerId: String(process.env.TELEGRAM_OWNER_ID || ''),
  openaiKey: process.env.OPENAI_API_KEY || '',
  transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-mini',
  ttsModel: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
  ttsVoice: process.env.OPENAI_TTS_VOICE || 'coral'
};
export const readiness = () => ({
  supabaseConfigured: Boolean(config.supabaseUrl && config.supabaseKey),
  storageConfigured: Boolean(config.supabaseUrl && config.supabaseKey && config.storageBucket),
  adminTokenConfigured: Boolean(config.adminToken),
  cloudConfigured: Boolean(config.supabaseUrl && config.supabaseKey && config.adminToken),
  telegramConfigured: Boolean(config.telegramToken && config.telegramSecret),
  openaiConfigured: Boolean(config.openaiKey)
});
