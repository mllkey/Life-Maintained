-- Cat 3-B: make medications.reminder_time nullable.
-- Reminders are optional. The Daily Reminders toggle in
-- app/add-medication.tsx writes null when off. Previous NOT NULL
-- constraint forced a wire-level type lie that surfaced as a TypeScript
-- error. This migration aligns the schema with the product.
ALTER TABLE public.medications
  ALTER COLUMN reminder_time DROP NOT NULL;
