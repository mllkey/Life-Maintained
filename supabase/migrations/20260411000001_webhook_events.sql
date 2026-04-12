create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_id text not null,
  event_type text not null,
  app_user_id text,
  payload jsonb not null,
  status text not null default 'received',
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (source, event_id)
);

create index if not exists webhook_events_app_user_id_idx on public.webhook_events (app_user_id);
create index if not exists webhook_events_received_at_idx on public.webhook_events (received_at desc);
create index if not exists webhook_events_status_idx on public.webhook_events (status) where status != 'processed';

alter table public.webhook_events enable row level security;
-- No policies. Service role bypasses RLS.
