import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/existing-daily-import-fix.js',import.meta.url),'utf8');
function helpers(){
  const window={};
  vm.runInNewContext(source,{window,console,setInterval:()=>1,setTimeout:()=>1,clearInterval:()=>{},document:{createElement(){throw new Error('DOM helper not used in this test');}}});
  return window.BinHamidExistingDailyImportHelpers;
}

test('recognizes both بلك and بلوك as block sales',()=>{
  const api=helpers();
  assert.equal(api.isBlock({item:'بلك اسود مقاس 20*20*40 سم'}),true);
  assert.equal(api.isBlock({item:'بلوك اسود'}),true);
  assert.equal(api.isConcrete({item:'خرسانة 7 كيس'}),true);
});

test('removes an exact repeated inventory row from the same workbook',()=>{
  const api=helpers();
  const stock=[
    {code:'10010001',item:'اسمنت سايب',direction:'in',quantity:27.03,opening:2466.14735,closing:2493.17735,section:'مشتريات خامات / وارد',warehouse:''},
    {code:'10010001',item:'اسمنت سايب',direction:'in',quantity:27.03,opening:2466.14735,closing:2493.17735,section:'مشتريات خامات / وارد',warehouse:''},
    {code:'10010003',item:'بطحا',direction:'in',quantity:500,opening:2794.07781,closing:3294.07781,section:'وارد مخزني',warehouse:''}
  ];
  assert.equal(api.dedupeStock(stock).length,2);
});

test('builds a legacy-compatible sheet for the existing Daily Summary screen',()=>{
  const api=helpers();
  const rows=api.buildLegacyRows({
    sales:[{invoice:'18354',quantity:700,customerCode:'13176',customer:'حسين المحامض',item:'بلك اسود',amount:1260}],
    collections:[{date:'',customerCode:'13183',customer:'صالح سالم',amount:3825,method:'نقدي',receipt:'429'}]
  });
  assert.equal(JSON.stringify(rows[1].slice(0,6)),JSON.stringify(['رقم الفاتورة','الكمية','كود العميل','اسم العميل','الصنف','قيمة المبيعات']));
  assert.equal(rows[2][2],'13176');
  assert.equal(rows.at(-1)[1],'13183');
});
