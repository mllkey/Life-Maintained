-- Concurrency guard for AI schedule generation. Closes the TOCTOU race where
-- multiple client surfaces trigger generate-maintenance-schedule near-simultaneously,
-- each passing the existing-tasks check and inserting a full duplicate schedule.

create table if not exists public.schedule_generation_locks (
  vehicle_id  uuid primary key,
  lock_token  uuid not null,
  locked_at   timestamptz not null default now()
);

-- Defensive for any partially-created prior version of the table.
alter table public.schedule_generation_locks
  add column if not exists lock_token uuid;

alter table public.schedule_generation_locks enable row level security;
-- No policies: only SECURITY DEFINER functions called with service_role should touch this.

-- Atomically claim generation for a vehicle.
-- Returns the caller's lock token when acquired, or null when another fresh claim exists.
create or replace function public.claim_schedule_generation(
  p_vehicle_id   uuid,
  p_lock_token   uuid,
  p_ttl_seconds  integer default 180
)
returns uuid
language sql
security definer
set search_path = public
as $$
  with upsert as (
    insert into public.schedule_generation_locks (vehicle_id, lock_token, locked_at)
    values (p_vehicle_id, p_lock_token, now())
    on conflict (vehicle_id) do update
      set lock_token = excluded.lock_token,
          locked_at  = excluded.locked_at
      where public.schedule_generation_locks.locked_at
            < now() - make_interval(secs => p_ttl_seconds)
    returning lock_token
  )
  select lock_token from upsert;
$$;

-- Release only the caller's own claim. Prevents a stale invocation that outlived the
-- TTL (and had its lock stolen) from deleting the newer invocation's lock.
create or replace function public.release_schedule_generation(
  p_vehicle_id uuid,
  p_lock_token uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.schedule_generation_locks
    where vehicle_id = p_vehicle_id
      and lock_token = p_lock_token
    returning vehicle_id
  )
  select exists (select 1 from deleted);
$$;

revoke all on function public.claim_schedule_generation(uuid, uuid, integer) from public;
revoke all on function public.release_schedule_generation(uuid, uuid)        from public;

grant execute on function public.claim_schedule_generation(uuid, uuid, integer) to service_role;
grant execute on function public.release_schedule_generation(uuid, uuid)        to service_role;
