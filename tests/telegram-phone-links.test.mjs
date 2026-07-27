import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreTelegramPhoneLinks } from '../api/_lib/telegram.js';

test('tel HTML links are converted to Telegram phone-number text',()=>{
  const input='📞 <a href="tel:+966551234567">055 123 4567</a>';
  const output=restoreTelegramPhoneLinks(input);
  assert.equal(output,'📞 +966551234567');
  assert.doesNotMatch(output,/href=["']tel:/i);
});

test('normal HTML formatting is preserved',()=>{
  const input='<b>المورد</b> — 📞 <a href="tel:+966175221234">017 522 1234</a>';
  assert.equal(restoreTelegramPhoneLinks(input),'<b>المورد</b> — 📞 +966175221234');
});
