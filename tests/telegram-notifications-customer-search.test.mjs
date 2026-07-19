import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('owner can compose preview and confirm system notifications from Telegram',async()=>{
  const [notifications,enterprise]=await Promise.all([read('api/_lib/bot-user-notifications.js'),read('api/_lib/bot-enterprise.js')]);
  for(const marker of ['system_notification_compose','system_notification_confirm','notification_confirm','user_channels','system_notification_sent','إشعار النظام'])assert.ok(notifications.includes(marker),`missing ${marker}`);
  for(const marker of ['handleSystemNotificationTextCommand','continueSystemNotificationSession','handleSystemNotificationCallback','notification_start'])assert.ok(enterprise.includes(marker),`missing route ${marker}`);
});

test('customer name search returns selectable account numbers and formatted statement',async()=>{
  const [search,enterprise,data]=await Promise.all([read('api/_lib/bot-customer-search.js'),read('api/_lib/bot-enterprise.js'),read('api/_lib/bot-customer-report-data.js')]);
  for(const marker of ['enterprise_customer_choose','customer_pick|','رقم الحساب','كشف حساب عميل — مصنع بن حامد','الحركات المعتمدة من التقرير اليومي تظهر تلقائيًا'])assert.ok(search.includes(marker),`missing ${marker}`);
  for(const marker of ['handleSelectableCustomerTextCommand','continueSelectableCustomerSession','handleSelectableCustomerCallback'])assert.ok(enterprise.includes(marker),`missing route ${marker}`);
  for(const marker of ["pagedSelect('sales_orders'","pagedSelect('collection_events'",'openingBalances:openingRows(payload)'])assert.ok(data.includes(marker),`daily ledger source missing ${marker}`);
});
