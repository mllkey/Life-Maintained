-- TOS-1: terms/privacy acceptance stamp.
-- Existing rows stay NULL on purpose: every existing account reviews once.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS terms_version text NULL;

-- Stamp at account creation from signup metadata, atomic with the auth user.
-- Body reproduces the live function exactly, plus the two new columns.
-- The trigger on_auth_user_created already binds this function; it is not recreated.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, terms_version, terms_accepted_at)
  VALUES (
    new.id,
    new.email,
    NULLIF(new.raw_user_meta_data ->> 'terms_version', ''),
    CASE
      WHEN NULLIF(new.raw_user_meta_data ->> 'terms_version', '') IS NOT NULL THEN now()
      ELSE NULL
    END
  );
  RETURN new;
END;
$function$;

-- Review-sheet acceptance path: server clock stamp, caller-bound. The client
-- supplies only the version string, never the timestamp.
CREATE OR REPLACE FUNCTION public.accept_current_terms(p_version text)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accepted_at timestamptz := now();
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_version IS NULL OR length(p_version) = 0 THEN
    RAISE EXCEPTION 'invalid_version';
  END IF;

  UPDATE public.profiles
  SET terms_accepted_at = v_accepted_at,
      terms_version = p_version,
      updated_at = v_accepted_at
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  RETURN v_accepted_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_current_terms(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_terms(text) TO authenticated, service_role;
