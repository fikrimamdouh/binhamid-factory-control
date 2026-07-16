// Stable enterprise Telegram endpoint.
// Business logic lives under _lib so Vercel creates only one webhook function.
export { default } from '../_lib/telegram-webhook-handler.js';
