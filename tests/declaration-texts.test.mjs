import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUSTOMER_PORTFOLIO_CLAUSES,
  CUSTOMER_PORTFOLIO_DECLARATION_TEXT,
  DECLARATION_TEXT_VERSION
} from '../api/_lib/declaration-texts.js';

const NEW_CLAUSE='ألتزم بمتابعة المبالغ غير المسددة خلال مهلة {الأيام} أيام من تاريخ التوريد، ورفع حالة المتأخرات للإدارة. ألتزم بأن مهلة السداد المحددة أعلاه ({الأيام} أيام) نافذة فقط في حال توفر السيولة الكافية لدى المنشأة لشراء المواد الخام التشغيلية؛ وفي حال عدم توفر هذه السيولة، ألتزم أنا (المحصل أو مسؤول مبيعات الخرسانة) بتحصيل دفعة مقدمة من العميل قبل التوريد، أو بتحصيل كامل قيمة الحساب فورًا، ولا يجوز الاعتداد بمهلة السداد المذكورة في هذه الحالة إلا بموافقة كتابية مسبقة من الإدارة.';

test('customer portfolio contains the eight original clauses plus one approved clause',()=>{
  assert.equal(DECLARATION_TEXT_VERSION,'2026-07-21-original-plus-liquidity-v1');
  assert.equal(CUSTOMER_PORTFOLIO_CLAUSES.length,9);
  assert.equal(CUSTOMER_PORTFOLIO_CLAUSES[0],'أُقر بأن العملاء المدرجين في هذا النموذج مُسندون إليّ، وأنني المسؤول المباشر عن متابعة تعاملاتهم وتحصيل مستحقات المنشأة لديهم.');
  assert.equal(CUSTOMER_PORTFOLIO_CLAUSES[7],'أُقر بعلمي التام بأن جميع العملاء والبيانات التجارية ملك خالص للمنشأة، وألتزم بعدم إفشائها أو استغلالها لمصلحتي أو لمصلحة الغير أثناء الخدمة أو بعدها.');
  assert.equal(CUSTOMER_PORTFOLIO_CLAUSES[8],NEW_CLAUSE);
  assert.equal(CUSTOMER_PORTFOLIO_DECLARATION_TEXT.split('\n').length,9);
});

test('Telegram portfolio PDF uses the central legal text',()=>{
  const source=readFileSync(new URL('../api/_lib/customer-portfolio-pdf.js',import.meta.url),'utf8');
  assert.match(source,/declarationText:CUSTOMER_PORTFOLIO_DECLARATION_TEXT/);
  assert.ok(!source.includes("declarationText:legacy?.txt?.cli||''"));
});

test('legacy runtime restores every original declaration group without saving customer data',()=>{
  const source=readFileSync(new URL('../assets/original-declaration-texts.js',import.meta.url),'utf8');
  const loader=readFileSync(new URL('../assets/governance-entry.js',import.meta.url),'utf8');
  for(const key of ['veh','cli','cliX','acct','plant','plantX','mech','ack'])assert.match(source,new RegExp(`\\b${key}:`));
  assert.equal(source.split(NEW_CLAUSE).length-1,1);
  assert.ok(!source.includes('ألتزم بإثبات كل توريد باسم العميل الصحيح'));
  assert.match(source,/state\.txt=\{\.\.\.current,\.\.\.TEXTS\}/);
  assert.match(source,/state\.txtCustom=false/);
  assert.ok(!source.includes('save();'));
  assert.match(loader,/original-declaration-texts\.js\?v=20260721-1/);
});
