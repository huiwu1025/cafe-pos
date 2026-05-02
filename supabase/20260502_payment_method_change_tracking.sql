alter table public.dining_sessions
add column if not exists payment_method_changed_at timestamptz;
