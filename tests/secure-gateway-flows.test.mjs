import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('webhook gateway intercepts every role-sensitive callback and session',async()=>{
  const gateway=await read('api/_lib/telegram-webhook-gateway.js');
  for(const marker of ['procurementActions','guidedSalesActions','home&&value===\'suppliers\'','home&&value===\'sales\'','home&&value===\'workshop\'','home&&value===\'attendance\'','action===\'gps\'','action===\'sales_confirm\'','action===\'parts_confirm\'','fuelconfirm','sensitiveSession','sessionAllowed','rejectSession'])assert.ok(gateway.includes(marker),`missing gateway marker ${marker}`);
  assert.match(gateway,/storeTelegramMessage/);
  assert.match(gateway,/req\.body=update;return enterpriseHandler/);
});

test('procurement wrapper includes specialist roles and direct RFQ visibility',async()=>{
  const secure=await read('api/_lib/bot-procurement-secure.js');
  const migration=await read('supabase/migrations/007_procurement_projection_and_permissions.sql');
  assert.match(secure,/procurement/);
  assert.match(secure,/warehouse/);
  assert.match(secure,/purchase_requests/);
  assert.match(secure,/continueProcurementSession/);
  assert.match(secure,/handleProcurementCallback/);
  assert.match(migration,/project_supplier_quote_request/);
  assert.match(migration,/ref,'rfq'/);
  assert.match(migration,/supplier_quote_request_projection_trigger/);
  assert.match(migration,/update public\.audit_log set details=details where action='supplier_quote_request'/);
});

test('sales wrapper revalidates department before continuation and confirmation',async()=>{
  const secure=await read('api/_lib/bot-sales-secure.js');
  for(const marker of ['VIEW_ROLES','CREATE_ROLES','UPDATE_ROLES','roleType','typeAllowed','continueSalesSession','confirmSalesOrder','continueGuidedSales','handleGuidedSalesCallback'])assert.match(secure,new RegExp(marker));
  assert.match(secure,/block_sales/);
  assert.match(secure,/concrete_sales/);
  assert.match(secure,/sessionType/);
});

test('workshop and attendance wrappers revalidate permissions in every step',async()=>{
  const workshop=await read('api/_lib/bot-mechanic-secure.js');
  const attendance=await read('api/_lib/bot-attendance-secure.js');
  for(const marker of ['VIEW_ROLES','OPERATOR_ROLES','continueMechanicSession','confirmSparePartsRequest'])assert.match(workshop,new RegExp(marker));
  for(const marker of ['ATTENDANCE_ROLES','DRIVER_ROLES','MANAGER_ROLES','continueAttendanceSession','handleAttendanceLocation','handleAttendancePhoto','handleAttendanceCallback'])assert.match(attendance,new RegExp(marker));
  assert.match(attendance,/driver_fuel_photo/);
  assert.match(attendance,/fuelconfirm/);
});

test('GPS enforces role and limits a driver to the assigned vehicle',async()=>{
  const gps=await read('api/_lib/bot-gps.js');
  assert.match(gps,/GPS_ROLES/);
  assert.match(gps,/employee_assignments/);
  assert.match(gps,/identity\.role==='driver'/);
  assert.match(gps,/vehicle_external_id/);
  assert.match(gps,/المركبة المرتبطة بك غير مطابقة/);
});
