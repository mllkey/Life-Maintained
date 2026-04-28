-- Rate limits for AI edge functions.
-- Sliding-window per (user_id, fn_name): 30 calls/minute hard cap.

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fn_name text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON public.rate_limit_events (user_id, fn_name, occurred_at DESC);

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- No direct client access. RPC is the only writer.
REVOKE ALL ON public.rate_limit_events FROM PUBLIC, anon, authenticated;

-- check_rate_limit
-- Atomically counts events in the last p_window_seconds for the given
-- (user, fn). If under cap, inserts a new event and returns true.
-- If at or above cap, returns false (no insert).
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_fn_name text,
  p_max_calls integer DEFAULT 30,
  p_window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR p_fn_name IS NULL OR p_fn_name = '' THEN
    RAISE EXCEPTION 'check_rate_limit: user_id and fn_name required';
  END IF;

  -- Serialize checks per (user_id, fn_name) so SELECT-count + INSERT is atomic.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_fn_name, 0));

  -- GC: prune events older than 1 hour for this user+fn (cheap, bounded).
  DELETE FROM public.rate_limit_events
   WHERE user_id = p_user_id
     AND fn_name = p_fn_name
     AND occurred_at < now() - interval '1 hour';

  SELECT count(*) INTO v_count
    FROM public.rate_limit_events
   WHERE user_id = p_user_id
     AND fn_name = p_fn_name
     AND occurred_at >= now() - make_interval(secs => p_window_seconds);

  IF v_count >= p_max_calls THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_events (user_id, fn_name)
  VALUES (p_user_id, p_fn_name);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- Only service_role (edge functions) can call this. RPC is invoked from
-- edge functions using the service role key.
GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer)
  TO service_role;
