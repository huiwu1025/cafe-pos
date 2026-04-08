begin;

create extension if not exists pgcrypto;

create table if not exists public.daily_cash_counts (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  opening_cash numeric(10, 2),
  opening_notes text,
  opening_counted_at timestamptz,
  closing_cash numeric(10, 2),
  closing_notes text,
  closing_counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_daily_cash_counts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_daily_cash_counts_updated_at on public.daily_cash_counts;
create trigger trg_touch_daily_cash_counts_updated_at
before update on public.daily_cash_counts
for each row
execute function public.touch_daily_cash_counts_updated_at();

alter table public.daily_cash_counts enable row level security;

drop policy if exists "public read daily cash counts" on public.daily_cash_counts;
create policy "public read daily cash counts"
on public.daily_cash_counts
for select
using (true);

drop policy if exists "public insert daily cash counts" on public.daily_cash_counts;
create policy "public insert daily cash counts"
on public.daily_cash_counts
for insert
with check (true);

drop policy if exists "public update daily cash counts" on public.daily_cash_counts;
create policy "public update daily cash counts"
on public.daily_cash_counts
for update
using (true)
with check (true);

drop policy if exists "public delete daily cash counts" on public.daily_cash_counts;
create policy "public delete daily cash counts"
on public.daily_cash_counts
for delete
using (true);

commit;
