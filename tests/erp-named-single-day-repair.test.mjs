import test from 'node:test';
import assert from 'node:assert/strict';

const modulePath=new URL('../api/_lib/daily-report-v9.js',import.meta.url);

test('extracts the authoritative date only from an explicitly named daily report',async()=>{
  const { singleDayFilenameDate }=await import(modulePath);
  assert.equal(singleDayFilenameDate('Daily-Report-2026-08-01.xlsx'),'2026-08-01');
  assert.equal(singleDayFilenameDate('Daily-Report-2026-08-01-20260802-080502.xlsx'),'2026-08-01');
  assert.equal(singleDayFilenameDate('19-26-20260728.xlsx'),'');
});

test('repairs only a named daily file that has multiple detected dates and undated cash rows',async()=>{
  const { shouldRepairNamedSingleDay }=await import(modulePath);
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-07-31','2026-08-01'],cashMovements:[{movementDate:''}]},'2026-08-01'),true);
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-08-01'],cashMovements:[{movementDate:''}]},'2026-08-01'),false);
  assert.equal(shouldRepairNamedSingleDay({reportDates:['2026-07-31','2026-08-01'],cashMovements:[{movementDate:'2026-08-01'}]},'2026-08-01'),false);
});
