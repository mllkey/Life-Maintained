-- Migration: add profiles.last_active_at
--
-- Client refreshes this on AppState foreground (debounced 60s) from
-- app/_layout.tsx. Used by the future dormant-user notification cron
-- (PASS-E-005b) and by analytics / retention rails.
--
-- NULL on existing rows is intentional: pre-G10.2 users have no recorded
-- foreground event yet, and the dormant-user cron treats NULL as "not
-- eligible for dormant outreach" rather than backfilling to created_at.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

COMMENT ON COLUMN public.profiles.last_active_at IS
  'Set client-side on AppState foreground (debounced 60s). NULL means no recorded foreground event since G10.2 shipped.';

CREATE INDEX IF NOT EXISTS profiles_last_active_at_idx
  ON public.profiles (last_active_at);
