-- Aging transitions, part 1 of 3 (inert until the edge function and client ship).
--
-- schedule_age_key: the age band the member's schedule was last generated for.
--   Persons: u18 | 18-39 | 40-49 | 50-64 | 65plus | unknown
--   Pets:    puppy | kitten | adult | senior | unknown
--   Written ONLY by generate-health-schedule after a successful run. NULL means
--   the member predates this feature (first check regenerates quietly).
--
-- retired_at: set when a cadence transition supersedes this appointment while a
--   row of the target type already exists (e.g. Annual Vet Visit superseded by
--   an existing Semi-Annual Vet Visit at the senior crossing). Retired rows keep
--   their completion history and their health_appointment_logs untouched, but
--   leave every active surface: next_due_date is cleared in the same update, and
--   client queries filter retired_at IS NULL.
--
-- The trigger clears schedule_age_key whenever date_of_birth, member_type, or
-- pet_type changes, so a corrected birthday regenerates QUIETLY on the next
-- daily check instead of firing a false "just crossed a threshold" banner.
-- The edge function's stamp (an update touching only schedule_age_key) does not
-- trip the trigger.

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS schedule_age_key text;

ALTER TABLE public.health_appointments
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;

-- Enforce the design invariants at the database layer:
-- the age key may only hold a known band, and a retired appointment can
-- never keep an active due date.
ALTER TABLE public.family_members
  DROP CONSTRAINT IF EXISTS family_members_schedule_age_key_check;
ALTER TABLE public.family_members
  ADD CONSTRAINT family_members_schedule_age_key_check CHECK (
    schedule_age_key IS NULL OR schedule_age_key IN (
      'u18', '18-39', '40-49', '50-64', '65plus',
      'puppy', 'kitten', 'adult', 'senior', 'unknown'
    )
  );

ALTER TABLE public.health_appointments
  DROP CONSTRAINT IF EXISTS health_appointments_retired_no_due_check;
ALTER TABLE public.health_appointments
  ADD CONSTRAINT health_appointments_retired_no_due_check CHECK (
    retired_at IS NULL OR next_due_date IS NULL
  );

CREATE OR REPLACE FUNCTION public.reset_schedule_age_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     OR NEW.member_type IS DISTINCT FROM OLD.member_type
     OR NEW.pet_type    IS DISTINCT FROM OLD.pet_type
  THEN
    NEW.schedule_age_key := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS family_members_reset_age_key ON public.family_members;

CREATE TRIGGER family_members_reset_age_key
  BEFORE UPDATE ON public.family_members
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_schedule_age_key();
