-- Migration: vehicle_mileage_history user_id backfill trigger
-- Ensures inserts that provide vehicle_id but omit user_id still satisfy the
-- NOT NULL user_id column by resolving ownership from public.vehicles.
-- This preserves legacy RPC/client paths while keeping mileage history scoped.

CREATE OR REPLACE FUNCTION public.set_vehicle_mileage_history_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT v.user_id
      INTO NEW.user_id
      FROM public.vehicles v
     WHERE v.id = NEW.vehicle_id;
  END IF;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'vehicle_mileage_history.user_id could not be resolved for vehicle_id %', NEW.vehicle_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_vehicle_mileage_history_user_id_before_insert
ON public.vehicle_mileage_history;

CREATE TRIGGER set_vehicle_mileage_history_user_id_before_insert
BEFORE INSERT ON public.vehicle_mileage_history
FOR EACH ROW
EXECUTE FUNCTION public.set_vehicle_mileage_history_user_id();
