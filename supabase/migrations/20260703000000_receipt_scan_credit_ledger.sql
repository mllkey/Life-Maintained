-- 20260703000000_receipt_scan_credit_ledger.sql
--
-- Trunk 4 P1a — receipt-scan credit ledger.
-- Invariant restored: a scan credit is consumed IF AND ONLY IF a scan completes.
-- The debit moves out of reserve (which now only EARMARKS a credit) and into
-- complete (the sole place scan_credits.scans_consumed increments). fail/timeout
-- carry no credit math, so the CF-6 (cron never refunds) and CF-8 (fail RETURNING
-- returns the just-nulled value) defects cease to exist rather than being patched.
-- get_scan_quota becomes credit-aware so the client gate and displays stop denying
-- users the credits they bought (CF-1).
--
-- All five functions keep their EXACT existing signatures, so CREATE OR REPLACE
-- preserves ownership and grants (authenticated / service_role) — no re-GRANT needed.
-- Reviewed by two independent instances through v3; no open blockers.

-- 1) get_scan_quota — now credit-aware (fixes CF-1)
CREATE OR REPLACE FUNCTION public.get_scan_quota(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_profile record; v_limit int := 0; v_monthly_used int := 0;
  v_credit_balance int := 0; v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_user_id is distinct from v_user_id then raise exception 'Forbidden'; end if;

  select subscription_tier, trial_expires_at, subscription_expires_at into v_profile
  from public.profiles where user_id = p_user_id;
  if not found then
    return jsonb_build_object('tier',null,'scans_used',0,'scans_limit',0,
      'scans_remaining',0,'credit_balance',0);
  end if;

  if v_profile.subscription_tier = 'trial' and v_profile.trial_expires_at is not null and v_profile.trial_expires_at > now() then v_limit := 5;
  elsif v_profile.subscription_tier = 'business' and v_profile.subscription_expires_at is not null and v_profile.subscription_expires_at > now() then v_limit := 100;
  elsif v_profile.subscription_tier = 'pro' and v_profile.subscription_expires_at is not null and v_profile.subscription_expires_at > now() then v_limit := 30;
  elsif v_profile.subscription_tier = 'personal' and v_profile.subscription_expires_at is not null and v_profile.subscription_expires_at > now() then v_limit := 15;
  else v_limit := 0;
  end if;

  select count(*) into v_monthly_used from public.receipt_scans
  where user_id = p_user_id and status = 'completed'
    and consumed_credit_id is null
    and created_at >= date_trunc('month', now());

  select coalesce(sum(scans_granted - scans_consumed), 0) into v_credit_balance
  from public.scan_credits
  where user_id = p_user_id and exhausted_at is null and scans_consumed < scans_granted;

  return jsonb_build_object(
    'tier', v_profile.subscription_tier,
    'scans_used', v_monthly_used,
    'scans_limit', v_limit,
    'scans_remaining', greatest(0, v_limit - v_monthly_used) + v_credit_balance,
    'credit_balance', v_credit_balance
  );
end; $$;

-- 2) reserve_receipt_scan — EARMARK only (no debit); inline credit-refund loop REMOVED.
CREATE OR REPLACE FUNCTION public.reserve_receipt_scan(p_request_id uuid, p_user_id uuid, p_asset_type text, p_asset_id uuid, p_source text DEFAULT 'camera'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_existing record; v_profile record; v_asset_owned boolean := false;
  v_active_count int := 0; v_completed_count int := 0; v_monthly_limit int := 0;
  v_user_id uuid; v_credit record;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_user_id is distinct from v_user_id then raise exception 'Forbidden'; end if;
  if p_asset_type not in ('vehicle','property','health') then return jsonb_build_object('error','invalid_asset_type'); end if;
  if p_source not in ('camera','photo_library') then return jsonb_build_object('error','invalid_source'); end if;

  select id, status, normalized_output into v_existing from public.receipt_scans where request_id = p_request_id;
  if found then
    return jsonb_build_object('ok',true,'idempotent',true,'request_id',p_request_id,'status',v_existing.status);
  end if;

  -- Inline GC: clear this user's stale rows so single-flight is accurate. No credit
  -- logic needed — earmarks are never debited, so a timed-out earmark leaves its
  -- credit fully available with no refund step. Null consumed_credit_id for row-state
  -- parity with the cron path (a timed_out row must not look credit-backed).
  update public.receipt_scans
  set status = 'timed_out', updated_at = now(), consumed_credit_id = null,
      error_message = coalesce(error_message, 'Scan exceeded maximum processing time')
  where user_id = p_user_id and status in ('reserved','processing') and expires_at <= now();

  select subscription_tier, trial_expires_at, subscription_expires_at into v_profile
  from public.profiles where user_id = p_user_id for update;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;

  if p_asset_type = 'vehicle' then
    select exists(select 1 from public.vehicles where id = p_asset_id and user_id = p_user_id) into v_asset_owned;
  elsif p_asset_type = 'property' then
    select exists(select 1 from public.properties where id = p_asset_id and user_id = p_user_id) into v_asset_owned;
  elsif p_asset_type = 'health' then
    select exists(select 1 from public.health_profiles where id = p_asset_id and user_id = p_user_id) into v_asset_owned;
  end if;
  if not coalesce(v_asset_owned, false) then return jsonb_build_object('error','asset_not_found'); end if;

  select count(*) into v_active_count from public.receipt_scans
  where user_id = p_user_id and status in ('reserved','processing') and expires_at > now();
  if v_active_count > 0 then return jsonb_build_object('error','scan_in_progress'); end if;

  if v_profile.subscription_tier = 'trial' and v_profile.trial_expires_at is not null and v_profile.trial_expires_at > now() then v_monthly_limit := 5;
  elsif v_profile.subscription_tier = 'business' and v_profile.subscription_expires_at is not null and v_profile.subscription_expires_at > now() then v_monthly_limit := 100;
  elsif v_profile.subscription_tier = 'pro' and v_profile.subscription_expires_at is not null and v_profile.subscription_expires_at > now() then v_monthly_limit := 30;
  elsif v_profile.subscription_tier = 'personal' and v_profile.subscription_expires_at is not null and v_profile.subscription_expires_at > now() then v_monthly_limit := 15;
  else v_monthly_limit := 0;
  end if;
  -- NOTE (B1): do NOT early-return subscription_required here. A lapsed subscriber can
  -- still hold non-expiring pack credits; the subscription_required decision is deferred
  -- to the no-credit fallthrough below so credits are always reachable.

  -- Monthly usage excludes credit-backed completions.
  select count(*) into v_completed_count from public.receipt_scans
  where user_id = p_user_id and status = 'completed' and consumed_credit_id is null
    and created_at >= date_trunc('month', now());

  -- Under monthly cap (only possible when limit > 0): reserve a normal monthly slot.
  if v_monthly_limit > 0 and v_completed_count < v_monthly_limit then
    insert into public.receipt_scans (request_id, user_id, asset_type, asset_id, status, source, updated_at, expires_at)
    values (p_request_id, p_user_id, p_asset_type, p_asset_id, 'reserved', p_source, now(), now() + interval '10 minutes');
    return jsonb_build_object('ok',true,'idempotent',false,'request_id',p_request_id,'status','reserved',
      'scans_used',v_completed_count,'scans_limit',v_monthly_limit,'used_credit',false);
  end if;

  -- At/over monthly cap OR no active subscription: EARMARK the oldest unexhausted
  -- credit (debit happens at complete). This is reachable at v_monthly_limit = 0.
  select id, scans_granted, scans_consumed into v_credit from public.scan_credits
  where user_id = p_user_id and exhausted_at is null and scans_consumed < scans_granted
  order by granted_at asc limit 1 for update skip locked;
  if not found then
    -- No spendable credit. Distinguish the two dead-ends so the client shows the right
    -- CTA: no subscription -> Paywall; capped subscriber -> Scan Pack modal.
    if v_monthly_limit <= 0 then
      return jsonb_build_object('error','subscription_required');
    else
      return jsonb_build_object('error','quota_exceeded','scans_used',v_completed_count,'scans_limit',v_monthly_limit);
    end if;
  end if;

  insert into public.receipt_scans (request_id, user_id, asset_type, asset_id, status, source, updated_at, expires_at, consumed_credit_id)
  values (p_request_id, p_user_id, p_asset_type, p_asset_id, 'reserved', p_source, now(), now() + interval '10 minutes', v_credit.id);

  return jsonb_build_object('ok',true,'idempotent',false,'request_id',p_request_id,'status','reserved',
    'scans_used',v_completed_count,'scans_limit',v_monthly_limit,'used_credit',true);
end; $$;

-- 3) complete_receipt_scan — the SOLE debit point (fixes CF-6/CF-8 by construction)
CREATE OR REPLACE FUNCTION public.complete_receipt_scan(p_request_id uuid, p_user_id uuid, p_normalized_output jsonb, p_raw_ocr_response jsonb DEFAULT NULL, p_field_confidence jsonb DEFAULT NULL, p_duplicate_hash text DEFAULT NULL, p_image_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_rows int := 0; v_user_id uuid; v_credit_id uuid; v_credit_rows int := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_user_id is distinct from v_user_id then raise exception 'Forbidden'; end if;

  update public.receipt_scans
  set status = 'completed', normalized_output = p_normalized_output,
      raw_ocr_response = p_raw_ocr_response, field_confidence = p_field_confidence,
      duplicate_hash = p_duplicate_hash, image_path = p_image_path,
      completed_at = now(), updated_at = now()
  where request_id = p_request_id and user_id = p_user_id
    and status in ('reserved', 'processing') and expires_at > now()
  returning consumed_credit_id into v_credit_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('error', 'not_completable'); end if;

  -- consumed_credit_id is NOT modified by the UPDATE above, so RETURNING yields its
  -- existing (pre-existing) value — safe, unlike the old fail path. Debit now, scoped
  -- to this user, and assert exactly one credit row moved (ledger safety).
  if v_credit_id is not null then
    update public.scan_credits
    set scans_consumed = scans_consumed + 1,
        exhausted_at = case when scans_consumed + 1 >= scans_granted then now() else null end
    where id = v_credit_id and user_id = p_user_id and scans_consumed < scans_granted;
    get diagnostics v_credit_rows = row_count;
    if v_credit_rows <> 1 then
      raise exception 'complete_receipt_scan: credit debit affected % rows for credit %', v_credit_rows, v_credit_id;
    end if;
  end if;

  return jsonb_build_object('ok', true);
end; $$;

-- 4) fail_receipt_scan — release earmark, NO credit math (CF-8 root removed)
CREATE OR REPLACE FUNCTION public.fail_receipt_scan(p_request_id uuid, p_user_id uuid, p_error_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_user_id uuid; v_rows int := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_user_id is distinct from v_user_id then raise exception 'Forbidden'; end if;

  -- Credits are debited only at completion, so a failed scan simply releases its
  -- earmark. No RETURNING-into-credit, no refund loop -> the CF-8 bug cannot exist.
  update public.receipt_scans
  set status = 'failed', error_message = p_error_message, updated_at = now(),
      consumed_credit_id = null
  where request_id = p_request_id and user_id = p_user_id
    and status in ('reserved','processing');
  get diagnostics v_rows = row_count;

  return jsonb_build_object('ok', true);
end; $$;

-- 5) timeout_stale_scans — one-line hygiene change: also null consumed_credit_id so
--    timed-out rows don't masquerade as credit-backed. Still performs NO credit
--    debit/refund; the auth guard (service_role-only) is preserved verbatim.
CREATE OR REPLACE FUNCTION public.timeout_stale_scans()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_count int := 0;
begin
  if auth.uid() is null and current_setting('role', true) not in ('service_role','postgres','supabase_admin') then
    raise exception 'Not authorized';
  end if;
  if auth.uid() is not null then raise exception 'Not authorized'; end if;
  update public.receipt_scans
  set status = 'timed_out', updated_at = now(), consumed_credit_id = null,
      error_message = coalesce(error_message, 'Scan exceeded maximum processing time')
  where status in ('reserved', 'processing') and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
