-- Migration: medication_dose_logs + log_medication_dose RPC
--
-- MVP adherence tracking. One row per dose taken, with a date column for
-- day-grouping and timestamptz for ordering. Streaks computed client-side
-- from a 30-day window returned by the RPC.
--
-- Adherence is measured in doses taken (per WHO/CDC), not days-with-any-dose.
-- The medications table currently has no doses_per_day field; this schema
-- supports both 1x and Nx daily without redesign when that column lands.
--
-- Idempotency: 30-second window prevents rapid double-tap on the same row
-- from double-logging. Longer windows would reject legitimate same-minute
-- multi-doses.
--
-- Undo: same-day only. Yesterday's logs are immutable for adherence integrity.

BEGIN;

-- ============================================================================
-- medication_dose_logs table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.medication_dose_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medication_id       uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  family_member_id    uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  medication_name     text NOT NULL,
  taken_at            timestamptz NOT NULL DEFAULT now(),
  dose_date           date NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medication_dose_logs_user_med_date
  ON public.medication_dose_logs (user_id, medication_id, dose_date DESC);

CREATE INDEX IF NOT EXISTS idx_medication_dose_logs_user_date
  ON public.medication_dose_logs (user_id, dose_date DESC);

CREATE INDEX IF NOT EXISTS idx_medication_dose_logs_med_taken
  ON public.medication_dose_logs (medication_id, taken_at DESC);

ALTER TABLE public.medication_dose_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medication_dose_logs_select_own ON public.medication_dose_logs;
CREATE POLICY medication_dose_logs_select_own ON public.medication_dose_logs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.medication_dose_logs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.medication_dose_logs FROM authenticated;
GRANT SELECT ON public.medication_dose_logs TO authenticated;

-- ============================================================================
-- log_medication_dose RPC
-- ============================================================================
DROP FUNCTION IF EXISTS public.log_medication_dose(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.log_medication_dose(uuid, timestamptz, text, date);

CREATE FUNCTION public.log_medication_dose(
  p_medication_id uuid,
  p_taken_at      timestamptz DEFAULT now(),
  p_notes         text        DEFAULT NULL,
  p_dose_date     date        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_med              record;
  v_user_id          uuid;
  v_dose_date        date;
  v_last_taken_at    timestamptz;
  v_today_count      integer;
  v_streak_days      integer;
  v_dose_dates       jsonb;
  v_idempotent       boolean := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load medication and verify caller owns it
  SELECT m.*
    INTO v_med
    FROM medications m
   WHERE m.id = p_medication_id
     AND m.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication not found or access denied';
  END IF;

  -- Client-local dose date is authoritative for adherence. The client lives
  -- in the user's timezone; the server does not know it. Fall back to UTC
  -- date only if client didn't supply one (e.g. older clients).
  v_dose_date := COALESCE(p_dose_date, (p_taken_at AT TIME ZONE 'UTC')::date);

  -- Idempotency: if a dose was logged for this medication in the last 30
  -- seconds, return the existing state without inserting.
  SELECT MAX(taken_at) INTO v_last_taken_at
    FROM medication_dose_logs
   WHERE medication_id = p_medication_id
     AND user_id = v_user_id;

  IF v_last_taken_at IS NOT NULL
     AND abs(extract(epoch FROM (p_taken_at - v_last_taken_at))) < 30
  THEN
    v_idempotent := true;
  ELSE
    INSERT INTO medication_dose_logs (
      user_id, medication_id, family_member_id, medication_name,
      taken_at, dose_date, notes
    ) VALUES (
      v_user_id, p_medication_id, v_med.family_member_id, v_med.name,
      p_taken_at, v_dose_date, p_notes
    );
  END IF;

  -- Today's dose count
  SELECT COUNT(*) INTO v_today_count
    FROM medication_dose_logs
   WHERE medication_id = p_medication_id
     AND user_id = v_user_id
     AND dose_date = v_dose_date;

  -- 30-day distinct dose dates (for streak + dot rendering client-side)
  SELECT COALESCE(jsonb_agg(d ORDER BY d DESC), '[]'::jsonb) INTO v_dose_dates
    FROM (
      SELECT DISTINCT dose_date AS d
        FROM medication_dose_logs
       WHERE medication_id = p_medication_id
         AND user_id = v_user_id
         AND dose_date >= v_dose_date - interval '30 days'
    ) sub;

  -- Streak: consecutive days with ≥1 dose ending today. Stop at first gap.
  WITH dates AS (
    SELECT DISTINCT dose_date AS d
      FROM medication_dose_logs
     WHERE medication_id = p_medication_id
       AND user_id = v_user_id
       AND dose_date <= v_dose_date
     ORDER BY dose_date DESC
     LIMIT 60
  ),
  ranked AS (
    SELECT d, (v_dose_date - d) AS offset_days,
           ROW_NUMBER() OVER (ORDER BY d DESC) - 1 AS rn
      FROM dates
  ),
  first_gap AS (
    SELECT COALESCE(MIN(rn), 999999) AS gap_rn
      FROM ranked
     WHERE offset_days <> rn
  )
  SELECT COUNT(*) INTO v_streak_days
    FROM ranked, first_gap
   WHERE rn < first_gap.gap_rn;

  RETURN jsonb_build_object(
    'medication_id',    p_medication_id,
    'medication_name',  v_med.name,
    'family_member_id', v_med.family_member_id,
    'dose_date',        to_char(v_dose_date, 'YYYY-MM-DD'),
    'today_count',      v_today_count,
    'streak_days',      v_streak_days,
    'dose_dates_30d',   v_dose_dates,
    'idempotent',       v_idempotent,
    'logged',           NOT v_idempotent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_medication_dose(uuid, timestamptz, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_medication_dose(uuid, timestamptz, text, date) TO authenticated;

-- ============================================================================
-- undo_last_medication_dose RPC — same-day only
-- ============================================================================
DROP FUNCTION IF EXISTS public.undo_last_medication_dose(uuid);
DROP FUNCTION IF EXISTS public.undo_last_medication_dose(uuid, date);

CREATE FUNCTION public.undo_last_medication_dose(
  p_medication_id uuid,
  p_today         date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_med           record;
  v_user_id       uuid;
  v_today         date;
  v_deleted_id    uuid;
  v_today_count   integer;
  v_streak_days   integer;
  v_dose_dates    jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT m.* INTO v_med FROM medications m
   WHERE m.id = p_medication_id AND m.user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication not found or access denied';
  END IF;

  -- Client-local "today" is authoritative.
  v_today := COALESCE(p_today, (now() AT TIME ZONE 'UTC')::date);

  -- Delete the most recent dose taken TODAY for this medication
  WITH target AS (
    SELECT id
      FROM medication_dose_logs
     WHERE medication_id = p_medication_id
       AND user_id = v_user_id
       AND dose_date = v_today
     ORDER BY taken_at DESC
     LIMIT 1
  )
  DELETE FROM medication_dose_logs
   WHERE id IN (SELECT id FROM target)
   RETURNING id INTO v_deleted_id;

  -- Recompute counts/streak/dates from current state
  SELECT COUNT(*) INTO v_today_count
    FROM medication_dose_logs
   WHERE medication_id = p_medication_id
     AND user_id = v_user_id
     AND dose_date = v_today;

  SELECT COALESCE(jsonb_agg(d ORDER BY d DESC), '[]'::jsonb) INTO v_dose_dates
    FROM (
      SELECT DISTINCT dose_date AS d
        FROM medication_dose_logs
       WHERE medication_id = p_medication_id
         AND user_id = v_user_id
         AND dose_date >= v_today - interval '30 days'
    ) sub;

  WITH dates AS (
    SELECT DISTINCT dose_date AS d
      FROM medication_dose_logs
     WHERE medication_id = p_medication_id
       AND user_id = v_user_id
       AND dose_date <= v_today
     ORDER BY dose_date DESC
     LIMIT 60
  ),
  ranked AS (
    SELECT d, (v_today - d) AS offset_days,
           ROW_NUMBER() OVER (ORDER BY d DESC) - 1 AS rn
      FROM dates
  ),
  first_gap AS (
    SELECT COALESCE(MIN(rn), 999999) AS gap_rn
      FROM ranked
     WHERE offset_days <> rn
  )
  SELECT COUNT(*) INTO v_streak_days
    FROM ranked, first_gap
   WHERE rn < first_gap.gap_rn;

  RETURN jsonb_build_object(
    'medication_id',    p_medication_id,
    'medication_name',  v_med.name,
    'family_member_id', v_med.family_member_id,
    'dose_date',        to_char(v_today, 'YYYY-MM-DD'),
    'today_count',      v_today_count,
    'streak_days',      v_streak_days,
    'dose_dates_30d',   v_dose_dates,
    'undone',           v_deleted_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_last_medication_dose(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_last_medication_dose(uuid, date) TO authenticated;

COMMIT;
