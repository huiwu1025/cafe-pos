begin;

create table if not exists public.manual_daily_reports (
  business_date date primary key,
  guest_count integer not null default 0,
  product_revenue numeric(12,2) not null default 0,
  cash_income numeric(12,2) not null default 0,
  transfer_income numeric(12,2) not null default 0,
  other_income numeric(12,2) not null default 0,
  tip_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  complimentary_amount numeric(12,2) not null default 0,
  refund_amount numeric(12,2) not null default 0,
  product_cost numeric(12,2) not null default 0,
  reconciliation_diff numeric(12,2) not null default 0,
  rent_amount numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_manual_daily_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_manual_daily_reports_updated_at on public.manual_daily_reports;
create trigger trg_manual_daily_reports_updated_at
before update on public.manual_daily_reports
for each row
execute function public.set_manual_daily_reports_updated_at();

alter table public.manual_daily_reports enable row level security;

drop policy if exists "public read manual daily reports" on public.manual_daily_reports;
create policy "public read manual daily reports"
on public.manual_daily_reports
for select
using (true);

drop policy if exists "public insert manual daily reports" on public.manual_daily_reports;
create policy "public insert manual daily reports"
on public.manual_daily_reports
for insert
with check (true);

drop policy if exists "public update manual daily reports" on public.manual_daily_reports;
create policy "public update manual daily reports"
on public.manual_daily_reports
for update
using (true)
with check (true);

drop policy if exists "public delete manual daily reports" on public.manual_daily_reports;
create policy "public delete manual daily reports"
on public.manual_daily_reports
for delete
using (true);

commit;
