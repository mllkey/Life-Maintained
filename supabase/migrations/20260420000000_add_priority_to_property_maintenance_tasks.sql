-- Migration: add_priority_to_property_maintenance_tasks
--
-- STEP 2 PATH CHOSEN: PATH 2 — Text column, same values/default as user_vehicle_maintenance_tasks.
-- EVIDENCE:
--   • user_vehicle_maintenance_tasks.Row.priority = string (NOT NULL) per lib/supabase-types.ts:1479
--   • Insert has priority?: string (optional → DB default exists) per lib/supabase-types.ts:1503
--   • All codebase references use lowercase "high" / "medium" / "low"
--   • No ENUM type for priority exists (grep across all migrations: zero hits)
--   • No priority index on vehicles (grep across all migrations: zero hits)
--   • property generator already normalises priority to these values but intentionally
--     omitted them from inserts pending this migration
--
-- Production-safe order:
--   1. Add column nullable with default  (ADD COLUMN IF NOT EXISTS)
--   2. Backfill existing NULLs
--   3. Add CHECK constraint idempotently (guarded via pg_constraint check)
--   4. Set NOT NULL
--   No index — vehicles do not have one.

-- ── 1. Add column (nullable first so existing rows are valid immediately) ───
ALTER TABLE property_maintenance_tasks
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';

-- ── 2. Backfill any NULLs (guards against a partial prior run) ────────────
UPDATE property_maintenance_tasks
   SET priority = 'medium'
 WHERE priority IS NULL;

-- ── 3. Add CHECK constraint only if it does not already exist ────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'property_maintenance_tasks'::regclass
       AND conname  = 'property_maintenance_tasks_priority_check'
  ) THEN
    ALTER TABLE property_maintenance_tasks
      ADD CONSTRAINT property_maintenance_tasks_priority_check
      CHECK (priority IN ('high', 'medium', 'low'));
  END IF;
END
$$;

-- ── 4. Enforce NOT NULL ───────────────────────────────────────────────────
ALTER TABLE property_maintenance_tasks
  ALTER COLUMN priority SET NOT NULL;

-- ── MANUAL ROLLBACK (do not apply unless reverting before broad rollout) ──
-- ALTER TABLE property_maintenance_tasks DROP COLUMN IF EXISTS priority;
