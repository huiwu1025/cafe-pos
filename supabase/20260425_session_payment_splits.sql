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

create table if not exists public.session_payment_splits (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dining_sessions(id) on delete cascade,
  split_label text,
  payment_method text not null,
  amount numeric(12,2) not null default 0,
  amount_received numeric(12,2),
  change_amount numeric(12,2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_session_payment_splits_session_id
  on public.session_payment_splits(session_id, sort_order, created_at);

drop trigger if exists trg_session_payment_splits_updated_at on public.session_payment_splits;
create trigger trg_session_payment_splits_updated_at
before update on public.session_payment_splits
for each row
execute function public.set_updated_at();

alter table public.session_payment_splits enable row level security;

drop policy if exists "public read session payment splits" on public.session_payment_splits;
create policy "public read session payment splits"
on public.session_payment_splits
for select
using (true);

drop policy if exists "public insert session payment splits" on public.session_payment_splits;
create policy "public insert session payment splits"
on public.session_payment_splits
for insert
with check (true);

drop policy if exists "public update session payment splits" on public.session_payment_splits;
create policy "public update session payment splits"
on public.session_payment_splits
for update
using (true)
with check (true);

drop policy if exists "public delete session payment splits" on public.session_payment_splits;
create policy "public delete session payment splits"
on public.session_payment_splits
for delete
using (true);

commit;
