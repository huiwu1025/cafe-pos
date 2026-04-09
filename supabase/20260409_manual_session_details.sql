begin;

create table if not exists public.manual_session_details (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  session_number text not null,
  created_at timestamptz,
  guest_count integer not null default 0,
  order_status text not null default 'closed',
  payment_status text not null default 'paid',
  payment_method text,
  subtotal_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  customer_type text,
  customer_label text,
  updated_at timestamptz not null default now(),
  unique (business_date, session_number)
);

create or replace function public.set_manual_session_details_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_manual_session_details_updated_at on public.manual_session_details;
create trigger trg_manual_session_details_updated_at
before update on public.manual_session_details
for each row
execute function public.set_manual_session_details_updated_at();

alter table public.manual_session_details enable row level security;

drop policy if exists "public read manual session details" on public.manual_session_details;
create policy "public read manual session details"
on public.manual_session_details
for select
using (true);

drop policy if exists "public insert manual session details" on public.manual_session_details;
create policy "public insert manual session details"
on public.manual_session_details
for insert
with check (true);

drop policy if exists "public update manual session details" on public.manual_session_details;
create policy "public update manual session details"
on public.manual_session_details
for update
using (true)
with check (true);

drop policy if exists "public delete manual session details" on public.manual_session_details;
create policy "public delete manual session details"
on public.manual_session_details
for delete
using (true);

commit;
