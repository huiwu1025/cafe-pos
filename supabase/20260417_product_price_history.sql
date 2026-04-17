begin;

create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(12,2) not null check (price >= 0),
  effective_from date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, effective_from)
);

create index if not exists idx_product_price_history_product_date
  on public.product_price_history (product_id, effective_from desc);

create or replace function public.set_product_price_history_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_product_price_history_updated_at on public.product_price_history;
create trigger trg_product_price_history_updated_at
before update on public.product_price_history
for each row
execute function public.set_product_price_history_updated_at();

alter table public.product_price_history enable row level security;

drop policy if exists "public read product price history" on public.product_price_history;
create policy "public read product price history"
on public.product_price_history
for select
using (true);

drop policy if exists "public insert product price history" on public.product_price_history;
create policy "public insert product price history"
on public.product_price_history
for insert
with check (true);

drop policy if exists "public update product price history" on public.product_price_history;
create policy "public update product price history"
on public.product_price_history
for update
using (true)
with check (true);

drop policy if exists "public delete product price history" on public.product_price_history;
create policy "public delete product price history"
on public.product_price_history
for delete
using (true);

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 160, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '蜂蜜鮮奶茶'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 160, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '黑糖鮮奶茶'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 140, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '焙茶牛奶'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 140, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '抹茶牛奶'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 120, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '鮮奶茶'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 120, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '手沖咖啡'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 140, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '日式咖啡歐蕾'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 60, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '紅茶'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 120, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '洋甘菊玫瑰'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 120, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '薄荷檸檬草'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

insert into public.product_price_history (product_id, price, effective_from, note)
select id, 120, date '2026-04-18', '2026-04-18 菜單調價'
from public.products
where name = '薰衣草花茶'
on conflict (product_id, effective_from) do update
set price = excluded.price,
    note = excluded.note;

commit;
