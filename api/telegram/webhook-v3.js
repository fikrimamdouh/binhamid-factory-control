// Stable enterprise Telegram endpoint.
// The full operational engine currently lives in webhook-v2.js; re-exporting it
// keeps one implementation while allowing the registered webhook to use v3.
export { default } from './webhook-v2.js';
