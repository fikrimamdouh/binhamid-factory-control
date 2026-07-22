import test from 'node:test';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../legacy.html',import.meta.url),'utf8');

test('print current site customer declaration renderer and helpers',()=>{
  const helperStart=source.indexOf('function tbar(');
  const docStart=source.indexOf('function docCli(');
  const docEnd=source.indexOf('/* ═══════════ DOC 3',docStart);
  const cssStart=source.indexOf('.sheet{');
  const cssEnd=source.indexOf('</style>',cssStart);
  console.log('\nSITE_DECLARATION_TEMPLATE_BEGIN\n');
  console.log('HELPERS\n'+source.slice(helperStart,docStart));
  console.log('DOC_CLI\n'+source.slice(docStart,docEnd));
  console.log('CSS\n'+source.slice(cssStart,cssEnd));
  console.log('\nSITE_DECLARATION_TEMPLATE_END');
});
