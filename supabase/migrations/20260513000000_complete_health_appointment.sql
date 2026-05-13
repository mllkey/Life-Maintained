-- Migration: complete_health_appointment
--
-- Atomic health-appointment completion: updates the appointment row, inserts
-- a row into health_appointment_logs, returns a payload with the new
-- next_due_date. Mirrors complete_property_task v2.
--
-- health_appointments.last_completed_at and .next_due_date are timestamptz.
-- health_appointment_logs.service_date is date (mirrors maintenance_logs).
--
-- Interval handling: health_appointments has two interval columns —
-- interval_type (text: 'weekly' | 'biweekly') for sub-month cadences, and
-- interval_months (integer) for monthly cadences. interval_type wins when
-- set; otherwise interval_months is used. Default fallback is 12 months.
--
-- Idempotency guard: if the appointment was already completed within 2
-- seconds (network retry case), return the existing payload without
-- inserting a duplicate log row.

BEGIN;

-- ============================================================================
-- health_appointment_logs table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.health_appointment_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_member_id    uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  appointment_id      uuid NOT NULL REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  appointment_type    text NOT NULL,
  service_date        date NOT NULL,
  cost                numeric,
  provider_name       text,
  notes               text,
  did_it_myself       boolean,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_appointment_logs_user_member
  ON public.health_appointment_logs (user_id, family_member_id, service_date DESC);

CREATE INDEX IF NOT EXISTS idx_health_appointment_logs_appointment
  ON public.health_appointment_logs (appointment_id, service_date DESC);

ALTER TABLE public.health_appointment_logs ENABLE ROW LEVEL SECURITY;

-- Owner-only SELECT. All writes are RPC-only (REVOKE INSERT/UPDATE/DELETE).
DROP POLICY IF EXISTS health_appointment_logs_select_own ON public.health_appointment_logs;
CREATE POLICY health_appointment_logs_select_own ON public.health_appointment_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.health_appointment_logs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.health_appointment_logs FROM authenticated;
GRANT SELECT ON public.health_appointment_logs TO authenticated;

-- ============================================================================
-- complete_health_appointment — SECURITY DEFINER RPC
-- ============================================================================
DROP FUNCTION IF EXISTS public.complete_health_appointment(
  uuid,
  timestamptz,
  text,
  numeric,
  text,
  boolean
);

CREATE FUNCTION public.complete_health_appointment(
  p_appointment_id uuid,
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
  v_appt             record;
  v_member           record;
  v_user_id          uuid;
  v_completed_ts     timestamptz;
  v_completed_date   date;
  v_interval_months  integer;
  v_interval_type    text;
  v_next_due_ts      timestamptz;
  v_member_name      text;
BEGIN
  -- Require authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load appointment and verify caller owns it (through family member)
  SELECT a.*
    INTO v_appt
    FROM health_appointments a
    JOIN family_members m ON m.id = a.family_member_id
   WHERE a.id = p_appointment_id
     AND a.user_id = v_user_id
     AND m.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment not found or access denied';
  END IF;

  -- Idempotency guard: same appointment completed within 2 seconds → return
  -- existing payload without inserting a duplicate log row.
  IF v_appt.last_completed_at IS NOT NULL
     AND abs(extract(epoch FROM (p_completed_date - v_appt.last_completed_at))) < 2
  THEN
    SELECT * INTO v_member FROM family_members WHERE id = v_appt.family_member_id;
    v_member_name := COALESCE(v_member.name, 'Family member');
    RETURN jsonb_build_object(
      'appointment_id',   p_appointment_id,
      'appointment_type', v_appt.appointment_type,
      'family_member_id', v_appt.family_member_id,
      'family_member_name', v_member_name,
      'completed_date',   to_char(v_appt.last_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
      'next_due_date',    CASE WHEN v_appt.next_due_date IS NOT NULL
                                THEN to_char(v_appt.next_due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                                ELSE NULL END,
      'log_created',      false,
      'idempotent',       true
    );
  END IF;

  -- Load family member row for the response payload
  SELECT * INTO v_member FROM family_members WHERE id = v_appt.family_member_id;

  -- Resolve interval. interval_type wins for sub-month cadences.
  v_interval_type := COALESCE(LOWER(v_appt.interval_type), '');
  v_interval_months := COALESCE(v_appt.interval_months, 12);

  -- Native types
  v_completed_ts   := p_completed_date;
  v_completed_date := (p_completed_date AT TIME ZONE 'UTC')::date;

  IF v_interval_type = 'weekly' THEN
    v_next_due_ts := p_completed_date + interval '7 days';
  ELSIF v_interval_type = 'biweekly' THEN
    v_next_due_ts := p_completed_date + interval '14 days';
  ELSE
    v_next_due_ts := p_completed_date + (v_interval_months || ' months')::interval;
  END IF;

  -- Update the appointment row
  UPDATE health_appointments
     SET last_completed_at = v_completed_ts,
         next_due_date     = v_next_due_ts,
         updated_at        = now()
   WHERE id = p_appointment_id;

  -- Insert the log entry (RPC writes only; table has no INSERT grant to authenticated)
  INSERT INTO health_appointment_logs (
    user_id, family_member_id, appointment_id, appointment_type,
    service_date, cost, provider_name, notes, did_it_myself
  ) VALUES (
    v_user_id, v_appt.family_member_id, p_appointment_id, v_appt.appointment_type,
    v_completed_date, p_cost, p_provider_name, p_notes, p_did_it_myself
  );

  v_member_name := COALESCE(v_member.name, 'Family member');

  RETURN jsonb_build_object(
    'appointment_id',     p_appointment_id,
    'appointment_type',   v_appt.appointment_type,
    'family_member_id',   v_appt.family_member_id,
    'family_member_name', v_member_name,
    'completed_date',     to_char(v_completed_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
    'next_due_date',      to_char(v_next_due_ts  AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
    'log_created',        true,
    'idempotent',         false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_health_appointment(
  uuid, timestamptz, text, numeric, text, boolean
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_health_appointment(
  uuid, timestamptz, text, numeric, text, boolean
) TO authenticated;

COMMIT;
