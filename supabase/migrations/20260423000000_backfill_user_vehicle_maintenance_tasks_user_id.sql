-- Backfill user_id on user_vehicle_maintenance_tasks rows where NULL,
-- sourcing from vehicles.user_id. Safe: only UPDATE where source is non-null.

BEGIN;

UPDATE user_vehicle_maintenance_tasks t
SET user_id = v.user_id
FROM vehicles v
WHERE t.vehicle_id = v.id
  AND t.user_id IS NULL
  AND v.user_id IS NOT NULL;

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM user_vehicle_maintenance_tasks t
  WHERE t.user_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE NOTICE 'WARN: % user_vehicle_maintenance_tasks row(s) still have NULL user_id after backfill. Manual review required.', orphan_count;
  END IF;
END $$;

COMMIT;
