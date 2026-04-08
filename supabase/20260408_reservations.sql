begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_code text not null unique,
  reservation_name text not null,
  reservation_phone text not null,
  reservation_date date not null,
  reservation_time time not null,
  guest_count integer not null default 1 check (guest_count > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'arrived', 'completed', 'cancelled', 'no_show')),
  notes text,
  converted_session_id uuid references public.dining_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservation_seats (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  seat_id uuid not null references public.seats(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (reservation_id, seat_id)
);

create index if not exists idx_reservations_date_time
  on public.reservations (reservation_date, reservation_time);

create index if not exists idx_reservations_status
  on public.reservations (status);

create index if not exists idx_reservation_seats_reservation_id
  on public.reservation_seats (reservation_id);

create index if not exists idx_reservation_seats_seat_id
  on public.reservation_seats (seat_id);

drop trigger if exists trg_reservations_updated_at on public.reservations;
create trigger trg_reservations_updated_at
before update on public.reservations
for each row
execute function public.set_updated_at();

create or replace function public.generate_reservation_code()
returns trigger
language plpgsql
as $$
declare
  next_code text;
begin
  if new.reservation_code is not null and length(trim(new.reservation_code)) > 0 then
    return new;
  end if;

  next_code :=
    'R' ||
    to_char(coalesce(new.reservation_date, current_date), 'YYYYMMDD') ||
    '-' ||
    lpad(floor(random() * 10000)::text, 4, '0');

  new.reservation_code = next_code;
  return new;
end;
$$;

drop trigger if exists trg_generate_reservation_code on public.reservations;
create trigger trg_generate_reservation_code
before insert on public.reservations
for each row
execute function public.generate_reservation_code();

create or replace function public.prevent_overlapping_reservations()
returns trigger
language plpgsql
as $$
declare
  seat_count integer;
begin
  select count(*)
  into seat_count
  from public.reservation_seats rs
  join public.reservations r on r.id = rs.reservation_id
  where rs.seat_id = new.seat_id
    and r.status = 'reserved'
    and r.reservation_date = (
      select reservation_date
      from public.reservations
      where id = new.reservation_id
    )
    and r.reservation_time = (
      select reservation_time
      from public.reservations
      where id = new.reservation_id
    )
    and r.id <> new.reservation_id;

  if seat_count > 0 then
    raise exception '此座位在相同預約時段已被保留';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_overlapping_reservations on public.reservation_seats;
create trigger trg_prevent_overlapping_reservations
before insert on public.reservation_seats
for each row
execute function public.prevent_overlapping_reservations();

alter table public.reservations enable row level security;
alter table public.reservation_seats enable row level security;

drop policy if exists "public read reservations" on public.reservations;
create policy "public read reservations"
on public.reservations
for select
using (true);

drop policy if exists "public insert reservations" on public.reservations;
create policy "public insert reservations"
on public.reservations
for insert
with check (true);

drop policy if exists "public update reservations" on public.reservations;
create policy "public update reservations"
on public.reservations
for update
using (true)
with check (true);

drop policy if exists "public delete reservations" on public.reservations;
create policy "public delete reservations"
on public.reservations
for delete
using (true);

drop policy if exists "public read reservation seats" on public.reservation_seats;
create policy "public read reservation seats"
on public.reservation_seats
for select
using (true);

drop policy if exists "public insert reservation seats" on public.reservation_seats;
create policy "public insert reservation seats"
on public.reservation_seats
for insert
with check (true);

drop policy if exists "public update reservation seats" on public.reservation_seats;
create policy "public update reservation seats"
on public.reservation_seats
for update
using (true)
with check (true);

drop policy if exists "public delete reservation seats" on public.reservation_seats;
create policy "public delete reservation seats"
on public.reservation_seats
for delete
using (true);

commit;
