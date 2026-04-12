-- Migration: complete_property_task
-- Atomic property task completion: updates the task row and inserts the
-- maintenance_logs row in a single transaction. Mirrors complete_vehicle_task v3.
--
-- next_due_date is computed server-side from the interval text column using
-- the same mapping as the client's INTERVAL_MONTHS constant. The interval
-- column is intentionally kept as text in this migration — converting to a
-- numeric interval_months column is tracked separately and out of scope here.

DROP FUNCTION IF EXISTS public.complete_property_task(
  uuid,
  timestamptz,
  text,
  numeric,
  text,
  boolean
);

CREATE FUNCTION public.complete_property_task(
  p_task_id        uuid,
  p_completed_date timestamptz DEFAULT now(),
  p_notes          text        DEFAULT NULL,
  p_cost           numeric     DEFAULT NULL,
  p_provider_name  text        DEFAULT NULL,
  p_did_it_myself  boolean     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task           record;
  v_property       record;
  v_user_id        uuid;
  v_completed_str  text;
  v_completed_iso  timestamptz;
  v_interval_months integer;
  v_next_due_date  text;
  v_property_name  text;
BEGIN
  -- Require authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load task and verify caller owns it (through property)
  SELECT t.*
    INTO v_task
    FROM property_maintenance_tasks t
    JOIN properties p ON p.id = t.property_id
   WHERE t.id = p_task_id
     AND t.user_id = v_user_id
     AND p.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;

  -- Load property row for the response payload
  SELECT * INTO v_property FROM properties WHERE id = v_task.property_id;

  -- Resolve interval text to months. Mirrors INTERVAL_MONTHS in app/property/[id].tsx.
  -- "As Needed" defaults to 12 months matching client behavior.
  v_interval_months := CASE LOWER(COALESCE(v_task.interval, ''))
    WHEN 'monthly'        THEN 1
    WHEN 'quarterly'      THEN 3
    WHEN 'bi-annually'    THEN 6
    WHEN 'annually'       THEN 12
    WHEN 'every 2 years'  THEN 24
    WHEN 'every 5 years'  THEN 60
    WHEN 'as needed'      THEN 12
    WHEN '3_months'       THEN 3
    WHEN '6_months'       THEN 6
    WHEN '12_months'      THEN 12
    WHEN '24_months'      THEN 24
    WHEN '36_months'      THEN 36
    WHEN '60_months'      THEN 60
    ELSE                       12
  END;

  -- Compute next due date as YYYY-MM-DD string
  v_next_due_date := to_char(
    (p_completed_date AT TIME ZONE 'UTC')::date + (v_interval_months || ' months')::interval,
    'YYYY-MM-DD'
  );

  -- Completed timestamp for last_completed_at (timestamptz)
  v_completed_iso := p_completed_date;
  v_completed_str := to_char(p_completed_date AT TIME ZONE 'UTC', 'YYYY-MM-DD');

  -- Update the task row
  UPDATE property_maintenance_tasks
     SET last_completed_at = v_completed_iso,
         next_due_date     = v_next_due_date,
         updated_at        = now()
   WHERE id = p_task_id;

  -- Insert the maintenance log entry
  INSERT INTO maintenance_logs (
    user_id, vehicle_id, property_id, service_name, service_date,
    cost, mileage, provider_name, notes, did_it_myself
  ) VALUES (
    v_user_id, NULL, v_task.property_id, v_task.task, v_completed_str,
    p_cost, NULL, p_provider_name, p_notes, p_did_it_myself
  );

  -- Build response payload
  v_property_name := COALESCE(
    v_property.nickname,
    v_property.address,
    'Property'
  );

  RETURN jsonb_build_object(
    'task_id',         p_task_id,
    'task_name',       v_task.task,
    'property_id',     v_task.property_id,
    'property_name',   v_property_name,
    'completed_date',  v_completed_str,
    'next_due_date',   v_next_due_date,
    'interval_months', v_interval_months,
    'log_created',     true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_property_task(
  uuid, timestamptz, text, numeric, text, boolean
) TO authenticated;
