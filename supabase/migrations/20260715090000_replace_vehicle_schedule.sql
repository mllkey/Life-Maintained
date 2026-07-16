-- Packet B: atomic schedule replacement for generate-maintenance-schedule.
-- Deletes the old non-custom schedule and inserts the new one in ONE
-- transaction, so a failed generation can never destroy an existing schedule.
CREATE OR REPLACE FUNCTION public.replace_vehicle_schedule(
  p_vehicle_id uuid,
  p_user_id uuid,
  p_clear_non_custom boolean,
  p_tasks jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array' THEN
    RAISE EXCEPTION 'p_tasks must be a jsonb array';
  END IF;

  IF jsonb_array_length(p_tasks) = 0 THEN
    RAISE EXCEPTION 'p_tasks must not be empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vehicles WHERE id = p_vehicle_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'vehicle not owned by user';
  END IF;

  IF p_clear_non_custom THEN
    DELETE FROM user_vehicle_maintenance_tasks
    WHERE vehicle_id = p_vehicle_id
      AND is_custom IS DISTINCT FROM true;
  END IF;

  INSERT INTO user_vehicle_maintenance_tasks (
    user_id, vehicle_id, template_id, name, description, category,
    interval_miles, interval_hours, interval_months,
    last_completed_date, last_completed_miles, last_completed_hours,
    next_due_miles, next_due_hours, next_due_date,
    status, priority, is_custom, source
  )
  SELECT
    p_user_id,
    p_vehicle_id,
    (t->>'template_id')::uuid,
    t->>'name',
    t->>'description',
    t->>'category',
    round((t->>'interval_miles')::numeric)::integer,
    round((t->>'interval_hours')::numeric)::integer,
    round((t->>'interval_months')::numeric)::integer,
    NULL, NULL, NULL,
    round((t->>'next_due_miles')::numeric)::integer,
    (t->>'next_due_hours')::numeric,
    (t->>'next_due_date')::timestamptz,
    coalesce(t->>'status', 'upcoming'),
    coalesce(t->>'priority', 'recommended'),
    false,
    coalesce(t->>'source', 'template')
  FROM jsonb_array_elements(p_tasks) AS t;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_vehicle_schedule(uuid, uuid, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_vehicle_schedule(uuid, uuid, boolean, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.replace_vehicle_schedule(uuid, uuid, boolean, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_vehicle_schedule(uuid, uuid, boolean, jsonb) TO service_role;
