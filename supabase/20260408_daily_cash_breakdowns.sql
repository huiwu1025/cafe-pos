begin;

alter table public.daily_cash_counts
  add column if not exists opening_breakdown jsonb,
  add column if not exists closing_breakdown jsonb;

commit;
