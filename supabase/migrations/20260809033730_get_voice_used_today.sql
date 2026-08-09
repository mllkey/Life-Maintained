CREATE OR REPLACE FUNCTION public.get_voice_used_today(
  p_tz text DEFAULT 'UTC'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_tz text;
  v_day_start_utc timestamptz;
  v_count integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  BEGIN
    PERFORM now() AT TIME ZONE coalesce(p_tz, 'UTC');
    v_tz := coalesce(p_tz, 'UTC');
  EXCEPTION WHEN others THEN
    v_tz := 'UTC';
  END;

  v_day_start_utc := (date_trunc('day', now() AT TIME ZONE v_tz)) AT TIME ZONE v_tz;

  SELECT count(*) INTO v_count
    FROM public.rate_limit_events
   WHERE user_id = v_uid
     AND fn_name = 'transcribe-audio:daily'
     AND occurred_at >= v_day_start_utc;

  RETURN coalesce(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_voice_used_today(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_voice_used_today(text) TO authenticated, service_role;
