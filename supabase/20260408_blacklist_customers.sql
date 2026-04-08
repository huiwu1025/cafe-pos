begin;

create extension if not exists pgcrypto;

create table if not exists public.blacklist_customers (
  id uuid primary key default gen_random_uuid(),
  customer_name text,
  customer_phone text,
  strike_count integer not null default 1 check (strike_count > 0),
  last_reason text not null default 'no_show',
  last_flagged_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_blacklist_customers_name
  on public.blacklist_customers (customer_name);

create index if not exists idx_blacklist_customers_phone
  on public.blacklist_customers (customer_phone);

create unique index if not exists uniq_blacklist_customers_phone
  on public.blacklist_customers (customer_phone)
  where customer_phone is not null and length(trim(customer_phone)) > 0;

create or replace function public.touch_blacklist_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_blacklist_updated_at on public.blacklist_customers;
create trigger trg_touch_blacklist_updated_at
before update on public.blacklist_customers
for each row
execute function public.touch_blacklist_updated_at();

alter table public.blacklist_customers enable row level security;

drop policy if exists "public read blacklist customers" on public.blacklist_customers;
create policy "public read blacklist customers"
on public.blacklist_customers
for select
using (true);

drop policy if exists "public insert blacklist customers" on public.blacklist_customers;
create policy "public insert blacklist customers"
on public.blacklist_customers
for insert
with check (true);

drop policy if exists "public update blacklist customers" on public.blacklist_customers;
create policy "public update blacklist customers"
on public.blacklist_customers
for update
using (true)
with check (true);

drop policy if exists "public delete blacklist customers" on public.blacklist_customers;
create policy "public delete blacklist customers"
on public.blacklist_customers
for delete
using (true);

commit;
