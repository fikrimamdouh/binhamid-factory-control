import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('website and Telegram import one shared customer declaration renderer',()=>{
  const shared=read('shared/customer-portfolio-declaration.js');
  const server=read('api/_lib/customer-portfolio-pdf.js');
  const bridge=read('assets/customer-portfolio-canonical-bridge.js');
  assert.match(shared,/export function renderCustomerPortfolioDeclaration/);
  assert.match(server,/from '\.\.\/\.\.\/shared\/customer-portfolio-declaration\.js'/);
  assert.match(server,/renderCustomerPortfolioDeclaration\(/);
  assert.match(bridge,/import\('\/shared\/customer-portfolio-declaration\.js\?v=20260722-1'\)/);
  assert.match(bridge,/window\.docCli=function/);
  assert.doesNotMatch(server,/function customerPortfolioHtml/);
});

test('website and Telegram use the approved base text including the agreed clause',()=>{
  const texts=read('shared/canonical-declaration-texts.js');
  const server=read('api/_lib/customer-portfolio-pdf.js');
  const bridge=read('assets/customer-portfolio-canonical-bridge.js');
  assert.match(texts,/ألتزم بمتابعة المبالغ غير المسددة خلال مهلة \{الأيام\} أيام/);
  assert.match(texts,/مهلة السداد المحددة أعلاه \(\{الأيام\} أيام\) نافذة فقط في حال توفر السيولة الكافية/);
  assert.match(texts,/يقر المندوب بمسؤوليته الكاملة عن العملاء المُسندين إليه/);
  assert.match(texts,/وبناءً عليه، أُقر أنا الموقّع أدناه بأنني قرأت هذا النموذج/);
  assert.match(server,/shared\/canonical-declaration-texts\.js/);
  assert.match(server,/declarationText:CUSTOMER_PORTFOLIO_DECLARATION/);
  assert.match(server,/extraText:CUSTOMER_PORTFOLIO_EXTRA/);
  assert.match(server,/ackText:DECLARATION_ACK/);
  assert.match(bridge,/canonical-declaration-texts\.js\?v=20260722-1/);
});

test('base text is active unless the user explicitly saves a manual edit',()=>{
  const guard=read('assets/canonical-declaration-texts.js');
  assert.match(guard,/MANUAL_SOURCE='manual-v2'/);
  assert.match(guard,/BASE_SOURCE='base-v2'/);
  assert.match(guard,/D\.txt=\{\.\.\.DEF\}/);
  assert.match(guard,/D\.txtCustom=false/);
  assert.match(guard,/D\.txtCustomSource=BASE_SOURCE/);
  assert.match(guard,/D\.txtCustomSource=MANUAL_SOURCE/);
  assert.match(guard,/window\.saveTxt=function/);
  assert.match(guard,/window\.resetTxt=function/);
  assert.match(guard,/تم حفظ تعديلك اليدوي/);
  assert.match(guard,/تم الرجوع إلى النسخة الأساسية المعتمدة/);
  assert.doesNotMatch(guard,/hideEditor/);
});

test('old accidental custom state is reset but explicit manual v2 survives reloads',()=>{
  const guard=read('assets/canonical-declaration-texts.js');
  assert.match(guard,/function isManualCustom\(\)/);
  assert.match(guard,/D\?\.txtCustom===true&&D\?\.txtCustomSource===MANUAL_SOURCE/);
  assert.match(guard,/if\(!isManualCustom\(\)\)activateBase\(\)/);
  assert.match(guard,/if\(!explicitTextSave&&!isManualCustom\(\)\)activateBase\(\)/);
});

test('boot loads the new text behavior before Telegram print integration',()=>{
  const index=read('index.html');
  const canonical=index.indexOf('canonical-declaration-texts.js?v=20260722-2');
  const bridge=index.indexOf('customer-portfolio-canonical-bridge.js?v=20260722-1');
  const telegram=index.indexOf('telegram-pdf-declarations.js?v=20260722-7');
  assert.ok(canonical>=0&&bridge>canonical&&telegram>bridge);
  assert.match(index,/legacy\.html\?v=20260722-canonical-declarations-2/);
  assert.match(index,/bhCanonicalPortfolioReady/);
});
