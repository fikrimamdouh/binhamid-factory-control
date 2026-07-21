-- 025: جدول مستقل للأرصدة الافتتاحية للعملاء
-- الأرصدة كانت مضمّنة داخل سجل الحالة الموحد (3MB) فصار حفظها يتجاوز مهلة
-- الاستعلام في قاعدة البيانات ويُفشل كل مزامنة. بجدول مستقل تُرفع الأرصدة
-- على دفعات صغيرة سريعة، ويقرؤها البوت مباشرة، ولا تُمحى بمزامنة جهاز فارغ.

create table if not exists public.customer_opening_balances (
  customer_code text primary key,
  customer_name text not null default '',
  client_id text,
  balance numeric not null default 0,
  previous numeric not null default 0,
  debit numeric not null default 0,
  credit numeric not null default 0,
  cheques numeric not null default 0,
  difference numeric not null default 0,
  balance_date text,
  source_file text,
  updated_at timestamptz not null default now()
);

alter table public.customer_opening_balances enable row level security;
-- لا سياسات: الوصول عبر مفتاح الخدمة فقط، كسائر جداول النظام.

create index if not exists customer_opening_balances_balance_idx
  on public.customer_opening_balances (balance desc);

insert into public.migration_history(version,migration_name)
values (25,'customer_opening_balances_table')
on conflict (version) do nothing;
