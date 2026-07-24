begin;

-- 027_daily_report_digest_search_path_fix
--
-- المشكلة الجذرية لفشل اعتماد التقرير اليومي (POST /api/daily-report → 502):
--   commit_daily_report_acceptance يُدرج أسطر المبيعات/التحصيلات، فتُطلق مُشغّلات
--   BEFORE INSERT التي تستدعي daily_sale_identity / daily_cash_identity لحساب
--   line_identity عبر digest(...,'sha256') من امتداد pgcrypto. هاتان الدالتان
--   تعملان ضمن search_path لا يضمن الوصول إلى مخطط extensions على Supabase،
--   فيفشل الحل بخطأ 42883: function digest(text, unknown) does not exist.
--
-- الإصلاح النهائي: استدعاء extensions.digest صراحةً وتثبيت search_path آمن.
-- قيمة SHA-256 الناتجة مطابقة للتعريف السابق، لذلك لا تتغير هويات الأسطر القائمة.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.daily_sale_identity(
  p_invoice_no text,
  p_customer_code text,
  p_sales_type text,
  p_quantity numeric,
  p_amount numeric
)
returns text
language sql
immutable
set search_path=pg_catalog,public,extensions
as $$
  select encode(
    extensions.digest(
      concat_ws(
        '|',
        trim(coalesce(p_invoice_no,'')),
        trim(coalesce(p_customer_code,'')),
        trim(coalesce(p_sales_type,'')),
        round(coalesce(p_quantity,0),3)::text,
        round(coalesce(p_amount,0),2)::text
      ),
      'sha256'::text
    ),
    'hex'
  );
$$;

create or replace function public.daily_cash_identity(
  p_treasury_code text,
  p_account_code text,
  p_voucher_no text,
  p_movement_type text,
  p_debit numeric,
  p_credit numeric,
  p_movement_date_text text
)
returns text
language sql
immutable
set search_path=pg_catalog,public,extensions
as $$
  select encode(
    extensions.digest(
      concat_ws(
        '|',
        trim(coalesce(p_treasury_code,'')),
        trim(coalesce(p_account_code,'')),
        trim(coalesce(p_voucher_no,'')),
        trim(coalesce(p_movement_type,'')),
        round(coalesce(p_debit,0),2)::text,
        round(coalesce(p_credit,0),2)::text,
        trim(coalesce(p_movement_date_text,''))
      ),
      'sha256'::text
    ),
    'hex'
  );
$$;

revoke all on function public.daily_sale_identity(text,text,text,numeric,numeric) from anon,authenticated;
revoke all on function public.daily_cash_identity(text,text,text,text,numeric,numeric,text) from anon,authenticated;

insert into public.migration_history(version,migration_name)
values(27,'027_daily_report_digest_search_path_fix')
on conflict(version) do update set migration_name=excluded.migration_name;

commit;
