-- Migration: complete_vehicle_task v5
--
-- Production columns user_vehicle_maintenance_tasks.last_completed_date and
-- next_due_date are timestamptz. The v4 function body wrote text values
-- (via to_char(... 'YYYY-MM-DD')) into those columns, which Postgres rejects
-- with: 42804 'column "last_completed_date" is of type timestamp with time
-- zone but expression is of type text'. The error surfaced on every phone
-- mark-complete attempt because PostgREST returns it as a generic 500 and
-- the client catch fired the "Failed to save" toast.
--
-- This migration keeps the v4 signature exactly so the existing PostgREST
-- named-arg resolution and lib/rpc.ts wrapper continue to work unchanged.
-- Only the body changes: column writes now use timestamptz directly, and
-- the JSON response still returns ISO date strings for the client.

CREATE OR REPLACE FUNCTION public.complete_vehicle_task(
  p_task_id        uuid,
  p_mileage        numeric     DEFAULT NULL,
  p_hours          numeric     DEFAULT NULL,
  p_completed_date timestamptz DEFAULT now(),
  p_notes          text        DEFAULT NULL,
  p_cost           numeric     DEFAULT NULL,
  p_skip_log       boolean     DEFAULT false,
  p_provider_name  text        DEFAULT NULL,
  p_did_it_myself  boolean     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task             record;
  v_vehicle          record;
  v_mode             text;
  v_user_id          uuid;
  v_completed_ts     timestamptz;
  v_next_due_ts      timestamptz;
  v_next_due_miles   integer;
  v_next_due_hours   numeric;
  v_mileage_int      integer;
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

  -- Use the parameter directly as a timestamptz
  v_completed_ts := p_completed_date;

  -- Mileage column is integer; cast safely
  IF p_mileage IS NOT NULL THEN
    v_mileage_int := p_mileage::integer;
  END IF;

  -- Compute next-due values from task intervals
  IF v_mode IN ('mileage', 'both')
     AND v_mileage_int IS NOT NULL
     AND v_task.interval_miles IS NOT NULL
     AND v_task.interval_miles > 0
  THEN
    v_next_due_miles := v_mileage_int + v_task.interval_miles;
  END IF;

  IF v_mode IN ('hours', 'both')
     AND p_hours IS NOT NULL
     AND v_task.interval_hours IS NOT NULL
     AND v_task.interval_hours > 0
  THEN
    v_next_due_hours := p_hours + v_task.interval_hours;
  END IF;

  IF v_task.interval_months IS NOT NULL AND v_task.interval_months > 0 THEN
    v_next_due_ts := v_completed_ts + (v_task.interval_months || ' months')::interval;
  END IF;

  -- Update the task. All column writes use native types matching the schema.
  UPDATE user_vehicle_maintenance_tasks SET
    last_completed_date  = v_completed_ts,
    last_completed_miles = CASE WHEN v_mode IN ('mileage', 'both') THEN v_mileage_int    ELSE NULL END,
    last_completed_hours = CASE WHEN v_mode IN ('hours',   'both') THEN p_hours          ELSE NULL END,
    next_due_miles       = CASE WHEN v_mode IN ('mileage', 'both') THEN v_next_due_miles ELSE NULL END,
    next_due_hours       = CASE WHEN v_mode IN ('hours',   'both') THEN v_next_due_hours ELSE NULL END,
    next_due_date        = v_next_due_ts,
    status               = 'upcoming',
    updated_at           = now()
  WHERE id = p_task_id;

  -- Update vehicle mileage if the new reading is higher
  IF v_mode IN ('mileage', 'both')
     AND v_mileage_int IS NOT NULL
     AND v_mileage_int > COALESCE(v_vehicle.mileage, 0)
  THEN
    UPDATE vehicles
       SET mileage = v_mileage_int,
           last_mileage_update = now(),
           updated_at = now()
     WHERE id = v_vehicle.id;

    -- Record mileage history only when mileage increased.
    -- The BEFORE INSERT trigger set_vehicle_mileage_history_user_id_before_insert
    -- fills in user_id from the parent vehicle, so we don't pass it here.
    INSERT INTO vehicle_mileage_history (vehicle_id, mileage, recorded_at, created_at)
    VALUES (v_vehicle.id, v_mileage_int, v_completed_ts, now());
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
      v_completed_ts,
      COALESCE(v_mileage_int, p_hours::integer),
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

  -- Return ISO date strings in the JSON response so the client can parse them.
  RETURN jsonb_build_object(
    'task_name',      v_task.name,
    'vehicle_name',   v_vehicle_name,
    'next_due_date',  to_char(v_next_due_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
    'next_due_miles', v_next_due_miles,
    'next_due_hours', v_next_due_hours
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_vehicle_task(
  uuid, numeric, numeric, timestamptz, text, numeric, boolean, text, boolean
) TO authenticated;
