-- Migration: revoke PUBLIC/anon EXECUTE from 7 SECURITY DEFINER functions and bind caller identity to auth.uid().
-- Source of truth: exact live function definitions fetched from production in this run.
-- has_role converted from LANGUAGE sql to LANGUAGE plpgsql to support procedural auth gate.
-- SET search_path TO 'public' added to has_role (was absent in live definition).

BEGIN;

-- ========================================================================
-- complete_receipt_scan
-- ========================================================================
CREATE OR REPLACE FUNCTION public.complete_receipt_scan(p_request_id uuid, p_user_id uuid, p_normalized_output jsonb, p_raw_ocr_response jsonb DEFAULT NULL::jsonb, p_field_confidence jsonb DEFAULT NULL::jsonb, p_duplicate_hash text DEFAULT NULL::text, p_image_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows int := 0;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;


  update public.receipt_scans
  set status = 'completed',
      normalized_output = p_normalized_output,
      raw_ocr_response = p_raw_ocr_response,
      field_confidence = p_field_confidence,
      duplicate_hash = p_duplicate_hash,
      image_path = p_image_path,
      completed_at = now(),
      updated_at = now()
  where request_id = p_request_id
    and user_id = p_user_id
    and status in ('reserved', 'processing')
    and expires_at > now();

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('error', 'not_completable');
  end if;

  return jsonb_build_object('ok', true);
end;
$function$
;

REVOKE ALL ON FUNCTION public.complete_receipt_scan(uuid, uuid, jsonb, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_receipt_scan(uuid, uuid, jsonb, jsonb, jsonb, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_receipt_scan(uuid, uuid, jsonb, jsonb, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_receipt_scan(uuid, uuid, jsonb, jsonb, jsonb, text, text) TO service_role;

-- ========================================================================
-- fail_receipt_scan
-- ========================================================================
CREATE OR REPLACE FUNCTION public.fail_receipt_scan(p_request_id uuid, p_user_id uuid, p_error_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;


  update public.receipt_scans
  set status = 'failed',
      error_message = p_error_message,
      updated_at = now()
  where request_id = p_request_id
    and user_id = p_user_id
    and status in ('reserved', 'processing');

  return jsonb_build_object('ok', true);
end;
$function$
;

REVOKE ALL ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_receipt_scan(uuid, uuid, text) TO service_role;

-- ========================================================================
-- get_scan_quota
-- ========================================================================
CREATE OR REPLACE FUNCTION public.get_scan_quota(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_profile record;
  v_limit int := 0;
  v_used int := 0;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;


  select subscription_tier, trial_expires_at, subscription_expires_at
  into v_profile
  from public.profiles
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'tier', null,
      'scans_used', 0,
      'scans_limit', 0,
      'scans_remaining', 0
    );
  end if;

  if v_profile.subscription_tier = 'trial'
     and v_profile.trial_expires_at is not null
     and v_profile.trial_expires_at > now() then
    v_limit := 5;
  elsif v_profile.subscription_tier = 'business'
     and v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > now() then
    v_limit := 100;
  elsif v_profile.subscription_tier = 'pro'
     and v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > now() then
    v_limit := 30;
  elsif v_profile.subscription_tier = 'personal'
     and v_profile.subscription_expires_at is not null
     and v_profile.subscription_expires_at > now() then
    v_limit := 15;
  else
    v_limit := 0;
  end if;

  select count(*)
  into v_used
  from public.receipt_scans
  where user_id = p_user_id
    and status = 'completed'
    and created_at >= date_trunc('month', now());

  return jsonb_build_object(
    'tier', v_profile.subscription_tier,
    'scans_used', v_used,
    'scans_limit', v_limit,
    'scans_remaining', greatest(0, v_limit - v_used)
  );
end;
$function$
;

REVOKE ALL ON FUNCTION public.get_scan_quota(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scan_quota(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scan_quota(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_scan_quota(uuid) TO service_role;

-- ========================================================================
-- has_role
-- ========================================================================
CREATE OR REPLACE FUNCTION public.has_role(_role app_role, _user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if _user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;

  RETURN (
    SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
  );
end;
$function$
;

REVOKE ALL ON FUNCTION public.has_role(app_role, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(app_role, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(app_role, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(app_role, uuid) TO service_role;

-- ========================================================================
-- mark_receipt_scan_processing
-- ========================================================================
CREATE OR REPLACE FUNCTION public.mark_receipt_scan_processing(p_request_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows int := 0;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from v_user_id then
    raise exception 'Forbidden';
  end if;


  update public.receipt_scans
  set status = 'processing',
      updated_at = now()
  where request_id = p_request_id
    and user_id = p_user_id
    and status = 'reserved'
    and expires_at > now();

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('error', 'not_reservable');
  end if;

  return jsonb_build_object('ok', true);
end;
$function$
;

REVOKE ALL ON FUNCTION public.mark_receipt_scan_processing(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_receipt_scan_processing(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_receipt_scan_processing(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_receipt_scan_processing(uuid, uuid) TO service_role;

-- ========================================================================
-- reserve_receipt_scan
-- ========================================================================
CREATE OR REPLACE FUNCTION public.reserve_receipt_scan(p_request_id uuid, p_user_id uuid, p_asset_type text, p_asset_id uuid, p_source text DEFAULT 'camera'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing record;
  v_profile record;
  v_asset_owned boolean := false;
  v_active_count int := 0;
  v_completed_count int := 0;
  v_monthly_limit int := 0;
  v_user_id uuid;
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

  update public.receipt_scans
  set status = 'timed_out',
      updated_at = now(),
      error_message = coalesce(error_message, 'Scan exceeded maximum processing time')
  where user_id = p_user_id
    and status in ('reserved', 'processing')
    and expires_at <= now();

  select subscription_tier, trial_expires_at, subscription_expires_at
  into v_profile
  from public.profiles
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('error', 'profile_not_found');
  end if;

  if p_asset_type = 'vehicle' then
    select exists(
      select 1 from public.vehicles
      where id = p_asset_id and user_id = p_user_id
    ) into v_asset_owned;
  elsif p_asset_type = 'property' then
    select exists(
      select 1 from public.properties
      where id = p_asset_id and user_id = p_user_id
    ) into v_asset_owned;
  elsif p_asset_type = 'health' then
    select exists(
      select 1 from public.health_profiles
      where id = p_asset_id and user_id = p_user_id
    ) into v_asset_owned;
  end if;

  if not coalesce(v_asset_owned, false) then
    return jsonb_build_object('error', 'asset_not_found');
  end if;

  select count(*)
  into v_active_count
  from public.receipt_scans
  where user_id = p_user_id
    and status in ('reserved', 'processing')
    and expires_at > now();

  if v_active_count > 0 then
    return jsonb_build_object('error', 'scan_in_progress');
  end if;

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

  select count(*)
  into v_completed_count
  from public.receipt_scans
  where user_id = p_user_id
    and status = 'completed'
    and created_at >= date_trunc('month', now());

  if v_completed_count >= v_monthly_limit then
    return jsonb_build_object(
      'error', 'quota_exceeded',
      'scans_used', v_completed_count,
      'scans_limit', v_monthly_limit
    );
  end if;

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
    'scans_limit', v_monthly_limit
  );
end;
$function$
;

REVOKE ALL ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_receipt_scan(uuid, uuid, text, uuid, text) TO service_role;

-- ========================================================================
-- timeout_stale_scans
-- ========================================================================
CREATE OR REPLACE FUNCTION public.timeout_stale_scans()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int := 0;
begin
  if auth.uid() is null and current_setting('role', true) not in ('service_role','postgres','supabase_admin') then
    raise exception 'Not authorized';
  end if;
  if auth.uid() is not null then
    raise exception 'Not authorized';
  end if;


  update public.receipt_scans
  set status = 'timed_out',
      updated_at = now(),
      error_message = coalesce(error_message, 'Scan exceeded maximum processing time')
  where status in ('reserved', 'processing')
    and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

REVOKE ALL ON FUNCTION public.timeout_stale_scans() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.timeout_stale_scans() FROM anon;
REVOKE ALL ON FUNCTION public.timeout_stale_scans() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.timeout_stale_scans() TO service_role;

COMMIT;
