-- import_fleet: idempotency ledger + atomic bulk-commit RPC for fleet import.
-- Ledger is not client-readable; only the definer function touches it.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.import_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  created_vehicle_ids uuid[] NOT NULL DEFAULT '{}',
  created_log_count integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_requests_user_request_unique UNIQUE (user_id, request_id)
);

ALTER TABLE public.import_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.import_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.import_requests FROM anon;
REVOKE ALL ON TABLE public.import_requests FROM authenticated;

CREATE OR REPLACE FUNCTION public.import_fleet_commit(
  p_request_id uuid,
  p_vehicles jsonb,
  p_logs jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_hash text;
  v_existing record;
  v_tier text;
  v_trial timestamptz;
  v_sub timestamptz;
  v_limit integer;             -- NULL = unlimited
  v_existing_count integer;
  v_incoming integer;
  v_veh jsonb;
  v_log jsonb;
  v_temp_map jsonb := '{}'::jsonb;
  v_new_id uuid;
  v_created_ids uuid[] := '{}';
  v_inserted_logs integer := 0;
  v_temp_id text;
  v_vin text;
  v_fuel text; v_cat text; v_vtype text; v_track text;
  v_result jsonb;
  v_now timestamptz := now();
  -- Allowlists mirrored from client constants (STEP 0.4e):
  --   fuel_type        <- FUEL_TYPES, app/add-vehicle.tsx:325
  --   vehicle_type     <- VEHICLE_TYPE_GROUPS, app/add-vehicle.tsx:255 (flattened :319)
  --   vehicle_category <- selectedVehicleCategory, app/add-vehicle.tsx:709, which maps
  --                       'dump_truck' to a dumpTruckSubtype (app/add-vehicle.tsx:634),
  --                       so 'dump_truck' itself is never a category value
  --   tracking_mode    <- vehicles_tracking_mode_check, schema.sql:1524. The DB CHECK is
  --                       the authority here, NOT the client: add-vehicle.tsx:1074 writes
  --                       'time', which the CHECK rejects. Admitting it would abort the
  --                       whole import transaction on one bad row.
  v_fuel_allowed  text[] := ARRAY['gas','diesel','hybrid','ev'];
  v_cat_allowed   text[] := ARRAY['car','motorcycle','semi_truck','rv','atv','utv','snowmobile','boat','pwc','lawnmower','chainsaw','generator','snow_blower','pressure_washer','wood_chipper','stump_grinder','concrete_saw','welder','excavator','skid_steer','mini_excavator','compact_track_loader','backhoe','wheel_loader','telehandler','forklift','standard_dump','roll_off','hook_lift','trailer','dumpster','other'];
  v_vtype_allowed text[] := ARRAY['car','motorcycle','semi_truck','rv','atv','utv','snowmobile','boat','pwc','lawnmower','chainsaw','generator','snow_blower','pressure_washer','wood_chipper','stump_grinder','concrete_saw','welder','excavator','skid_steer','mini_excavator','compact_track_loader','backhoe','wheel_loader','telehandler','forklift','dump_truck','trailer','dumpster','other'];
  v_track_allowed text[] := ARRAY['mileage','hours','both','time_only'];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request_id';
  END IF;

  -- 64-bit per-user serialization: closes concurrent double-submit + cap TOCTOU.
  PERFORM pg_advisory_xact_lock(hashtextextended('import_fleet:' || v_user::text, 0));

  -- Abuse bound on raw payload size (jsonb, post-parse).
  IF pg_column_size(p_vehicles) + pg_column_size(p_logs) > 8000000 THEN
    RAISE EXCEPTION 'payload_too_large';
  END IF;

  -- Server-computed idempotency hash (jsonb text form is key-order normalized).
  v_hash := encode(extensions.digest(convert_to(p_vehicles::text || '|' || p_logs::text, 'UTF8'), 'sha256'), 'hex');

  -- Replay: same request_id + same payload -> return original result.
  SELECT payload_hash, result INTO v_existing
    FROM public.import_requests
    WHERE user_id = v_user AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'request_id_payload_mismatch';
    END IF;
    RETURN jsonb_set(v_existing.result, '{replayed}', 'true'::jsonb);
  END IF;

  -- Shape caps.
  IF p_vehicles IS NULL OR jsonb_typeof(p_vehicles) <> 'array'
     OR jsonb_array_length(p_vehicles) < 1 OR jsonb_array_length(p_vehicles) > 50 THEN
    RAISE EXCEPTION 'invalid_vehicles_payload';
  END IF;
  IF p_logs IS NULL OR jsonb_typeof(p_logs) <> 'array'
     OR jsonb_array_length(p_logs) > 5000 THEN
    RAISE EXCEPTION 'invalid_logs_payload';
  END IF;
  v_incoming := jsonb_array_length(p_vehicles);

  -- Paid-tier requirement + cap, mirroring _shared/tierGate.ts + vehicleLimit
  -- (values verified against lib/subscription.ts at build time; STEP 0.4d).
  -- DISK TRUTH: vehicleLimit (lib/subscription.ts:76) routes an unexpired trial
  -- through hasProOrAbove (lib/subscription.ts:44), so a trial caps at 6, not 3.
  SELECT subscription_tier, trial_expires_at, subscription_expires_at
    INTO v_tier, v_trial, v_sub
    FROM public.profiles WHERE user_id = v_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_tier = 'business' AND v_sub IS NOT NULL AND v_sub > v_now THEN
    v_limit := NULL;
  ELSIF (v_tier = 'pro' AND v_sub IS NOT NULL AND v_sub > v_now)
     OR (v_tier = 'trial' AND v_trial IS NOT NULL AND v_trial > v_now) THEN
    v_limit := 6;
  ELSIF v_tier = 'personal' AND v_sub IS NOT NULL AND v_sub > v_now THEN
    v_limit := 3;
  ELSE
    RAISE EXCEPTION 'paid_tier_required';
  END IF;

  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_existing_count FROM public.vehicles WHERE user_id = v_user;
    IF v_existing_count + v_incoming > v_limit THEN
      RAISE EXCEPTION 'vehicle_cap_exceeded';
    END IF;
  END IF;

  -- Vehicles: sequential validate-THEN-cast; a regex guard always precedes and
  -- gates its cast in a SEPARATE statement (Postgres does not guarantee boolean
  -- short-circuit order).
  FOR v_veh IN SELECT * FROM jsonb_array_elements(p_vehicles) LOOP
    v_temp_id := v_veh->>'temp_id';
    IF v_temp_id IS NULL OR v_temp_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_temp_id';
    END IF;
    IF v_temp_map ? v_temp_id THEN
      RAISE EXCEPTION 'duplicate_temp_id';
    END IF;
    IF length(btrim(coalesce(v_veh->>'make',''))) NOT BETWEEN 1 AND 80
       OR length(btrim(coalesce(v_veh->>'model',''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_vehicle_fields';
    END IF;
    IF coalesce(v_veh->>'year','') !~ '^(19|20)[0-9]{2}$' THEN
      RAISE EXCEPTION 'invalid_vehicle_year';
    END IF;
    IF v_veh->>'mileage' IS NOT NULL THEN
      IF v_veh->>'mileage' !~ '^[0-9]{1,7}$' THEN
        RAISE EXCEPTION 'invalid_vehicle_mileage';
      END IF;
      IF (v_veh->>'mileage')::int > 2000000 THEN
        RAISE EXCEPTION 'invalid_vehicle_mileage';
      END IF;
    END IF;
    IF v_veh->>'hours' IS NOT NULL THEN
      IF v_veh->>'hours' !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'invalid_vehicle_hours';
      END IF;
      IF (v_veh->>'hours')::numeric > 500000 THEN
        RAISE EXCEPTION 'invalid_vehicle_hours';
      END IF;
    END IF;
    v_vin := nullif(upper(btrim(coalesce(v_veh->>'vin',''))), '');
    IF v_vin IS NOT NULL AND v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN
      RAISE EXCEPTION 'invalid_vehicle_vin';
    END IF;
    -- Enum normalization: value outside the allowlist -> NULL (DB default wins).
    v_fuel  := lower(btrim(coalesce(v_veh->>'fuel_type','')));
    v_cat   := lower(btrim(coalesce(v_veh->>'vehicle_category','')));
    v_vtype := lower(btrim(coalesce(v_veh->>'vehicle_type','')));
    v_track := lower(btrim(coalesce(v_veh->>'tracking_mode','')));
    IF v_fuel  = '' OR NOT (v_fuel  = ANY(v_fuel_allowed))  THEN v_fuel  := NULL; END IF;
    IF v_cat   = '' OR NOT (v_cat   = ANY(v_cat_allowed))   THEN v_cat   := NULL; END IF;
    IF v_vtype = '' OR NOT (v_vtype = ANY(v_vtype_allowed)) THEN v_vtype := NULL; END IF;
    IF v_track = '' OR NOT (v_track = ANY(v_track_allowed)) THEN v_track := NULL; END IF;

    INSERT INTO public.vehicles (
      user_id, make, model, year,
      nickname, vin, license_plate,
      mileage, hours,
      fuel_type, vehicle_category, vehicle_type, tracking_mode,
      last_mileage_update, last_hours_update,
      created_at, updated_at
    )
    SELECT
      v_user,
      btrim(v_veh->>'make'),
      btrim(v_veh->>'model'),
      (v_veh->>'year')::int,
      nullif(left(btrim(coalesce(v_veh->>'nickname','')), 80), ''),
      v_vin,
      nullif(left(btrim(coalesce(v_veh->>'license_plate','')), 20), ''),
      (v_veh->>'mileage')::int,
      (v_veh->>'hours')::numeric,
      coalesce(v_fuel,  'gas'),         -- vehicles.fuel_type DB default, schema.sql:1517
      coalesce(v_cat,   'automobile'),  -- vehicles.vehicle_category DB default, schema.sql:1507
      coalesce(v_vtype, 'car'),         -- vehicles.vehicle_type DB default, schema.sql:1506
      v_track,                          -- vehicles.tracking_mode is nullable with NO DB
                                        -- default (schema.sql:1523); a coalesce here
                                        -- would invent a value, so an unrecognized
                                        -- tracking_mode stays NULL - exactly what the
                                        -- column holds when nothing is supplied.
      CASE WHEN v_veh->>'mileage' IS NOT NULL THEN v_now END,
      CASE WHEN v_veh->>'hours' IS NOT NULL THEN v_now END,
      v_now, v_now
    RETURNING id INTO v_new_id;

    v_temp_map := v_temp_map || jsonb_build_object(v_temp_id, v_new_id::text);
    v_created_ids := array_append(v_created_ids, v_new_id);
  END LOOP;

  -- Logs: every row must resolve; sequential validate-then-cast.
  FOR v_log IN SELECT * FROM jsonb_array_elements(p_logs) LOOP
    v_temp_id := v_log->>'vehicle_temp_id';
    IF v_temp_id IS NULL OR NOT (v_temp_map ? v_temp_id) THEN
      RAISE EXCEPTION 'log_vehicle_ref_unresolved';
    END IF;
    IF length(btrim(coalesce(v_log->>'service_name',''))) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'invalid_log_service_name';
    END IF;
    IF coalesce(v_log->>'service_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'invalid_log_service_date';
    END IF;
    IF (v_log->>'service_date')::date > (v_now + interval '1 day')::date
       OR (v_log->>'service_date')::date < DATE '1980-01-01' THEN
      RAISE EXCEPTION 'invalid_log_service_date';
    END IF;
    IF v_log->>'cost' IS NOT NULL THEN
      IF v_log->>'cost' !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'invalid_log_cost';
      END IF;
      IF (v_log->>'cost')::numeric > 1000000 THEN
        RAISE EXCEPTION 'invalid_log_cost';
      END IF;
    END IF;
    IF v_log->>'mileage' IS NOT NULL THEN
      IF v_log->>'mileage' !~ '^[0-9]{1,7}$' THEN
        RAISE EXCEPTION 'invalid_log_mileage';
      END IF;
      IF (v_log->>'mileage')::int > 2000000 THEN
        RAISE EXCEPTION 'invalid_log_mileage';
      END IF;
    END IF;
    IF v_log->>'hours' IS NOT NULL THEN
      IF v_log->>'hours' !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'invalid_log_hours';
      END IF;
      IF (v_log->>'hours')::numeric > 500000 THEN
        RAISE EXCEPTION 'invalid_log_hours';
      END IF;
    END IF;

    INSERT INTO public.maintenance_logs (
      user_id, vehicle_id, service_name, service_date,
      cost, mileage, hours, notes, provider_name,
      created_at, updated_at
    ) VALUES (
      v_user,
      (v_temp_map->>v_temp_id)::uuid,
      btrim(v_log->>'service_name'),
      (v_log->>'service_date')::date,
      (v_log->>'cost')::numeric,
      (v_log->>'mileage')::int,
      (v_log->>'hours')::numeric,
      nullif(left(coalesce(v_log->>'notes',''), 500), ''),
      nullif(left(btrim(coalesce(v_log->>'provider_name','')), 200), ''),
      v_now, v_now
    );
    v_inserted_logs := v_inserted_logs + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'replayed', false,
    'vehicle_ids', to_jsonb(v_created_ids),
    'temp_map', v_temp_map,
    'log_count', v_inserted_logs
  );

  INSERT INTO public.import_requests
    (user_id, request_id, payload_hash, created_vehicle_ids, created_log_count, result)
  VALUES
    (v_user, p_request_id, v_hash, v_created_ids, v_inserted_logs, v_result);

  RETURN v_result;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range
       OR datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'invalid_payload_format';
END;
$$;

REVOKE ALL ON FUNCTION public.import_fleet_commit(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_fleet_commit(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_fleet_commit(uuid, jsonb, jsonb) TO authenticated;
