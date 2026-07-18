-- Aging transitions 1c: exact yearly person age keys + wider reset trigger.
--
-- Person schedule_age_key becomes exact-yearly ("p46") so EVERY guideline
-- threshold (21 cervical, 40 mammo/BP, 45 colorectal, 55 PSA, 65 DEXA,
-- 66/70/76 stop-ages) triggers regeneration + reconciliation automatically.
-- Pet keys unchanged. The reset trigger also clears the key when
-- sex_at_birth (sex-specific screenings) or pet_breed (size-banded canine
-- senior age) changes.

ALTER TABLE public.family_members
  DROP CONSTRAINT IF EXISTS family_members_schedule_age_key_check;
ALTER TABLE public.family_members
  ADD CONSTRAINT family_members_schedule_age_key_check CHECK (
    schedule_age_key IS NULL
    OR schedule_age_key IN ('puppy', 'kitten', 'adult', 'mature', 'senior', 'unknown')
    OR schedule_age_key ~ '^p(0|[1-9][0-9]*)$'
  );

CREATE OR REPLACE FUNCTION public.reset_schedule_age_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
     OR NEW.member_type  IS DISTINCT FROM OLD.member_type
     OR NEW.pet_type     IS DISTINCT FROM OLD.pet_type
     OR NEW.sex_at_birth IS DISTINCT FROM OLD.sex_at_birth
     OR NEW.pet_breed    IS DISTINCT FROM OLD.pet_breed
  THEN
    NEW.schedule_age_key := NULL;
  END IF;
  RETURN NEW;
END;
$$;
