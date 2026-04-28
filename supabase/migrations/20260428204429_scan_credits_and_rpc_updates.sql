-- Group 2: receipt-scan migration.
-- Adds scan_credits durable balance table, links receipt_scans to credits,
-- updates reserve/fail RPCs to consume/refund credits, adds idempotent
-- grant_scan_pack_credits RPC for Scan Pack purchases.

BEGIN;

-- ============================================================================
-- scan_credits table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.scan_credits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('pack_10', 'pack_25')),
  transaction_id  text NOT NULL UNIQUE,
  scans_granted   integer NOT NULL CHECK (scans_granted > 0),
  scans_consumed  integer NOT NULL DEFAULT 0
                  CHECK (scans_consumed >= 0 AND scans_consumed <= scans_granted),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  exhausted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_scan_credits_user_unexhausted
  ON public.scan_credits (user_id, granted_at)
  WHERE exhausted_at IS NULL;

ALTER TABLE public.scan_credits ENABLE ROW LEVEL SECURITY;

-- Owner-only SELECT. All writes are RPC-only.
DROP POLICY IF EXISTS scan_credits_select_own ON public.scan_credits;
CREATE POLICY scan_credits_select_own ON public.scan_credits
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.scan_credits FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.scan_credits FROM authenticated;
GRANT SELECT ON public.scan_credits TO authenticated;

-- ============================================================================
-- receipt_scans.consumed_credit_id column
-- ============================================================================
ALTER TABLE public.receipt_scans
  ADD COLUMN IF NOT EXISTS consumed_credit_id uuid
    REFERENCES public.scan_credits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_scans_consumed_credit
  ON public.receipt_scans (consumed_credit_id)
  WHERE consumed_credit_id IS NOT NULL;

-- ============================================================================
-- reserve_receipt_scan — replaces existing function
-- Falls through to scan_credits when monthly subscription quota is at cap.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reserve_receipt_scan(
  p_request_id uuid,
  p_user_id    uuid,
  p_asset_type text,
  p_asset_id   uuid,
  p_source     text DEFAULT 'camera'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_existing       record;
  v_profile        record;
  v_asset_owned    boolean := false;
  v_active_count   int := 0;
  v_completed_count int := 0;
  v_monthly_limit  int := 0;
  v_user_id        uuid;
  v_credit         record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;

  if p_asset_type not in ('vehicle', 'property', 'health') then
    return jsonb_build_object('error', 'invalid_asset_type');
  end if;

  if p_source not in ('camera', 'photo_library') then
    return jsonb_build_object('error', 'invalid_source');
  end if;

  -- Idempotency: if request_id already exists, return its current state.
  select id, status, normalized_output
  into v_existing
  from public.receipt_scans
  where request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'request_id', p_request_id,
      'status', v_existing.status
    );
  end if;

  -- GC: timeout any of this users stale reserved/processing rows.
  update public.receipt_scans
  set status = 'timed_out',
      updated_at = now(),
      error_message = coalesce(error_message, 'Scan exceeded maximum processing time')
  where user_id = p_user_id
    and status in ('reserved', 'processing')
    and expires_at <= now();

  -- Refund credit on any timed-out scan that consumed one.
  -- FOR UPDATE SKIP LOCKED prevents two concurrent reservations from selecting
  -- the same timed-out row and double-refunding the credit.
  for v_existing in
    select id, consumed_credit_id
    from public.receipt_scans
    where user_id = p_user_id
      and status = 'timed_out'
      and consumed_credit_id is not null
      and updated_at >= now() - interval '1 minute'
    for update skip locked
  loop
    update public.scan_credits
    set scans_consumed = greatest(0, scans_consumed - 1),
        exhausted_at = case
          when scans_consumed - 1 < scans_granted then null
          else exhausted_at
        end
    where id = v_existing.consumed_credit_id;

    update public.receipt_scans
    set consumed_credit_id = null
    where id = v_existing.id;
  end loop;

  -- Lock profile row.
  select subscription_tier, trial_expires_at, subscription_expires_at
  into v_profile
  from public.profiles
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('error', 'profile_not_found');
  end if;

  -- Verify asset ownership.
  if p_asset_type = 'vehicle' then
    select exists(select 1 from public.vehicles where id = p_asset_id and user_id = p_user_id)
      into v_asset_owned;
  elsif p_asset_type = 'property' then
    select exists(select 1 from public.properties where id = p_asset_id and user_id = p_user_id)
      into v_asset_owned;
  elsif p_asset_type = 'health' then
    select exists(select 1 from public.health_profiles where id = p_asset_id and user_id = p_user_id)
      into v_asset_owned;
  end if;

  if not coalesce(v_asset_owned, false) then
    return jsonb_build_object('error', 'asset_not_found');
  end if;

  -- Single-flight: only one active reservation per user.
  select count(*) into v_active_count
  from public.receipt_scans
  where user_id = p_user_id
    and status in ('reserved', 'processing')
    and expires_at > now();

  if v_active_count > 0 then
    return jsonb_build_object('error', 'scan_in_progress');
  end if;

  -- Determine subscription quota.
  if v_profile.subscription_tier = 'trial'
     and v_profile.trial_expires_at is not null
     and v_profile.trial_expires_at > now() then
    v_monthly_limit := 5;
  elsif v_profile.subscription_tier = 'business'
     and v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > now() then
    v_monthly_limit := 100;
  elsif v_profile.subscription_tier = 'pro'
     and v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > now() then
    v_monthly_limit := 30;
  elsif v_profile.subscription_tier = 'personal'
     and v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > now() then
    v_monthly_limit := 15;
  else
    v_monthly_limit := 0;
  end if;

  if v_monthly_limit <= 0 then
    return jsonb_build_object('error', 'subscription_required');
  end if;

  -- Count completed scans this calendar month.
  select count(*) into v_completed_count
  from public.receipt_scans
  where user_id = p_user_id
    and status = 'completed'
    and created_at >= date_trunc('month', now());

  -- If under subscription cap, reserve a normal slot.
  if v_completed_count < v_monthly_limit then
    insert into public.receipt_scans (
      request_id, user_id, asset_type, asset_id, status, source, updated_at, expires_at
    ) values (
      p_request_id, p_user_id, p_asset_type, p_asset_id, 'reserved', p_source, now(), now() + interval '10 minutes'
    );

    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'request_id', p_request_id,
      'status', 'reserved',
      'scans_used', v_completed_count,
      'scans_limit', v_monthly_limit,
      'used_credit', false
    );
  end if;

  -- Subscription cap reached. Try to consume a scan_credit.
  select id, scans_granted, scans_consumed
  into v_credit
  from public.scan_credits
  where user_id = p_user_id
    and exhausted_at is null
    and scans_consumed < scans_granted
  order by granted_at asc
  limit 1
  for update skip locked;

  if not found then
    return jsonb_build_object(
      'error', 'quota_exceeded',
      'scans_used', v_completed_count,
      'scans_limit', v_monthly_limit
    );
  end if;

  -- Consume one credit.
  update public.scan_credits
  set scans_consumed = scans_consumed + 1,
      exhausted_at = case
        when scans_consumed + 1 >= scans_granted then now()
        else null
      end
  where id = v_credit.id;

  insert into public.receipt_scans (
    request_id, user_id, asset_type, asset_id, status, source,
    updated_at, expires_at, consumed_credit_id
  ) values (
    p_request_id, p_user_id, p_asset_type, p_asset_id, 'reserved', p_source,
    now(), now() + interval '10 minutes', v_credit.id
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'request_id', p_request_id,
    'status', 'reserved',
    'scans_used', v_completed_count,
    'scans_limit', v_monthly_limit,
    'used_credit', true
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) TO service_role;

-- ============================================================================
-- fail_receipt_scan — replaces existing function
-- Refunds the consumed credit when one was used.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fail_receipt_scan(
  p_request_id    uuid,
  p_user_id       uuid,
  p_error_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id          uuid;
  v_credit_id        uuid;
  v_rows             int := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;

  -- Capture the credit reference before flipping state, then null it.
  update public.receipt_scans
  set status = 'failed',
      error_message = p_error_message,
      updated_at = now(),
      consumed_credit_id = null
  where request_id = p_request_id
    and user_id = p_user_id
    and status in ('reserved', 'processing')
  returning consumed_credit_id into v_credit_id;

  get diagnostics v_rows = row_count;

  if v_rows > 0 and v_credit_id is not null then
    update public.scan_credits
    set scans_consumed = greatest(0, scans_consumed - 1),
        exhausted_at = case
          when scans_consumed - 1 < scans_granted then null
          else exhausted_at
        end
    where id = v_credit_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

REVOKE ALL ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) TO service_role;

-- ============================================================================
-- grant_scan_pack_credits — new RPC for Scan Pack purchases
-- Idempotent via UNIQUE(transaction_id) — closes PASS-B-018.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.grant_scan_pack_credits(
  p_user_id        uuid,
  p_source         text,
  p_transaction_id text,
  p_scans_granted  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user_id  uuid;
  v_existing record;
  v_inserted record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;

  if p_source not in ('pack_10', 'pack_25') then
    return jsonb_build_object('error', 'invalid_source');
  end if;
  if p_scans_granted is null or p_scans_granted <= 0 then
    return jsonb_build_object('error', 'invalid_scans_granted');
  end if;
  if p_transaction_id is null or length(p_transaction_id) = 0 then
    return jsonb_build_object('error', 'invalid_transaction_id');
  end if;

  -- Idempotent INSERT.
  insert into public.scan_credits (user_id, source, transaction_id, scans_granted)
  values (p_user_id, p_source, p_transaction_id, p_scans_granted)
  on conflict (transaction_id) do nothing
  returning id, scans_granted into v_inserted;

  if v_inserted.id is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', false,
      'credits_granted', v_inserted.scans_granted
    );
  end if;

  -- Conflict: row already exists. Verify it belongs to this user.
  select id, user_id, scans_granted into v_existing
  from public.scan_credits
  where transaction_id = p_transaction_id;

  if v_existing.user_id is distinct from p_user_id then
    return jsonb_build_object('error', 'transaction_user_mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', true,
    'credits_granted', v_existing.scans_granted
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.grant_scan_pack_credits(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_scan_pack_credits(uuid, text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_scan_pack_credits(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_scan_pack_credits(uuid, text, text, integer) TO service_role;

COMMIT;
