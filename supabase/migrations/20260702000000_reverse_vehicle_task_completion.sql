-- Migration: reverse_vehicle_task_completion
--
-- Inverse of complete_vehicle_task v5, for the ConfirmCard "Wrong task?" undo.
-- v5 overwrites last_completed_* / next_due_* / status in place with no snapshot,
-- so the caller passes the PRIOR values (captured client-side from the task row
-- it already SELECT *'d before completing).
--
-- CONDITIONAL restore: applies only when the task's CURRENT next-due state still
-- equals what the completion wrote (p_expected_*). If anything mutated the task
-- since, the WHERE guard matches 0 rows and the RPC returns applied=false — a
-- safe no-op, never a clobber. The date guard mirrors v5's exact return
-- representation: to_char(... AT TIME ZONE 'UTC','YYYY-MM-DD'). to_char(NULL) is
-- NULL, so IS NOT DISTINCT FROM keeps NULL arms symmetric across all three modes.
--
-- Scope: caller-bound via auth.uid() through the vehicle join. Does NOT touch
-- vehicles.mileage / vehicle_mileage_history (odometer is a real observation) and
-- does NOT touch maintenance_logs.

BEGIN;

CREATE OR REPLACE FUNCTION public.reverse_vehicle_task_completion(
  p_task_id                    uuid,
  p_prior_status               text,
  p_prior_last_completed_date  timestamptz DEFAULT NULL,
  p_prior_last_completed_miles integer     DEFAULT NULL,
  p_prior_last_completed_hours numeric     DEFAULT NULL,
  p_prior_next_due_date        timestamptz DEFAULT NULL,
  p_prior_next_due_miles       integer     DEFAULT NULL,
  p_prior_next_due_hours       numeric     DEFAULT NULL,
  p_expected_next_due_date_str text        DEFAULT NULL,
  p_expected_next_due_miles    integer     DEFAULT NULL,
  p_expected_next_due_hours    numeric     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_updated integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM user_vehicle_maintenance_tasks t
      JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = p_task_id
       AND t.user_id = v_user_id
       AND v.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;

  UPDATE user_vehicle_maintenance_tasks SET
    last_completed_date  = p_prior_last_completed_date,
    last_completed_miles = p_prior_last_completed_miles,
    last_completed_hours = p_prior_last_completed_hours,
    next_due_date        = p_prior_next_due_date,
    next_due_miles       = p_prior_next_due_miles,
    next_due_hours       = p_prior_next_due_hours,
    status               = p_prior_status,
    updated_at           = now()
  WHERE id = p_task_id
    AND user_id = v_user_id
    AND next_due_miles IS NOT DISTINCT FROM p_expected_next_due_miles
    AND next_due_hours IS NOT DISTINCT FROM p_expected_next_due_hours
    AND to_char(next_due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
          IS NOT DISTINCT FROM p_expected_next_due_date_str;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('applied', v_updated > 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reverse_vehicle_task_completion(
  uuid, text, timestamptz, integer, numeric, timestamptz, integer, numeric, text, integer, numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reverse_vehicle_task_completion(
  uuid, text, timestamptz, integer, numeric, timestamptz, integer, numeric, text, integer, numeric
) TO authenticated;

COMMIT;
