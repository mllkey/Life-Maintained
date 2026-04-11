


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'admin',
    'moderator',
    'user'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."contact_method" AS ENUM (
    'call',
    'email',
    'website',
    'request_quote'
);


ALTER TYPE "public"."contact_method" OWNER TO "postgres";


CREATE TYPE "public"."lead_status" AS ENUM (
    'sent',
    'contacted',
    'quoted',
    'booked',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."lead_status" OWNER TO "postgres";


CREATE TYPE "public"."notification_priority" AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


ALTER TYPE "public"."notification_priority" OWNER TO "postgres";


CREATE TYPE "public"."notification_type" AS ENUM (
    'maintenance_due',
    'maintenance_overdue',
    'budget_alert',
    'seasonal_reminder',
    'milestone',
    'trial_ending',
    'welcome',
    'inactive_reminder',
    'completion'
);


ALTER TYPE "public"."notification_type" OWNER TO "postgres";


CREATE TYPE "public"."service_type" AS ENUM (
    'auto_mechanic',
    'dentist',
    'hvac_technician',
    'plumber',
    'electrician',
    'roofer',
    'veterinarian',
    'general_contractor',
    'landscaper',
    'pest_control',
    'eye_doctor',
    'dermatologist',
    'handyman',
    'cleaning_service',
    'other'
);


ALTER TYPE "public"."service_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_lm_col_exists"("p_table" "text", "p_col" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  with parts as (
    select
      case when strpos(p_table, '.') > 0 then split_part(p_table, '.', 1) else 'public' end as schem,
      case when strpos(p_table, '.') > 0 then split_part(p_table, '.', 2) else p_table end as tab
  )
  select exists (
    select 1
    from information_schema.columns c
    cross join parts p
    where c.table_schema = p.schem
      and c.table_name = p.tab
      and c.column_name = p_col
  );
$$;


ALTER FUNCTION "public"."_lm_col_exists"("p_table" "text", "p_col" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_lm_seed_insert"("p_table" "text", "p_row" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_schema text;
  v_table text;
  v_cols text;
  v_vals text;
  v_sql text;
  v_has_id boolean;
  v_id uuid;
begin
  if not public._lm_table_exists(p_table) then
    raise notice 'Skipping %. Table does not exist.', p_table;
    return null;
  end if;

  v_schema := case when strpos(p_table, '.') > 0 then split_part(p_table, '.', 1) else 'public' end;
  v_table  := case when strpos(p_table, '.') > 0 then split_part(p_table, '.', 2) else p_table end;

  select
    string_agg(format('%I', e.key), ', ' order by e.key),
    string_agg(
      case
        when e.value is null or e.value::text = 'null' then 'null'
        when jsonb_typeof(e.value) = 'string' then quote_nullable(trim(both '"' from e.value::text))
        when jsonb_typeof(e.value) in ('number','boolean') then e.value::text
        else quote_nullable(e.value::text)
      end,
      ', ' order by e.key
    )
  into v_cols, v_vals
  from jsonb_each(p_row) e
  where exists (
    select 1
    from information_schema.columns c
    where c.table_schema = v_schema
      and c.table_name = v_table
      and c.column_name = e.key
  );

  if v_cols is null or v_vals is null then
    raise notice 'Skipping %. No matching columns in payload.', p_table;
    return null;
  end if;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = v_schema
      and c.table_name = v_table
      and c.column_name = 'id'
  ) into v_has_id;

  if v_has_id then
    v_sql := format('insert into %I.%I (%s) values (%s) returning id', v_schema, v_table, v_cols, v_vals);
    begin
      execute v_sql into v_id;
      return v_id;
    exception when others then
      raise notice 'Insert failed for %. Error: %', p_table, sqlerrm;
      return null;
    end;
  else
    v_sql := format('insert into %I.%I (%s) values (%s)', v_schema, v_table, v_cols, v_vals);
    begin
      execute v_sql;
      return null;
    exception when others then
      raise notice 'Insert failed for %. Error: %', p_table, sqlerrm;
      return null;
    end;
  end if;
end;
$$;


ALTER FUNCTION "public"."_lm_seed_insert"("p_table" "text", "p_row" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_lm_table_exists"("p_table" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select to_regclass(
    case
      when strpos(p_table, '.') > 0 then p_table
      else 'public.' || p_table
    end
  ) is not null;
$$;


ALTER FUNCTION "public"."_lm_table_exists"("p_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_normalized_output" "jsonb", "p_raw_ocr_response" "jsonb" DEFAULT NULL::"jsonb", "p_field_confidence" "jsonb" DEFAULT NULL::"jsonb", "p_duplicate_hash" "text" DEFAULT NULL::"text", "p_image_path" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_rows int := 0;
begin
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
$$;


ALTER FUNCTION "public"."complete_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_normalized_output" "jsonb", "p_raw_ocr_response" "jsonb", "p_field_confidence" "jsonb", "p_duplicate_hash" "text", "p_image_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_vehicle_task"("p_task_id" "uuid", "p_mileage" numeric DEFAULT NULL::numeric, "p_hours" numeric DEFAULT NULL::numeric, "p_completed_date" timestamp with time zone DEFAULT "now"(), "p_notes" "text" DEFAULT NULL::"text", "p_cost" numeric DEFAULT NULL::numeric, "p_skip_log" boolean DEFAULT false, "p_provider_name" "text" DEFAULT NULL::"text", "p_did_it_myself" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_task             record;
  v_vehicle          record;
  v_mode             text;
  v_user_id          uuid;
  v_completed_str    text;
  v_next_due_date    text;
  v_next_due_miles   numeric;
  v_next_due_hours   numeric;
  v_vehicle_name     text;
BEGIN
  -- Require authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load task and verify the caller owns it (through vehicle)
  SELECT t.*
    INTO v_task
    FROM user_vehicle_maintenance_tasks t
    JOIN vehicles v ON v.id = t.vehicle_id
   WHERE t.id = p_task_id
     AND t.user_id = v_user_id
     AND v.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;

  -- Load full vehicle row
  SELECT * INTO v_vehicle FROM vehicles WHERE id = v_task.vehicle_id;

  -- Resolve tracking mode: explicit DB value wins, else infer from vehicle_type
  v_mode := COALESCE(
    v_vehicle.tracking_mode,
    CASE LOWER(COALESCE(v_vehicle.vehicle_type, ''))
      WHEN 'boat'                  THEN 'hours'
      WHEN 'pwc'                   THEN 'hours'
      WHEN 'lawnmower'             THEN 'hours'
      WHEN 'lawn_mower'            THEN 'hours'
      WHEN 'chainsaw'              THEN 'hours'
      WHEN 'generator'             THEN 'hours'
      WHEN 'excavator'             THEN 'hours'
      WHEN 'skid_steer'            THEN 'hours'
      WHEN 'mini_excavator'        THEN 'hours'
      WHEN 'compact_track_loader'  THEN 'hours'
      WHEN 'backhoe'               THEN 'hours'
      WHEN 'wheel_loader'          THEN 'hours'
      WHEN 'telehandler'           THEN 'hours'
      WHEN 'forklift'              THEN 'hours'
      WHEN 'snow_blower'           THEN 'hours'
      WHEN 'pressure_washer'       THEN 'hours'
      WHEN 'wood_chipper'          THEN 'hours'
      WHEN 'stump_grinder'         THEN 'hours'
      WHEN 'concrete_saw'          THEN 'hours'
      WHEN 'welder'                THEN 'hours'
      WHEN 'trailer'               THEN 'time_only'
      WHEN 'dump_trailer'          THEN 'time_only'
      WHEN 'dumpster'              THEN 'time_only'
      ELSE                              'mileage'
    END
  );

  -- Completed date as plain date string (YYYY-MM-DD)
  v_completed_str := to_char(p_completed_date AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  -- Compute next-due values from task intervals
  IF v_mode IN ('mileage', 'both')
     AND p_mileage IS NOT NULL
     AND v_task.interval_miles IS NOT NULL
     AND v_task.interval_miles > 0
  THEN
    v_next_due_miles := p_mileage + v_task.interval_miles;
  END IF;

  IF v_mode IN ('hours', 'both')
     AND p_hours IS NOT NULL
     AND v_task.interval_hours IS NOT NULL
     AND v_task.interval_hours > 0
  THEN
    v_next_due_hours := p_hours + v_task.interval_hours;
  END IF;

  IF v_task.interval_months IS NOT NULL AND v_task.interval_months > 0 THEN
    v_next_due_date := to_char(
      (p_completed_date + (v_task.interval_months || ' months')::interval) AT TIME ZONE 'UTC',
      'YYYY-MM-DD'
    );
  END IF;

  -- Update the task (status → 'upcoming', clear fields that don't apply to this mode)
  UPDATE user_vehicle_maintenance_tasks SET
    last_completed_date  = v_completed_str,
    last_completed_miles = CASE WHEN v_mode IN ('mileage', 'both') THEN p_mileage        ELSE NULL END,
    last_completed_hours = CASE WHEN v_mode IN ('hours',   'both') THEN p_hours          ELSE NULL END,
    next_due_miles       = CASE WHEN v_mode IN ('mileage', 'both') THEN v_next_due_miles ELSE NULL END,
    next_due_hours       = CASE WHEN v_mode IN ('hours',   'both') THEN v_next_due_hours ELSE NULL END,
    next_due_date        = v_next_due_date,
    status               = 'upcoming',
    updated_at           = now()
  WHERE id = p_task_id;

  -- Update vehicle mileage if the new reading is higher
  IF v_mode IN ('mileage', 'both')
     AND p_mileage IS NOT NULL
     AND p_mileage > COALESCE(v_vehicle.mileage, 0)
  THEN
    UPDATE vehicles SET mileage = p_mileage, updated_at = now() WHERE id = v_vehicle.id;

    -- Record mileage history only when mileage increased
    INSERT INTO vehicle_mileage_history (vehicle_id, mileage, recorded_at, created_at)
    VALUES (v_vehicle.id, p_mileage, p_completed_date, now());
  END IF;

  -- Update vehicle hours if the new reading is higher
  IF v_mode IN ('hours', 'both')
     AND p_hours IS NOT NULL
     AND p_hours > COALESCE(v_vehicle.hours, 0)
  THEN
    UPDATE vehicles SET hours = p_hours, updated_at = now() WHERE id = v_vehicle.id;
  END IF;

  -- Optionally insert maintenance log
  IF NOT p_skip_log THEN
    INSERT INTO maintenance_logs (
      user_id, vehicle_id, service_name, service_date,
      mileage, cost, notes, provider_name, did_it_myself,
      provider_contact, receipt_url,
      created_at, updated_at
    ) VALUES (
      v_user_id,
      v_vehicle.id,
      v_task.name,
      v_completed_str,
      COALESCE(p_mileage, p_hours),
      p_cost,
      p_notes,
      p_provider_name,
      p_did_it_myself,
      NULL,
      NULL,
      now(),
      now()
    );
  END IF;

  -- Build vehicle display name for the response payload
  v_vehicle_name := COALESCE(
    v_vehicle.nickname,
    TRIM(CONCAT_WS(' ', v_vehicle.year::text, v_vehicle.make, v_vehicle.model))
  );

  -- Return exactly five deterministic fields; no extra keys
  RETURN jsonb_build_object(
    'task_name',      v_task.name,
    'vehicle_name',   v_vehicle_name,
    'next_due_date',  v_next_due_date,
    'next_due_miles', v_next_due_miles,
    'next_due_hours', v_next_due_hours
  );
END;
$$;


ALTER FUNCTION "public"."complete_vehicle_task"("p_task_id" "uuid", "p_mileage" numeric, "p_hours" numeric, "p_completed_date" timestamp with time zone, "p_notes" "text", "p_cost" numeric, "p_skip_log" boolean, "p_provider_name" "text", "p_did_it_myself" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_user_notification_preferences_from_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.user_notification_preferences (
      user_id,
      push_enabled,
      created_at,
      updated_at
    )
    VALUES (
      NEW.user_id,
      false,
      now(),
      now()
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_user_notification_preferences_from_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_error_message" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.receipt_scans
  set status = 'failed',
      error_message = p_error_message,
      updated_at = now()
  where request_id = p_request_id
    and user_id = p_user_id
    and status in ('reserved', 'processing');

  return jsonb_build_object('ok', true);
end;
$$;


ALTER FUNCTION "public"."fail_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_scan_quota"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile record;
  v_limit int := 0;
  v_used int := 0;
begin
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
$$;


ALTER FUNCTION "public"."get_scan_quota"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_role" "public"."app_role", "_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;


ALTER FUNCTION "public"."has_role"("_role" "public"."app_role", "_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_receipt_scan_processing"("p_request_id" "uuid", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_rows int := 0;
begin
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
$$;


ALTER FUNCTION "public"."mark_receipt_scan_processing"("p_request_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_asset_type" "text", "p_asset_id" "uuid", "p_source" "text" DEFAULT 'camera'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_existing record;
  v_profile record;
  v_asset_owned boolean := false;
  v_active_count int := 0;
  v_completed_count int := 0;
  v_monthly_limit int := 0;
begin
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
$$;


ALTER FUNCTION "public"."reserve_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_asset_type" "text", "p_asset_id" "uuid", "p_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_user_notification_preferences_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_user_notification_preferences_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."timeout_stale_scans"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count int := 0;
begin
  update public.receipt_scans
  set status = 'timed_out',
      updated_at = now(),
      error_message = coalesce(error_message, 'Scan exceeded maximum processing time')
  where status in ('reserved', 'processing')
    and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."timeout_stale_scans"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_uvmt_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_uvmt_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_schedule_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cache_key" "text" NOT NULL,
    "vehicle_desc" "text",
    "vehicle_category" "text",
    "fuel_type" "text",
    "tasks_json" "text" NOT NULL,
    "task_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ai_schedule_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budget_notification_tiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "cost_threshold" numeric NOT NULL,
    "advance_notice_days" integer NOT NULL,
    "advance_notice_label" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."budget_notification_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."family_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "member_type" "text" DEFAULT 'human'::"text" NOT NULL,
    "relationship" "text",
    "date_of_birth" "date",
    "sex_at_birth" "text",
    "pet_type" "text",
    "pet_breed" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "photo_url" "text"
);


ALTER TABLE "public"."family_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "family_member_id" "uuid",
    "appointment_type" "text" NOT NULL,
    "appointment_date" timestamp with time zone,
    "provider_name" "text",
    "estimated_cost" numeric,
    "interval_months" integer,
    "is_completed" boolean DEFAULT false,
    "last_completed_at" timestamp with time zone,
    "next_due_date" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "interval_type" "text"
);


ALTER TABLE "public"."health_appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date_of_birth" "date" NOT NULL,
    "sex_at_birth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."health_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."health_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "record_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "date" "date",
    "provider" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."health_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interval_corrections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "vehicle_id" "uuid",
    "task_name" "text" NOT NULL,
    "task_key" "text",
    "vehicle_spec" "text" NOT NULL,
    "vehicle_category" "text",
    "fuel_type" "text",
    "original_interval_miles" integer,
    "original_interval_months" integer,
    "corrected_interval_miles" integer,
    "corrected_interval_months" integer,
    "change_method" "text" DEFAULT 'custom'::"text" NOT NULL,
    "task_had_completion" boolean DEFAULT false,
    "schedule_source" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."interval_corrections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid",
    "property_id" "uuid",
    "service_name" "text" NOT NULL,
    "service_date" "date" NOT NULL,
    "cost" numeric,
    "mileage" integer,
    "provider_name" "text",
    "provider_contact" "text",
    "receipt_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hours" numeric,
    "did_it_myself" boolean DEFAULT false,
    "zip_code" "text"
);


ALTER TABLE "public"."maintenance_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_type" "text" DEFAULT 'car'::"text" NOT NULL,
    "make" "text" NOT NULL,
    "model" "text" NOT NULL,
    "year_start" integer NOT NULL,
    "year_end" integer NOT NULL,
    "trim_type" "text",
    "category" "text" NOT NULL,
    "task" "text" NOT NULL,
    "description" "text",
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "mileage_interval" integer NOT NULL,
    "time_interval_months" integer NOT NULL,
    "estimated_cost_min" numeric DEFAULT 0 NOT NULL,
    "estimated_cost_max" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."maintenance_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."make_template_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "make" "text" NOT NULL,
    "interval_miles" integer,
    "interval_months" integer,
    "year_start" integer,
    "year_end" integer,
    "notes" "text",
    "is_excluded" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."make_template_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."manufacturer_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "task" "text" NOT NULL,
    "interval" "text" NOT NULL,
    "mileage_interval" integer,
    "category" "text",
    "description" "text",
    "source" "text",
    "is_manufacturer_data" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."manufacturer_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "reminder_time" "text" NOT NULL,
    "reminders_enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "family_member_id" "uuid"
);


ALTER TABLE "public"."medications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notification_id" "uuid",
    "event_type" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "type" "public"."notification_type" NOT NULL,
    "priority" "public"."notification_priority" DEFAULT 'medium'::"public"."notification_priority" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "is_dismissed" boolean DEFAULT false NOT NULL,
    "read_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "action_taken" "text",
    "snoozed_until" timestamp with time zone,
    "link" "text",
    "related_entity_type" "text",
    "related_entity_id" "text",
    "sent_via_push" boolean DEFAULT false NOT NULL,
    "sent_via_email" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phi_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "session_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."phi_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "subscription_tier" "text" DEFAULT 'trial'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "subscription_start_date" timestamp with time zone,
    "subscription_renewal_date" timestamp with time zone,
    "trial_start_date" timestamp with time zone,
    "trial_end_date" timestamp with time zone,
    "onboarding_completed" boolean DEFAULT false,
    "onboarding_step" integer DEFAULT 0,
    "onboarding_data" "jsonb",
    "onboarding_selections" "text"[],
    "zip_code" "text",
    "is_beta_user" boolean DEFAULT false,
    "beta_premium_until" timestamp with time zone,
    "budget_notifications_enabled" boolean DEFAULT true,
    "push_token" "text",
    "trial_started_at" timestamp with time zone DEFAULT "now"(),
    "trial_expires_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval),
    "subscription_expires_at" timestamp with time zone,
    "revenuecat_customer_id" "text",
    "monthly_scan_count" integer DEFAULT 0 NOT NULL,
    "scan_count_reset_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "profiles_subscription_tier_check" CHECK (("subscription_tier" = ANY (ARRAY['trial'::"text", 'free'::"text", 'personal'::"text", 'pro'::"text", 'business'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "tier" "text" DEFAULT 'personal'::"text" NOT NULL,
    "duration_days" integer DEFAULT 30 NOT NULL,
    "max_uses" integer,
    "current_uses" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "description" "text"
);


ALTER TABLE "public"."promo_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promo_code_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "redeemed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."promo_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."properties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "property_type" "text" DEFAULT 'house'::"text",
    "square_feet" integer,
    "year_built" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nickname" "text",
    "square_footage" integer,
    "purchase_date" "date",
    "is_primary_residence" boolean DEFAULT true,
    "photo_url" "text"
);


ALTER TABLE "public"."properties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."property_maintenance_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "property_id" "uuid" NOT NULL,
    "task" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "interval" "text",
    "estimated_cost" numeric,
    "is_completed" boolean DEFAULT false,
    "last_completed_at" timestamp with time zone,
    "next_due_date" timestamp with time zone,
    "notes" "text",
    "service_type" "text",
    "service_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."property_maintenance_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipt_scans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "asset_type" "text" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'reserved'::"text" NOT NULL,
    "source" "text" DEFAULT 'camera'::"text" NOT NULL,
    "image_path" "text",
    "raw_ocr_response" "jsonb",
    "normalized_output" "jsonb",
    "user_confirmed_output" "jsonb",
    "field_confidence" "jsonb",
    "duplicate_hash" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:10:00'::interval) NOT NULL,
    CONSTRAINT "receipt_scans_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['vehicle'::"text", 'property'::"text", 'health'::"text"]))),
    CONSTRAINT "receipt_scans_source_check" CHECK (("source" = ANY (ARRAY['camera'::"text", 'photo_library'::"text"]))),
    CONSTRAINT "receipt_scans_status_check" CHECK (("status" = ANY (ARRAY['reserved'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'timed_out'::"text"])))
);


ALTER TABLE "public"."receipt_scans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "service_type" "public"."service_type" NOT NULL,
    "contact_method" "public"."contact_method" NOT NULL,
    "status" "public"."lead_status" DEFAULT 'sent'::"public"."lead_status" NOT NULL,
    "maintenance_task_name" "text",
    "maintenance_task_type" "text",
    "user_zip_code" "text",
    "quote_amount" numeric,
    "notes" "text",
    "provider_response_date" timestamp with time zone,
    "booked_date" timestamp with time zone,
    "completed_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."referral_leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."repair_cost_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_key" "text" NOT NULL,
    "service_name" "text" NOT NULL,
    "shop_low" numeric,
    "shop_high" numeric,
    "diy_low" numeric,
    "diy_high" numeric,
    "difficulty" integer,
    "parts_list" "text",
    "estimated_hours" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."repair_cost_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_name" "text" NOT NULL,
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip_code" "text" NOT NULL,
    "address" "text",
    "phone" "text",
    "email" "text",
    "website" "text",
    "description" "text",
    "logo_url" "text",
    "service_types" "public"."service_type"[] NOT NULL,
    "services_offered" "text"[],
    "rating" numeric,
    "review_count" integer,
    "price_range_min" numeric,
    "price_range_max" numeric,
    "service_radius_miles" integer,
    "is_active" boolean DEFAULT true,
    "is_verified" boolean DEFAULT false,
    "is_example" boolean DEFAULT false,
    "is_referral_partner" boolean DEFAULT false,
    "referral_fee_type" "text",
    "referral_fee_amount" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_providers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "from_tier" "text",
    "to_tier" "text",
    "promo_code_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "notifications_enabled" boolean DEFAULT true NOT NULL,
    "push_enabled" boolean DEFAULT false NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "sms_enabled" boolean DEFAULT false NOT NULL,
    "advance_warning_days" integer DEFAULT 7 NOT NULL,
    "digest_frequency" "text" DEFAULT 'weekly'::"text" NOT NULL,
    "quiet_hours_enabled" boolean DEFAULT false NOT NULL,
    "quiet_hours_start" "text",
    "quiet_hours_end" "text",
    "muted_categories" "text"[],
    "muted_vehicles" "text"[],
    "muted_properties" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "budget_threshold" numeric
);


ALTER TABLE "public"."user_notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_owned_tools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_owned_tools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_saved_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_saved_providers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_service_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "task_name" "text" NOT NULL,
    "preferred_service_type" "text" DEFAULT 'diy'::"text" NOT NULL,
    "category" "text",
    "choice_count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_service_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_vehicle_maintenance_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "template_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text" NOT NULL,
    "interval_miles" integer,
    "interval_months" integer,
    "last_completed_date" timestamp with time zone,
    "last_completed_miles" integer,
    "next_due_date" timestamp with time zone,
    "next_due_miles" integer,
    "status" "text" DEFAULT 'upcoming'::"text" NOT NULL,
    "priority" "text" DEFAULT 'recommended'::"text" NOT NULL,
    "is_custom" boolean DEFAULT false NOT NULL,
    "source" "text" DEFAULT 'template'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "interval_hours" integer,
    "last_completed_hours" numeric,
    "next_due_hours" numeric,
    CONSTRAINT "uvmt_interval_hours_nonneg" CHECK ((("interval_hours" IS NULL) OR ("interval_hours" > 0))),
    CONSTRAINT "uvmt_interval_hours_positive" CHECK ((("interval_hours" IS NULL) OR ("interval_hours" > 0))),
    CONSTRAINT "uvmt_last_completed_hours_nonneg" CHECK ((("last_completed_hours" IS NULL) OR ("last_completed_hours" >= (0)::numeric))),
    CONSTRAINT "uvmt_next_due_hours_nonneg" CHECK ((("next_due_hours" IS NULL) OR ("next_due_hours" >= (0)::numeric))),
    CONSTRAINT "uvmt_source_check" CHECK (("source" = ANY (ARRAY['template'::"text", 'custom'::"text", 'ai'::"text"]))),
    CONSTRAINT "uvmt_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'due_soon'::"text", 'overdue'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."user_vehicle_maintenance_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "document_url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vehicle_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_maintenance_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "task" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "priority" "text",
    "interval" "text",
    "mileage_interval" integer,
    "estimated_cost" numeric,
    "is_completed" boolean DEFAULT false,
    "is_applicable" boolean DEFAULT true,
    "is_customized" boolean DEFAULT false,
    "last_completed_at" timestamp with time zone,
    "last_service_mileage" integer,
    "next_due_date" timestamp with time zone,
    "notes" "text",
    "service_type" "text",
    "service_notes" "text",
    "template_source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vehicle_maintenance_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_mileage_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "mileage" integer NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vehicle_mileage_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_wallet_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "vehicle_wallet_documents_type_check" CHECK (("document_type" = ANY (ARRAY['registration'::"text", 'insurance'::"text", 'id_card'::"text"])))
);


ALTER TABLE "public"."vehicle_wallet_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "make" "text" NOT NULL,
    "model" "text" NOT NULL,
    "year" integer NOT NULL,
    "nickname" "text",
    "vin" "text",
    "license_plate" "text",
    "mileage" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "vehicle_type" "text" DEFAULT 'car'::"text" NOT NULL,
    "vehicle_category" "text" DEFAULT 'automobile'::"text" NOT NULL,
    "trim" "text",
    "engine_size" "text",
    "is_seasonal" boolean DEFAULT false NOT NULL,
    "season_start_month" integer,
    "season_end_month" integer,
    "season_preset" "text",
    "motorcycle_type" "text",
    "average_miles_per_month" integer,
    "last_mileage_update" timestamp with time zone,
    "fuel_type" "text" DEFAULT 'gas'::"text" NOT NULL,
    "is_awd" boolean DEFAULT false NOT NULL,
    "photo_url" "text",
    "engine_cylinders" integer,
    "color" "text",
    "hours" numeric,
    "tracking_mode" "text",
    CONSTRAINT "vehicles_tracking_mode_check" CHECK ((("tracking_mode" IS NULL) OR ("tracking_mode" = ANY (ARRAY['mileage'::"text", 'hours'::"text", 'both'::"text", 'time_only'::"text"]))))
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_schedule_cache"
    ADD CONSTRAINT "ai_schedule_cache_cache_key_key" UNIQUE ("cache_key");



ALTER TABLE ONLY "public"."ai_schedule_cache"
    ADD CONSTRAINT "ai_schedule_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budget_notification_tiers"
    ADD CONSTRAINT "budget_notification_tiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."family_members"
    ADD CONSTRAINT "family_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_appointments"
    ADD CONSTRAINT "health_appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_profiles"
    ADD CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_records"
    ADD CONSTRAINT "health_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."interval_corrections"
    ADD CONSTRAINT "interval_corrections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_logs"
    ADD CONSTRAINT "maintenance_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_templates"
    ADD CONSTRAINT "maintenance_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."make_template_overrides"
    ADD CONSTRAINT "make_template_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."make_template_overrides"
    ADD CONSTRAINT "make_template_overrides_unique" UNIQUE ("template_id", "make", "year_start", "year_end");



ALTER TABLE ONLY "public"."manufacturer_schedules"
    ADD CONSTRAINT "manufacturer_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medications"
    ADD CONSTRAINT "medications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_analytics"
    ADD CONSTRAINT "notification_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phi_audit_log"
    ADD CONSTRAINT "phi_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_promo_code_id_user_id_key" UNIQUE ("promo_code_id", "user_id");



ALTER TABLE ONLY "public"."properties"
    ADD CONSTRAINT "properties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."property_maintenance_tasks"
    ADD CONSTRAINT "property_maintenance_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipt_scans"
    ADD CONSTRAINT "receipt_scans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipt_scans"
    ADD CONSTRAINT "receipt_scans_request_id_key" UNIQUE ("request_id");



ALTER TABLE ONLY "public"."referral_leads"
    ADD CONSTRAINT "referral_leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repair_cost_cache"
    ADD CONSTRAINT "repair_cost_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repair_cost_cache"
    ADD CONSTRAINT "repair_cost_cache_vehicle_key_service_name_key" UNIQUE ("vehicle_key", "service_name");



ALTER TABLE ONLY "public"."service_providers"
    ADD CONSTRAINT "service_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_history"
    ADD CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notification_preferences"
    ADD CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_owned_tools"
    ADD CONSTRAINT "user_owned_tools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_saved_providers"
    ADD CONSTRAINT "user_saved_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_service_preferences"
    ADD CONSTRAINT "user_service_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_vehicle_maintenance_tasks"
    ADD CONSTRAINT "user_vehicle_maintenance_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_documents"
    ADD CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_maintenance_tasks"
    ADD CONSTRAINT "vehicle_maintenance_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_mileage_history"
    ADD CONSTRAINT "vehicle_mileage_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_wallet_documents"
    ADD CONSTRAINT "vehicle_wallet_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_wallet_documents"
    ADD CONSTRAINT "vehicle_wallet_documents_unique" UNIQUE ("vehicle_id", "document_type");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_medications_family_member_id" ON "public"."medications" USING "btree" ("family_member_id");



CREATE INDEX "idx_uvmt_user_vehicle" ON "public"."user_vehicle_maintenance_tasks" USING "btree" ("user_id", "vehicle_id");



CREATE INDEX "idx_uvmt_vehicle_status" ON "public"."user_vehicle_maintenance_tasks" USING "btree" ("vehicle_id", "status");



CREATE INDEX "idx_vehicle_wallet_docs_user_vehicle" ON "public"."vehicle_wallet_documents" USING "btree" ("user_id", "vehicle_id", "document_type");



CREATE INDEX "receipt_scans_asset_idx" ON "public"."receipt_scans" USING "btree" ("asset_type", "asset_id");



CREATE INDEX "receipt_scans_duplicate_hash_idx" ON "public"."receipt_scans" USING "btree" ("duplicate_hash") WHERE ("duplicate_hash" IS NOT NULL);



CREATE INDEX "receipt_scans_user_completed_month_idx" ON "public"."receipt_scans" USING "btree" ("user_id", "created_at") WHERE ("status" = 'completed'::"text");



CREATE INDEX "receipt_scans_user_id_idx" ON "public"."receipt_scans" USING "btree" ("user_id");



CREATE INDEX "receipt_scans_user_status_expires_idx" ON "public"."receipt_scans" USING "btree" ("user_id", "status", "expires_at");



CREATE UNIQUE INDEX "user_notification_preferences_user_id_uidx" ON "public"."user_notification_preferences" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "trg_profiles_create_user_notification_preferences" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_user_notification_preferences_from_profile"();



CREATE OR REPLACE TRIGGER "trg_user_notification_preferences_updated_at" BEFORE UPDATE ON "public"."user_notification_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_user_notification_preferences_updated_at"();



CREATE OR REPLACE TRIGGER "trg_uvmt_updated_at" BEFORE UPDATE ON "public"."user_vehicle_maintenance_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_uvmt_updated_at"();



CREATE OR REPLACE TRIGGER "update_health_records_updated_at" BEFORE UPDATE ON "public"."health_records" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_properties_updated_at" BEFORE UPDATE ON "public"."properties" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_vehicles_updated_at" BEFORE UPDATE ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."budget_notification_tiers"
    ADD CONSTRAINT "budget_notification_tiers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."family_members"
    ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."health_appointments"
    ADD CONSTRAINT "health_appointments_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."health_appointments"
    ADD CONSTRAINT "health_appointments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."health_profiles"
    ADD CONSTRAINT "health_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interval_corrections"
    ADD CONSTRAINT "interval_corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interval_corrections"
    ADD CONSTRAINT "interval_corrections_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_logs"
    ADD CONSTRAINT "maintenance_logs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."maintenance_logs"
    ADD CONSTRAINT "maintenance_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_logs"
    ADD CONSTRAINT "maintenance_logs_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."make_template_overrides"
    ADD CONSTRAINT "make_template_overrides_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."maintenance_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manufacturer_schedules"
    ADD CONSTRAINT "manufacturer_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."manufacturer_schedules"
    ADD CONSTRAINT "manufacturer_schedules_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."medications"
    ADD CONSTRAINT "medications_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."medications"
    ADD CONSTRAINT "medications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_analytics"
    ADD CONSTRAINT "notification_analytics_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_analytics"
    ADD CONSTRAINT "notification_analytics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phi_audit_log"
    ADD CONSTRAINT "phi_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promo_redemptions"
    ADD CONSTRAINT "promo_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."property_maintenance_tasks"
    ADD CONSTRAINT "property_maintenance_tasks_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."property_maintenance_tasks"
    ADD CONSTRAINT "property_maintenance_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipt_scans"
    ADD CONSTRAINT "receipt_scans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_leads"
    ADD CONSTRAINT "referral_leads_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referral_leads"
    ADD CONSTRAINT "referral_leads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_history"
    ADD CONSTRAINT "subscription_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notification_preferences"
    ADD CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_owned_tools"
    ADD CONSTRAINT "user_owned_tools_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_saved_providers"
    ADD CONSTRAINT "user_saved_providers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_saved_providers"
    ADD CONSTRAINT "user_saved_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_service_preferences"
    ADD CONSTRAINT "user_service_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_vehicle_maintenance_tasks"
    ADD CONSTRAINT "user_vehicle_maintenance_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."maintenance_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_vehicle_maintenance_tasks"
    ADD CONSTRAINT "user_vehicle_maintenance_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_vehicle_maintenance_tasks"
    ADD CONSTRAINT "user_vehicle_maintenance_tasks_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_documents"
    ADD CONSTRAINT "vehicle_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_documents"
    ADD CONSTRAINT "vehicle_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_maintenance_tasks"
    ADD CONSTRAINT "vehicle_maintenance_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_maintenance_tasks"
    ADD CONSTRAINT "vehicle_maintenance_tasks_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_mileage_history"
    ADD CONSTRAINT "vehicle_mileage_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_mileage_history"
    ADD CONSTRAINT "vehicle_mileage_history_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_wallet_documents"
    ADD CONSTRAINT "vehicle_wallet_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_wallet_documents"
    ADD CONSTRAINT "vehicle_wallet_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can read maintenance_templates" ON "public"."maintenance_templates" FOR SELECT USING (true);



CREATE POLICY "Anyone can read repair costs" ON "public"."repair_cost_cache" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Anyone can read service_providers" ON "public"."service_providers" FOR SELECT USING (true);



CREATE POLICY "Service role can insert repair costs" ON "public"."repair_cost_cache" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Service role full access" ON "public"."ai_schedule_cache" USING (true) WITH CHECK (true);



CREATE POLICY "Service role full access" ON "public"."interval_corrections" TO "service_role" USING (true);



CREATE POLICY "Service role only" ON "public"."promo_codes" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role only" ON "public"."promo_redemptions" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Users can delete their own health records" ON "public"."health_records" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own profile" ON "public"."profiles" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own properties" ON "public"."properties" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own vehicles" ON "public"."vehicles" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own corrections" ON "public"."interval_corrections" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own health records" ON "public"."health_records" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own properties" ON "public"."properties" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own vehicles" ON "public"."vehicles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own health records" ON "public"."health_records" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own properties" ON "public"."properties" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own vehicles" ON "public"."vehicles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own health records" ON "public"."health_records" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own properties" ON "public"."properties" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own vehicles" ON "public"."vehicles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own budget_notification_tiers" ON "public"."budget_notification_tiers" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own family_members" ON "public"."family_members" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own health_appointments" ON "public"."health_appointments" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own health_profiles" ON "public"."health_profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own maintenance_logs" ON "public"."maintenance_logs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own manufacturer_schedules" ON "public"."manufacturer_schedules" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own medications" ON "public"."medications" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own notification_analytics" ON "public"."notification_analytics" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own notifications" ON "public"."notifications" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own phi_audit_log" ON "public"."phi_audit_log" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own property_maintenance_tasks" ON "public"."property_maintenance_tasks" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own referral_leads" ON "public"."referral_leads" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own subscription_history" ON "public"."subscription_history" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own user_notification_preferences" ON "public"."user_notification_preferences" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own user_owned_tools" ON "public"."user_owned_tools" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own user_saved_providers" ON "public"."user_saved_providers" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own user_service_preferences" ON "public"."user_service_preferences" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own vehicle_documents" ON "public"."vehicle_documents" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own vehicle_maintenance_tasks" ON "public"."vehicle_maintenance_tasks" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own vehicle_mileage_history" ON "public"."vehicle_mileage_history" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own user_roles" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."ai_schedule_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_notification_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."family_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."health_appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."health_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."health_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."interval_corrections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "maintenance_templates_select_auth" ON "public"."maintenance_templates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."make_template_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "make_template_overrides_select_auth" ON "public"."make_template_overrides" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."manufacturer_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phi_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promo_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promo_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."properties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."property_maintenance_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."receipt_scans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "receipt_scans_select_own" ON "public"."receipt_scans" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."referral_leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repair_cost_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_providers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_owned_tools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_saved_providers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_service_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_vehicle_maintenance_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "uvmt_delete" ON "public"."user_vehicle_maintenance_tasks" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "uvmt_insert" ON "public"."user_vehicle_maintenance_tasks" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "uvmt_select" ON "public"."user_vehicle_maintenance_tasks" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "uvmt_update" ON "public"."user_vehicle_maintenance_tasks" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."vehicle_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_maintenance_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_mileage_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_wallet_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wallet_delete" ON "public"."vehicle_wallet_documents" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "wallet_insert" ON "public"."vehicle_wallet_documents" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "wallet_select" ON "public"."vehicle_wallet_documents" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "wallet_update" ON "public"."vehicle_wallet_documents" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."_lm_col_exists"("p_table" "text", "p_col" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_lm_col_exists"("p_table" "text", "p_col" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lm_col_exists"("p_table" "text", "p_col" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_lm_seed_insert"("p_table" "text", "p_row" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."_lm_seed_insert"("p_table" "text", "p_row" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lm_seed_insert"("p_table" "text", "p_row" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."_lm_table_exists"("p_table" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_lm_table_exists"("p_table" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lm_table_exists"("p_table" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_normalized_output" "jsonb", "p_raw_ocr_response" "jsonb", "p_field_confidence" "jsonb", "p_duplicate_hash" "text", "p_image_path" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_normalized_output" "jsonb", "p_raw_ocr_response" "jsonb", "p_field_confidence" "jsonb", "p_duplicate_hash" "text", "p_image_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_normalized_output" "jsonb", "p_raw_ocr_response" "jsonb", "p_field_confidence" "jsonb", "p_duplicate_hash" "text", "p_image_path" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_vehicle_task"("p_task_id" "uuid", "p_mileage" numeric, "p_hours" numeric, "p_completed_date" timestamp with time zone, "p_notes" "text", "p_cost" numeric, "p_skip_log" boolean, "p_provider_name" "text", "p_did_it_myself" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."complete_vehicle_task"("p_task_id" "uuid", "p_mileage" numeric, "p_hours" numeric, "p_completed_date" timestamp with time zone, "p_notes" "text", "p_cost" numeric, "p_skip_log" boolean, "p_provider_name" "text", "p_did_it_myself" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_vehicle_task"("p_task_id" "uuid", "p_mileage" numeric, "p_hours" numeric, "p_completed_date" timestamp with time zone, "p_notes" "text", "p_cost" numeric, "p_skip_log" boolean, "p_provider_name" "text", "p_did_it_myself" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_user_notification_preferences_from_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_user_notification_preferences_from_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_user_notification_preferences_from_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fail_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_error_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fail_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_error_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_error_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_scan_quota"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_scan_quota"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_scan_quota"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_role" "public"."app_role", "_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_role" "public"."app_role", "_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_role" "public"."app_role", "_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_receipt_scan_processing"("p_request_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_receipt_scan_processing"("p_request_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_receipt_scan_processing"("p_request_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reserve_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_asset_type" "text", "p_asset_id" "uuid", "p_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_asset_type" "text", "p_asset_id" "uuid", "p_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_receipt_scan"("p_request_id" "uuid", "p_user_id" "uuid", "p_asset_type" "text", "p_asset_id" "uuid", "p_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_user_notification_preferences_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_user_notification_preferences_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_user_notification_preferences_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."timeout_stale_scans"() TO "anon";
GRANT ALL ON FUNCTION "public"."timeout_stale_scans"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."timeout_stale_scans"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_uvmt_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_uvmt_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_uvmt_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."ai_schedule_cache" TO "anon";
GRANT ALL ON TABLE "public"."ai_schedule_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_schedule_cache" TO "service_role";



GRANT ALL ON TABLE "public"."budget_notification_tiers" TO "anon";
GRANT ALL ON TABLE "public"."budget_notification_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_notification_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."family_members" TO "anon";
GRANT ALL ON TABLE "public"."family_members" TO "authenticated";
GRANT ALL ON TABLE "public"."family_members" TO "service_role";



GRANT ALL ON TABLE "public"."health_appointments" TO "anon";
GRANT ALL ON TABLE "public"."health_appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."health_appointments" TO "service_role";



GRANT ALL ON TABLE "public"."health_profiles" TO "anon";
GRANT ALL ON TABLE "public"."health_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."health_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."health_records" TO "anon";
GRANT ALL ON TABLE "public"."health_records" TO "authenticated";
GRANT ALL ON TABLE "public"."health_records" TO "service_role";



GRANT ALL ON TABLE "public"."interval_corrections" TO "anon";
GRANT ALL ON TABLE "public"."interval_corrections" TO "authenticated";
GRANT ALL ON TABLE "public"."interval_corrections" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_logs" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_logs" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_templates" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_templates" TO "service_role";



GRANT ALL ON TABLE "public"."make_template_overrides" TO "anon";
GRANT ALL ON TABLE "public"."make_template_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."make_template_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."manufacturer_schedules" TO "anon";
GRANT ALL ON TABLE "public"."manufacturer_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."manufacturer_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."medications" TO "anon";
GRANT ALL ON TABLE "public"."medications" TO "authenticated";
GRANT ALL ON TABLE "public"."medications" TO "service_role";



GRANT ALL ON TABLE "public"."notification_analytics" TO "anon";
GRANT ALL ON TABLE "public"."notification_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."phi_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."phi_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."phi_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."promo_codes" TO "anon";
GRANT ALL ON TABLE "public"."promo_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_codes" TO "service_role";



GRANT ALL ON TABLE "public"."promo_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."promo_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."properties" TO "anon";
GRANT ALL ON TABLE "public"."properties" TO "authenticated";
GRANT ALL ON TABLE "public"."properties" TO "service_role";



GRANT ALL ON TABLE "public"."property_maintenance_tasks" TO "anon";
GRANT ALL ON TABLE "public"."property_maintenance_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."property_maintenance_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."receipt_scans" TO "anon";
GRANT ALL ON TABLE "public"."receipt_scans" TO "authenticated";
GRANT ALL ON TABLE "public"."receipt_scans" TO "service_role";



GRANT ALL ON TABLE "public"."referral_leads" TO "anon";
GRANT ALL ON TABLE "public"."referral_leads" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_leads" TO "service_role";



GRANT ALL ON TABLE "public"."repair_cost_cache" TO "anon";
GRANT ALL ON TABLE "public"."repair_cost_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."repair_cost_cache" TO "service_role";



GRANT ALL ON TABLE "public"."service_providers" TO "anon";
GRANT ALL ON TABLE "public"."service_providers" TO "authenticated";
GRANT ALL ON TABLE "public"."service_providers" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_history" TO "anon";
GRANT ALL ON TABLE "public"."subscription_history" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_history" TO "service_role";



GRANT ALL ON TABLE "public"."user_notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_owned_tools" TO "anon";
GRANT ALL ON TABLE "public"."user_owned_tools" TO "authenticated";
GRANT ALL ON TABLE "public"."user_owned_tools" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_saved_providers" TO "anon";
GRANT ALL ON TABLE "public"."user_saved_providers" TO "authenticated";
GRANT ALL ON TABLE "public"."user_saved_providers" TO "service_role";



GRANT ALL ON TABLE "public"."user_service_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_service_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_service_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_vehicle_maintenance_tasks" TO "anon";
GRANT ALL ON TABLE "public"."user_vehicle_maintenance_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."user_vehicle_maintenance_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_documents" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_documents" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_maintenance_tasks" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_maintenance_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_maintenance_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_mileage_history" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_mileage_history" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_mileage_history" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_wallet_documents" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_wallet_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_wallet_documents" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







