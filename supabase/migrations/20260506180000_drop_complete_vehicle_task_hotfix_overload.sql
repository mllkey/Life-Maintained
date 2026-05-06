-- Migration: drop the live-created hotfix overload of complete_vehicle_task
--
-- During a production diagnosis on May 6, 2026, a 5-arg variant of
-- complete_vehicle_task was created live in the database with the signature
-- (p_task_id uuid, p_vehicle_id uuid, p_user_id uuid, p_current_mileage integer,
--  p_completed_date date). It was never committed to source.
--
-- Postgres allows multiple overloads, but PostgREST resolves RPC calls by
-- argument name. The client (lib/rpc.ts → supabase.rpc("complete_vehicle_task",
-- {p_task_id, p_mileage, p_hours, p_completed_date, ...})) matches the
-- canonical 9-arg v4 signature unambiguously when v4 is the only overload —
-- but with two overloads present, PostgREST returns PGRST203
-- ("Could not choose the best candidate"), the client surfaces a generic
-- "Failed to save. Please try again." toast, and mark-complete fails on every
-- TestFlight build.
--
-- This migration drops the hotfix overload by its exact 5-arg signature so
-- only the canonical v4 (defined in 20260417000000_complete_vehicle_task_v4.sql)
-- remains. Idempotent — IF EXISTS guards a clean rerun.

DROP FUNCTION IF EXISTS public.complete_vehicle_task(
  uuid,    -- p_task_id
  uuid,    -- p_vehicle_id
  uuid,    -- p_user_id
  integer, -- p_current_mileage
  date     -- p_completed_date
);
