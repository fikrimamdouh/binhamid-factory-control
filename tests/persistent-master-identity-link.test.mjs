import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { employeeRoleToAppRole,normalizeNationalId } from '../api/_lib/employee-identity-link.js';
import { parseUnifiedMasterWorkbook,normalizePlate } from '../api/_lib/master-data-workbook.js';

const sheet=rows=>XLSX.utils.aoa_to_sheet(rows);
const TEST_ID='12345678',TEST_ASSET='TEST-ASSET-01',TEST_PLATE='TST-0001';

test('employee role and identity normalization covers factory roles',()=>{
  assert.equal(normalizeNationalId('١٢٣-٤٥٦ ٧٨'),'12345678');
  assert.equal(employeeRoleToAppRole('سائق خلاطة'),'driver');
  assert.equal(employeeRoleToAppRole('مسؤول الديزل والأسطول'),'fuel_operator');
  assert.equal(employeeRoleToAppRole('مبيعات الخرسانة'),'concrete_sales');
  assert.equal(employeeRoleToAppRole('أمين مخزن'),'warehouse');
  assert.equal(employeeRoleToAppRole(''),'');
});

test('unified workbook keeps diesel as primary assignment and ERP as financial reference',()=>{
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet([
    ['المصدر','رقم الهوية / الإقامة','اسم الموظف','الراتب الأساسي','بدل السكن','بدل النقل','إجمالي راتب مدد','تابع للمصنع؟','الموقع','الوظيفة','الراتب الفعلي','الرقم الوظيفي','الجوال','الحالة','ملاحظات'],
    ['بيانات صناعية',TEST_ID,'موظف اختبار',400,600,500,1500,'نعم','موقع اختبار','سائق',1700,'EMP-TEST','','نشط','']
  ]),'الموظفون');
  XLSX.utils.book_append_sheet(workbook,sheet([
    ['اللوحة الموحدة','اللوحة كما وردت','اسم السائق/البطاقة','وصف المركبة','Column1','نوع الوقود','عدد التعبئات','إجمالي اللترات','إجمالي المبلغ','أول تعبئة','آخر تعبئة','ملاحظات'],
    [TEST_PLATE,TEST_PLATE,'موظف اختبار','مركبة اختبار','','Diesel',2,200,400,'','','']
  ]),'لوحات الديزل');
  XLSX.utils.book_append_sheet(workbook,sheet([
    ['رقم الأصل ERP','رقم اللوحة القديمة / التشغيل','الحالة الفعلية من ERP','نوع الأصل','المجموعة','الماركة والموديل','سنة الصنع','رقم الهيكل VIN','تكلفة الشراء','الحالة التشغيلية','الموقع','ملاحظات','اللوحة الجديدة / لوحة الديزل'],
    [TEST_ASSET,'0001','Working','قلاب اختبار','السيارات ووسائل النقل','طراز اختباري',2020,'VIN-TEST',350000,'غير محدد','موقع اختبار','',TEST_PLATE]
  ]),'الأصول الثابتة');
  XLSX.utils.book_append_sheet(workbook,sheet([
    ['قالب الربط الموحد'],['تعليمات'],[],[],
    ['إجراء الاستيراد','تابع للمصنع؟','رقم الهوية / الإقامة','اسم الموظف','الراتب الأساسي','بدل السكن','بدل النقل','إجمالي راتب مدد','الراتب الفعلي','الموقع','الوظيفة','لوحة الديزل','اسم بطاقة الوقود','وصف المركبة بالديزل','نوع الوقود','رقم الأصل ERP','لوحة الأصل / التشغيل','نوع الأصل','المجموعة','الماركة والموديل','تكلفة الشراء','حالة المطابقة','تاريخ بداية الربط','نسبة تحميل الراتب %','ملاحظات'],
    ['تحديث/إنشاء','نعم',TEST_ID,'موظف اختبار',400,600,500,1500,1700,'موقع اختبار','سائق',TEST_PLATE,'','','Diesel',TEST_ASSET,'','قلاب اختبار','','',350000,'مطابق','2026-01-01',100,'']
  ]),'الربط الموحد');
  const parsed=parseUnifiedMasterWorkbook(workbook,XLSX);
  const diesel=parsed.assets.find(asset=>asset.dieselExpected===true);
  const erp=parsed.assets.find(asset=>asset.assetNo===TEST_ASSET&&asset.dieselExpected===false);
  assert.equal(parsed.stats.employees,1);
  assert.equal(parsed.stats.linkedAssets,1);
  assert.equal(diesel.assignedNationalId,TEST_ID);
  assert.equal(normalizePlate(diesel.plateNo),'TST0001');
  assert.equal(diesel.metadata.erpReference.assetNo,TEST_ASSET);
  assert.equal(diesel.metadata.erpReference.purchaseCost,350000);
  assert.equal(erp.assignedNationalId,null);
  assert.equal(erp.operationalStatus,'in_service');
  assert.equal(parsed.employees[0].role,'سائق');
});

test('invitation flow asks for identity and keeps legacy fallback',async()=>{
  const source=await readFile(new URL('../api/_lib/bot-invitations.js',import.meta.url),'utf8');
  assert.match(source,/invitation_national_id/);
  assert.match(source,/resolveEmployeeIdentity/);
  assert.match(source,/identity-auto/);
  assert.match(source,/useLegacyInvitationFlow/);
  assert.match(source,/employeeAssetsSummary/);
});

test('migration keeps master data persistent and synchronized',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/026_persistent_employee_asset_identity_link.sql',import.meta.url),'utf8');
  for(const marker of ['master_data_import_runs','employee_asset_directory','guard_employee_national_id','sync_unified_asset_to_vehicle','unified_assets_employee_active_idx'])assert.match(sql,new RegExp(marker));
  assert.doesNotMatch(sql,/truncate/i);
});
