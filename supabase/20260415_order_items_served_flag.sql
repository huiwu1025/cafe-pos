begin;

alter table public.order_items
add column if not exists is_served boolean not null default false;

update public.order_items
set is_served = false
where is_served is null;

commit;
