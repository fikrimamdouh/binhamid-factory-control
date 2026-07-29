import { readFile,writeFile } from 'node:fs/promises';

const target=new URL('../api/_lib/daily-report-v6.js',import.meta.url);
const entry=new URL('../api/erp/daily-report.js',import.meta.url);
let source=await readFile(target,'utf8');

function replaceOnce(before,after,label){
  const count=source.split(before).length-1;
  if(count!==1)throw new Error(`${label}: expected one match, found ${count}`);
  source=source.replace(before,after);
}

replaceOnce(
`const collectionKey=row=>['collection',movementDate(row),customerCode(row),amountToken(row)].join('|');
const legacyCollectionKey=row=>['collection',customerCode(row),amountToken(row)].join('|');`,
`const collectionReferenceKey=row=>{
  const voucher=voucherNo(row);
  return voucher?['collection','voucher',customerCode(row),voucher].join('|'):'';
};
const collectionKey=row=>{
  const reference=collectionReferenceKey(row);
  return reference
    ?[reference,amountToken(row)].join('|')
    :['collection','fallback',movementDate(row),customerCode(row),treasuryCode(row),
      norm(row?.movementType??row?.movement_type??row?.type),amountToken(row)].join('|');
};
const legacyCollectionKey=row=>{
  const reference=collectionReferenceKey(row);
  return reference
    ?[reference,amountToken(row)].join('|')
    :['collection','legacy-fallback',customerCode(row),treasuryCode(row),
      norm(row?.movementType??row?.movement_type??row?.type),amountToken(row)].join('|');
};`,
'collection keys'
);

replaceOnce(
`function duplicateCashConflicts(rows=[],legacyBaseline=false){
  const seen=new Map();
  const conflicts=[];
  for(const row of rows){
    const key=cashKey(row,legacyBaseline);
    if(!movementDate(row)&&!legacyBaseline){
      conflicts.push({type:'cash',key,reason:'حركة مالية بلا تاريخ'});
      continue;
    }
    if(isCollection(row)&&(!customerCode(row)||amountToken(row)==='0:0')){
      conflicts.push({type:'cash',key,reason:'سداد بلا رقم عميل أو مبلغ'});
      continue;
    }
    if(seen.has(key)){
      conflicts.push({type:'cash',key,voucher:voucherNo(row),reason:'السداد مكرر داخل الملف بنفس التاريخ ورقم العميل والمبلغ'});
    }else{
      seen.set(key,row);
    }
  }
  return conflicts;
}`,
`function duplicateCashConflicts(rows=[],legacyBaseline=false){
  const seen=new Map();
  const seenReferences=new Map();
  const conflicts=[];
  for(const row of rows){
    const key=cashKey(row,legacyBaseline);
    if(!movementDate(row)&&!legacyBaseline){
      conflicts.push({type:'cash',key,reason:'حركة مالية بلا تاريخ'});
      continue;
    }
    if(isCollection(row)&&(!customerCode(row)||amountToken(row)==='0:0')){
      conflicts.push({type:'cash',key,reason:'سداد بلا رقم عميل أو مبلغ'});
      continue;
    }
    if(seen.has(key)){
      conflicts.push({type:'cash',key,voucher:voucherNo(row),reason:'السداد مكرر داخل الملف بنفس رقم العميل والسند والمبلغ'});
      continue;
    }
    seen.set(key,row);
    if(isCollection(row)&&collectionReferenceKey(row)){
      const reference=collectionReferenceKey(row),previous=seenReferences.get(reference);
      if(previous&&amountToken(previous)!==amountToken(row)){
        conflicts.push({
          type:'cash',key:reference,voucher:voucherNo(row),
          reason:'نفس العميل ورقم السند داخل الملف يحملان مبلغين مختلفين'
        });
      }else if(!previous){
        seenReferences.set(reference,row);
      }
    }
  }
  return conflicts;
}

export function normalizeSingleDayAnalysis(analysis={},reportDate){
  const date=clean(reportDate,10);
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))return analysis;
  const cashMovements=(analysis.cashMovements||[]).map(row=>
    movementDate(row)?row:{...row,movementDate:date,reportDate:date}
  );
  const normalized={
    ...analysis,
    cashMovements,
    collections:cashMovements.filter(isCollection),
    reportDates:[...new Set([...(analysis.reportDates||[]),date])].sort()
  };
  normalized.summary=summarize(normalized);
  return normalized;
}`,
'duplicate cash validation and normalization'
);

replaceOnce(
`  const currentCashIndex=indexRows(currentCash,row=>cashKey(row,legacyBaseline));
  const historicalCashIndex=indexRows(historicalCash,row=>cashKey(row,legacyBaseline));`,
`  const currentCashIndex=indexRows(currentCash,row=>cashKey(row,legacyBaseline));
  const historicalCashIndex=indexRows(historicalCash,row=>cashKey(row,legacyBaseline));
  const currentReferenceIndex=indexRows(
    currentCash.filter(row=>isCollection(row)&&collectionReferenceKey(row)),
    collectionReferenceKey
  );
  const historicalReferenceIndex=indexRows(
    historicalCash.filter(row=>isCollection(row)&&collectionReferenceKey(row)),
    collectionReferenceKey
  );`,
'cash reference indexes'
);

replaceOnce(
`    if(!chosen){
      const historicalCandidates=(historicalCashIndex.get(key)||[]).filter(item=>!usedCash.has(item.id));
      chosen=chooseCashCandidate(historicalCandidates,row);
      scope='historical';
    }
    if(!chosen){
      missingCash.push(row);
      continue;
    }`,
`    if(!chosen){
      const historicalCandidates=(historicalCashIndex.get(key)||[]).filter(item=>!usedCash.has(item.id));
      chosen=chooseCashCandidate(historicalCandidates,row);
      scope='historical';
    }
    if(!chosen&&isCollection(row)&&collectionReferenceKey(row)){
      const reference=collectionReferenceKey(row);
      const referenceCandidates=[
        ...(currentReferenceIndex.get(reference)||[]),
        ...(historicalReferenceIndex.get(reference)||[])
      ].filter(item=>!usedCash.has(item.id));
      if(referenceCandidates.length){
        conflicts.push({
          type:'cash',key:reference,voucher:voucherNo(row),
          reason:'السند موجود للعميل نفسه بقيمة مختلفة'
        });
        continue;
      }
    }
    if(!chosen){
      missingCash.push(row);
      continue;
    }`,
'voucher conflict lookup'
);

replaceOnce(
`    const reportDate=resolveReportDate(req,workbook,originalName,analysis);
    const storagePath=\`erp-folder/\${reportDate}/\${hash.slice(0,16)}-\${safeFile(originalName)}\`;`,
`    const reportDate=resolveReportDate(req,workbook,originalName,analysis);
    const effectiveAnalysis=normalizeSingleDayAnalysis(analysis,reportDate);
    const storagePath=\`erp-folder/\${reportDate}/\${hash.slice(0,16)}-\${safeFile(originalName)}\`;`,
'single-day effective analysis'
);
replaceOnce(
`    const summary={sheetNames:workbook.SheetNames,daily:analysis.summary,source:{kind:'erp-folder',classification}};`,
`    const summary={sheetNames:workbook.SheetNames,daily:effectiveAnalysis.summary,source:{kind:'erp-folder',classification}};`,
'single-day summary'
);
replaceOnce(
`        batch,incoming:analysis,imp,reportDate,sourceHash:hash,legacyBaseline:false`,
`        batch,incoming:effectiveAnalysis,imp,reportDate,sourceHash:hash,legacyBaseline:false`,
'existing day normalized input'
);
replaceOnce(
`        reportDate,fileHash:hash,importId:imp.id,summary:analysis.summary,`,
`        reportDate,fileHash:hash,importId:imp.id,summary:effectiveAnalysis.summary,`,
'existing day normalized response'
);
replaceOnce(
`    const result=await processNewDay({incoming:analysis,imp,reportDate,dayHash:hash,dayName:originalName});`,
`    const result=await processNewDay({incoming:effectiveAnalysis,imp,reportDate,dayHash:hash,dayName:originalName});`,
'new day normalized input'
);

await writeFile(target,source);
await writeFile(entry,`export { default } from '../_lib/daily-report-v7.js';\nexport * from '../_lib/daily-report-v7.js';\nexport { dailyParserEvidence,historicalSalesCompatibility,payloadFromAnalysis,postingDateForTransaction,resolveReportDate,splitAggregatedAnalysis } from '../_lib/daily-report-v3.js';\n`);

console.log('ERP R2 patch applied');
