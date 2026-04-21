UPDATE vehicles
SET last_mileage_update = COALESCE(updated_at, created_at)
WHERE mileage IS NOT NULL
  AND average_miles_per_month > 0
  AND last_mileage_update IS NULL;
