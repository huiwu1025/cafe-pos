begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.manual_procurements (
  id uuid primary key default gen_random_uuid(),
  purchase_date date not null,
  item_name text not null,
  type text not null,
  unit_price numeric(12,2) not null default 0,
  quantity integer not null default 1,
  shipping_fee numeric(12,2) not null default 0,
  supplier text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_manual_procurements_purchase_date
  on public.manual_procurements(purchase_date, created_at);

drop trigger if exists trg_manual_procurements_updated_at on public.manual_procurements;
create trigger trg_manual_procurements_updated_at
before update on public.manual_procurements
for each row
execute function public.set_updated_at();

alter table public.manual_procurements enable row level security;

drop policy if exists "public read manual procurements" on public.manual_procurements;
create policy "public read manual procurements"
on public.manual_procurements
for select
using (true);

drop policy if exists "public insert manual procurements" on public.manual_procurements;
create policy "public insert manual procurements"
on public.manual_procurements
for insert
with check (true);

drop policy if exists "public update manual procurements" on public.manual_procurements;
create policy "public update manual procurements"
on public.manual_procurements
for update
using (true)
with check (true);

drop policy if exists "public delete manual procurements" on public.manual_procurements;
create policy "public delete manual procurements"
on public.manual_procurements
for delete
using (true);

commit;
