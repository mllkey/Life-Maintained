-- Migration: add vehicles.last_hours_update
--
-- Timestamp anchor for hours-based usage projection (parallels last_mileage_update
-- for mileage). Client stamps this on every hours write (update-mileage, dashboard
-- quick-edit, vehicleUsageHelper, edit-vehicle, add-vehicle). Read by
-- currentUsageValue (Piece 2) to project engine-hours forward in whole-day steps
-- from the monthly-hours rate stored in average_miles_per_month.
--
-- Backfill: existing rows are set to last_mileage_update (every vehicle already has
-- it set at add-vehicle time) so hours-equipment begins projecting immediately when
-- Piece 2 ships, rather than waiting for the next manual hours update.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS last_hours_update timestamptz;

UPDATE public.vehicles
   SET last_hours_update = last_mileage_update
 WHERE last_hours_update IS NULL;

COMMENT ON COLUMN public.vehicles.last_hours_update IS
  'Timestamp anchor for hours-based usage projection. Stamped client-side on every hours write. Backfilled from last_mileage_update at add time.';

CREATE INDEX IF NOT EXISTS vehicles_last_hours_update_idx
  ON public.vehicles (last_hours_update);
