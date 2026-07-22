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
  assert.doesNotMatch(server,/const CUSTOMER_PORTFOLIO_DECLARATION\s*=/);
  assert.doesNotMatch(server,/function customerPortfolioHtml/);
});

test('canonical declaration contains the approved collection and liquidity clauses',()=>{
  const shared=read('shared/customer-portfolio-declaration.js');
  assert.match(shared,/ألتزم بمتابعة المبالغ غير المسددة خلال مهلة \{الأيام\} أيام/);
  assert.match(shared,/مهلة السداد المحددة أعلاه \(\{الأيام\} أيام\) نافذة فقط في حال توفر السيولة الكافية/);
  assert.match(shared,/CUSTOMER_PORTFOLIO_TEXT_VERSION/);
});

test('website declaration text editor is disabled and DEF remains the only local source',()=>{
  const guard=read('assets/canonical-declaration-texts.js');
  assert.match(guard,/D\.txt=\{\.\.\.DEF\}/);
  assert.match(guard,/D\.txtCustom=false/);
  assert.match(guard,/p-txt/);
  assert.match(guard,/window\.saveTxt=function/);
  assert.match(guard,/window\.resetTxt=function/);
  assert.match(guard,/النصوص الأصلية هي النسخة الوحيدة المعتمدة/);
});

test('boot loads canonical declarations before Telegram print integration',()=>{
  const index=read('index.html');
  const canonical=index.indexOf('canonical-declaration-texts.js?v=20260722-1');
  const bridge=index.indexOf('customer-portfolio-canonical-bridge.js?v=20260722-1');
  const telegram=index.indexOf('telegram-pdf-declarations.js?v=20260722-7');
  assert.ok(canonical>=0&&bridge>canonical&&telegram>bridge);
  assert.match(index,/bhCanonicalPortfolioReady/);
});
