-- Migration: Packet 2A - task completion events + atomic idempotent undo
-- Adds: monotonic row_version on user_vehicle_maintenance_tasks (conflict token),
-- an RPC-only event ledger, complete_vehicle_task v6 (idempotent via operation id,
-- legacy path byte-identical to v5), and a transactional batch undo RPC.
-- Lock order everywhere: task row first, then event rows, both via ordered loops.
-- The deployed reverse_vehicle_task_completion function is intentionally untouched
-- (live caller in the voice flow); the new RPCs supersede it for the log screen.

BEGIN;

-- ============================================================================
-- 1) Version column + trigger (sole mutation point for the version)
-- ============================================================================
ALTER TABLE public.user_vehicle_maintenance_tasks
  ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_task_row_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_row_version ON public.user_vehicle_maintenance_tasks;
CREATE TRIGGER trg_task_row_version
BEFORE UPDATE ON public.user_vehicle_maintenance_tasks
FOR EACH ROW EXECUTE FUNCTION public.bump_task_row_version();

-- ============================================================================
-- 2) Event ledger (RPC-only; rows die with their task)
-- ============================================================================
CREATE TABLE public.task_completion_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  task_id          uuid NOT NULL REFERENCES public.user_vehicle_maintenance_tasks(id) ON DELETE CASCADE,
  operation_id     uuid NOT NULL,
  request_hash     text NOT NULL,
  prior            jsonb NOT NULL,
  applied          jsonb NOT NULL,
  prior_version    bigint NOT NULL,
  applied_version  bigint NOT NULL,
  status           text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','undone')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  undone_at        timestamptz,
  UNIQUE (task_id, operation_id)
);

CREATE INDEX task_completion_events_user_created_idx
  ON public.task_completion_events (user_id, created_at);

ALTER TABLE public.task_completion_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.task_completion_events
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- 3) complete_vehicle_task v6: drop v5 signature, recreate with one trailing
--    defaulted parameter. Core logic is v5 verbatim; the operation-id branch
--    wraps it with replay/idempotency and the event capture.
-- ============================================================================
DROP FUNCTION public.complete_vehicle_task(
  uuid, numeric, numeric, timestamptz, text, numeric, boolean, text, boolean
);

CREATE FUNCTION public.complete_vehicle_task(
  p_task_id        uuid,
  p_mileage        numeric     DEFAULT NULL,
  p_hours          numeric     DEFAULT NULL,
  p_completed_date timestamptz DEFAULT now(),
  p_notes          text        DEFAULT NULL,
  p_cost           numeric     DEFAULT NULL,
  p_skip_log       boolean     DEFAULT false,
  p_provider_name  text        DEFAULT NULL,
  p_did_it_myself  boolean     DEFAULT NULL,
  p_operation_id   uuid        DEFAULT NULL
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
  v_event            record;
  v_request          jsonb;
  v_request_hash     text;
  v_prior            jsonb;
  v_prior_version    bigint;
  v_applied          jsonb;
  v_applied_version  bigint;
  v_event_id         uuid;
BEGIN
  -- Require authenticated caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotent path requires an explicit completion date. Note: the server
  -- cannot distinguish an omitted parameter from its default; this guard
  -- catches explicit NULLs, and the client wrapper makes the field required.
  -- An omitted date with an operation id surfaces on retry as
  -- idempotency_mismatch (loud), never as a silent double-completion.
  IF p_operation_id IS NOT NULL AND p_completed_date IS NULL THEN
    RETURN jsonb_build_object('error', 'explicit_date_required');
  END IF;

  -- Load task, verify ownership, and LOCK the task row (task-first universal
  -- lock order; the prior snapshot and the write form one critical section)
  SELECT t.*
    INTO v_task
    FROM user_vehicle_maintenance_tasks t
    JOIN vehicles v ON v.id = t.vehicle_id
   WHERE t.id = p_task_id
     AND t.user_id = v_user_id
     AND v.user_id = v_user_id
   FOR UPDATE OF t;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;

  IF p_operation_id IS NOT NULL THEN
    -- Canonical request: built server-side by this one expression on both the
    -- store and compare sides, so key order / null-vs-absent / numeric-text
    -- ambiguity cannot exist.
    v_request := jsonb_build_object(
      'p_mileage',        p_mileage,
      'p_hours',          p_hours,
      'p_completed_date', p_completed_date,
      'p_notes',          p_notes,
      'p_cost',           p_cost,
      'p_skip_log',       p_skip_log,
      'p_provider_name',  p_provider_name,
      'p_did_it_myself',  p_did_it_myself
    );
    -- Equality-only fingerprint (md5 is a core function; no extension needed).
    -- The raw request is never stored: notes/provider/cost stay out of the
    -- indefinitely-retained ledger.
    v_request_hash := md5(v_request::text);

    -- Replay check UNDER THE LOCK. Concurrent same-operation calls serialize
    -- on the row lock above; the loser re-runs this and replays. The UNIQUE
    -- constraint is the defensive backstop, not the mechanism.
    SELECT * INTO v_event
      FROM task_completion_events
     WHERE task_id = p_task_id
       AND operation_id = p_operation_id;

    IF FOUND THEN
      IF v_event.request_hash <> v_request_hash THEN
        RETURN jsonb_build_object(
          'error',               'idempotency_mismatch',
          'task_id',             p_task_id,
          'completion_event_id', v_event.id
        );
      END IF;
      -- Stored snapshots are historical on replay, never live state. An
      -- undone status means the operation is consumed but the task is NOT
      -- completed.
      RETURN jsonb_build_object(
        'task_id',             p_task_id,
        'completion_event_id', v_event.id,
        'replayed',            true,
        'event_status',        v_event.status,
        'prior',               v_event.prior,
        'applied',             v_event.applied
      );
    END IF;

    -- Capture prior from the locked row
    v_prior := jsonb_build_object(
      'last_completed_date',  v_task.last_completed_date,
      'last_completed_miles', v_task.last_completed_miles,
      'last_completed_hours', v_task.last_completed_hours,
      'next_due_miles',       v_task.next_due_miles,
      'next_due_hours',       v_task.next_due_hours,
      'next_due_date',        v_task.next_due_date,
      'status',               v_task.status,
      'updated_at',           v_task.updated_at
    );
    v_prior_version := v_task.row_version;
  END IF;

  -- ==========================================================================
  -- v5 core, verbatim from 20260506200000
  -- ==========================================================================

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

  -- ==========================================================================
  -- End of v5 core
  -- ==========================================================================

  IF p_operation_id IS NOT NULL THEN
    -- Re-read the row for the applied snapshot; the trigger has incremented
    -- the version exactly once for the single task UPDATE above.
    SELECT jsonb_build_object(
             'last_completed_date',  t.last_completed_date,
             'last_completed_miles', t.last_completed_miles,
             'last_completed_hours', t.last_completed_hours,
             'next_due_miles',       t.next_due_miles,
             'next_due_hours',       t.next_due_hours,
             'next_due_date',        t.next_due_date,
             'status',               t.status,
             'updated_at',           t.updated_at
           ),
           t.row_version
      INTO v_applied, v_applied_version
      FROM user_vehicle_maintenance_tasks t
     WHERE t.id = p_task_id;

    INSERT INTO task_completion_events
      (user_id, task_id, operation_id, request_hash, prior, applied, prior_version, applied_version)
    VALUES
      (v_user_id, p_task_id, p_operation_id, v_request_hash, v_prior, v_applied, v_prior_version, v_applied_version)
    RETURNING id INTO v_event_id;

    RETURN jsonb_build_object(
      'task_id',             p_task_id,
      'completion_event_id', v_event_id,
      'replayed',            false,
      'event_status',        'applied',
      'prior',               v_prior,
      'applied',             v_applied
    );
  END IF;

  -- Legacy path: v5 response shape, byte-identical keys and formatting.
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

REVOKE ALL ON FUNCTION public.complete_vehicle_task(
  uuid, numeric, numeric, timestamptz, text, numeric, boolean, text, boolean, uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.complete_vehicle_task(
  uuid, numeric, numeric, timestamptz, text, numeric, boolean, text, boolean, uuid
) TO authenticated, service_role;

-- ============================================================================
-- 4) Transactional batch undo
-- ============================================================================
CREATE FUNCTION public.undo_vehicle_completions(p_event_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid;
  v_ids           uuid[];
  v_ev_ids        uuid[];
  v_ev_tasks      uuid[];
  v_task_ids      uuid[];
  v_expected      integer;
  v_locked        integer;
  v_seen          integer := 0;
  v_task_id       uuid;
  v_i             integer;
  v_ev            record;
  v_restored      uuid[] := '{}'::uuid[];
  v_already       uuid[] := '{}'::uuid[];
  v_applied_count integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validation. The raw cap comes FIRST, before any unnest, so an oversized
  -- array is rejected without expansion work.
  IF p_event_ids IS NULL
     OR cardinality(p_event_ids) = 0
     OR cardinality(p_event_ids) > 25
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_event_ids) u WHERE u IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  SELECT array_agg(DISTINCT u ORDER BY u) INTO v_ids FROM unnest(p_event_ids) u;
  v_expected := cardinality(v_ids);

  -- Unlocked read: existence + ownership
  IF EXISTS (
    SELECT 1
      FROM unnest(v_ids) u
      LEFT JOIN task_completion_events e ON e.id = u
     WHERE e.id IS NULL OR e.user_id <> v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- At most one requested event per task
  IF EXISTS (
    SELECT 1
      FROM task_completion_events e
     WHERE e.id = ANY(v_ids)
     GROUP BY e.task_id
    HAVING COUNT(*) > 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  -- PRESERVE the validated event ids and their task ids in locals. Every
  -- later step iterates these preserved arrays, never a re-derived query,
  -- so an event removed by a concurrent task-delete cascade cannot silently
  -- drop out and turn into a false success.
  SELECT array_agg(e.id ORDER BY e.task_id, e.id),
         array_agg(e.task_id ORDER BY e.task_id, e.id)
    INTO v_ev_ids, v_ev_tasks
    FROM task_completion_events e
   WHERE e.id = ANY(v_ids);

  -- Snapshot guard: if every validated event vanished before this read
  -- (task-delete cascade), the aggregates are NULL and a FOREACH would raise
  -- a raw error instead of a contract response. Partial loss is a conflict
  -- with a known (non-null) preserved task id.
  IF v_ev_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF cardinality(v_ev_ids) IS DISTINCT FROM v_expected THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'conflict_task_id', v_ev_tasks[1]);
  END IF;

  SELECT array_agg(DISTINCT t ORDER BY t) INTO v_task_ids
    FROM unnest(v_ev_tasks) t;

  -- Lock TASK rows first, in ascending id order via an explicit loop over the
  -- preserved ids (plan-independent acquisition order; same task-first order
  -- as the completion RPC and the delete cascade)
  FOREACH v_task_id IN ARRAY v_task_ids LOOP
    PERFORM 1
      FROM user_vehicle_maintenance_tasks
     WHERE id = v_task_id
       AND user_id = v_user_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'conflict_task_id', v_task_id);
    END IF;
  END LOOP;

  -- Lock EVENT rows in preserved (task_id, id) order; every lock must find
  -- its row now that its task is held
  FOR v_i IN 1..v_expected LOOP
    PERFORM 1 FROM task_completion_events WHERE id = v_ev_ids[v_i] FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'conflict_task_id', v_ev_tasks[v_i]);
    END IF;
  END LOOP;

  -- Post-lock count assertion: the locked set must be exactly the validated set
  SELECT COUNT(*) INTO v_locked FROM task_completion_events WHERE id = ANY(v_ids);
  IF v_locked <> v_expected THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'conflict_task_id', v_ev_tasks[1]);
  END IF;

  -- Revalidate + conflict-check EVERYTHING before the first write, and count
  -- every row seen against the expected total
  FOR v_ev IN
    SELECT e.id, e.task_id, e.user_id, e.status, e.applied_version,
           t.row_version AS current_version
      FROM task_completion_events e
      JOIN user_vehicle_maintenance_tasks t ON t.id = e.task_id
     WHERE e.id = ANY(v_ids)
     ORDER BY e.task_id, e.id
  LOOP
    v_seen := v_seen + 1;
    IF v_ev.user_id <> v_user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    IF v_ev.status = 'undone' THEN
      v_already := v_already || v_ev.task_id;
    ELSE
      IF v_ev.current_version <> v_ev.applied_version THEN
        RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'conflict_task_id', v_ev.task_id);
      END IF;
      v_applied_count := v_applied_count + 1;
    END IF;
  END LOOP;

  IF v_seen <> v_expected THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'conflict_task_id', v_ev_tasks[1]);
  END IF;

  IF v_applied_count = 0 THEN
    -- Every requested event already undone: idempotent replay
    RETURN jsonb_build_object(
      'ok',                      true,
      'replayed',                true,
      'restored_task_ids',       to_jsonb('{}'::uuid[]),
      'already_undone_task_ids', to_jsonb(v_already)
    );
  END IF;

  -- All checks passed: restore all, mark all, one transaction
  FOR v_ev IN
    SELECT e.id, e.task_id, e.prior
      FROM task_completion_events e
     WHERE e.id = ANY(v_ids)
       AND e.status = 'applied'
     ORDER BY e.task_id, e.id
  LOOP
    UPDATE user_vehicle_maintenance_tasks SET
      last_completed_date  = (v_ev.prior->>'last_completed_date')::timestamptz,
      last_completed_miles = (v_ev.prior->>'last_completed_miles')::integer,
      last_completed_hours = (v_ev.prior->>'last_completed_hours')::numeric,
      next_due_miles       = (v_ev.prior->>'next_due_miles')::integer,
      next_due_hours       = (v_ev.prior->>'next_due_hours')::numeric,
      next_due_date        = (v_ev.prior->>'next_due_date')::timestamptz,
      status               = v_ev.prior->>'status',
      updated_at           = now()
    WHERE id = v_ev.task_id;

    UPDATE task_completion_events
       SET status = 'undone',
           undone_at = now()
     WHERE id = v_ev.id;

    v_restored := v_restored || v_ev.task_id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',                      true,
    'replayed',                false,
    'restored_task_ids',       to_jsonb(v_restored),
    'already_undone_task_ids', to_jsonb(v_already)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_vehicle_completions(uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.undo_vehicle_completions(uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
