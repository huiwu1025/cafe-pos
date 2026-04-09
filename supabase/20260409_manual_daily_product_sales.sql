begin;

create table if not exists public.manual_daily_product_sales (
  business_date date not null,
  product_name text not null,
  quantity integer not null default 0,
  sales_amount numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_date, product_name)
);

create or replace function public.set_manual_daily_product_sales_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_manual_daily_product_sales_updated_at on public.manual_daily_product_sales;
create trigger trg_manual_daily_product_sales_updated_at
before update on public.manual_daily_product_sales
for each row
execute function public.set_manual_daily_product_sales_updated_at();

alter table public.manual_daily_product_sales enable row level security;

drop policy if exists "public read manual daily product sales" on public.manual_daily_product_sales;
create policy "public read manual daily product sales"
on public.manual_daily_product_sales
for select
using (true);

drop policy if exists "public insert manual daily product sales" on public.manual_daily_product_sales;
create policy "public insert manual daily product sales"
on public.manual_daily_product_sales
for insert
with check (true);

drop policy if exists "public update manual daily product sales" on public.manual_daily_product_sales;
create policy "public update manual daily product sales"
on public.manual_daily_product_sales
for update
using (true)
with check (true);

drop policy if exists "public delete manual daily product sales" on public.manual_daily_product_sales;
create policy "public delete manual daily product sales"
on public.manual_daily_product_sales
for delete
using (true);

commit;
