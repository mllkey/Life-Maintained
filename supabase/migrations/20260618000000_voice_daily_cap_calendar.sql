-- 20260618000000_voice_daily_cap_calendar.sql
-- Dedicated per-LOCAL-CALENDAR-DAY voice transcription cap.
--
-- Background: the daily voice cap previously reused check_rate_limit with an
-- 86400-second window. That RPC GC-prunes its own events older than 1 hour,
-- which silently destroyed the 24h window (the cap behaved as ~per-hour, not
-- per-day). These functions count by the caller's local calendar day (IANA
-- timezone supplied by the client, validated here, default UTC), insert
-- atomically under an advisory lock, and prune only rows >= 2 days old so the
-- current day is never lost. The shared per-minute abuse limiter
-- (check_rate_limit) is unchanged and still used by every other edge function.

CREATE OR REPLACE FUNCTION public.consume_voice_daily(
  p_user_id uuid,
  p_max_calls integer,
  p_tz text DEFAULT 'UTC'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_day_start_utc timestamptz;
  v_count integer;
  v_event_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_max_calls IS NULL OR p_max_calls < 0 THEN
    RAISE EXCEPTION 'consume_voice_daily: user_id and non-negative max_calls required';
  END IF;

  -- Validate the IANA timezone; fall back to UTC if unknown or invalid.
  BEGIN
    PERFORM now() AT TIME ZONE coalesce(p_tz, 'UTC');
    v_tz := coalesce(p_tz, 'UTC');
  EXCEPTION WHEN others THEN
    v_tz := 'UTC';
  END;

  -- Start of the caller's local calendar day, expressed as a UTC instant.
  -- Uses the tz database, so it is fully DST-correct and independent of the
  -- database session timezone.
  v_day_start_utc := (date_trunc('day', now() AT TIME ZONE v_tz)) AT TIME ZONE v_tz;

  -- Serialize count + insert per user for this cap.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':voice_daily', 0));

  -- Bounded GC: prune only rows >= 2 days old; the current day is never touched.
  DELETE FROM public.rate_limit_events
   WHERE user_id = p_user_id
     AND fn_name = 'transcribe-audio:daily'
     AND occurred_at < now() - interval '2 days';

  SELECT count(*) INTO v_count
    FROM public.rate_limit_events
   WHERE user_id = p_user_id
     AND fn_name = 'transcribe-audio:daily'
     AND occurred_at >= v_day_start_utc;

  IF v_count >= p_max_calls THEN
    RETURN jsonb_build_object('allowed', false, 'remaining', 0);
  END IF;

  INSERT INTO public.rate_limit_events (user_id, fn_name)
  VALUES (p_user_id, 'transcribe-audio:daily')
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', greatest(0, p_max_calls - (v_count + 1)),
    'event_id', v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_voice_daily(
  p_user_id uuid,
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  DELETE FROM public.rate_limit_events
   WHERE id = p_event_id
     AND user_id = p_user_id
     AND fn_name = 'transcribe-audio:daily';

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_voice_daily(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_voice_daily(uuid, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.refund_voice_daily(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_voice_daily(uuid, uuid) TO service_role;
