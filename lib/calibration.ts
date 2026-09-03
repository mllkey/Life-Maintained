/**
 * lib/calibration.ts
 *
 * Estimated-vs-confirmed classification for maintenance due dates.
 *
 * A freshly generated schedule invents its dates from intervals; nothing about
 * the user's real history is known yet. Those rows are ESTIMATED: they must
 * never claim urgency (no overdue, no Action Needed, no notifications).
 * The Confirm-history flow upgrades them to CALIBRATED; a real completion
 * makes them CONFIRMED.
 *
 * This module is dependency-free (no usageHelpers import) so usageHelpers can
 * import it without a cycle. Tracking mode is passed in where needed.
 */

export type CalibrationState = "estimated" | "calibrated" | "confirmed";

export type CalibrationChoice = "recent" | "while_back";

/** Seed detection window: generation writes completed ~= created. */
const SEED_WINDOW_MS = 60_000;

function withinSeedWindow(
  completed: string | null | undefined,
  created: string | null | undefined,
): boolean {
  if (!completed || !created) return false;
  const c = new Date(completed).getTime();
  const k = new Date(created).getTime();
  if (!Number.isFinite(c) || !Number.isFinite(k)) return false;
  return Math.abs(c - k) < SEED_WINDOW_MS;
}

export function vehicleTaskCalibrationState(task: {
  last_completed_date?: string | null;
  last_completed_miles?: number | null;
  last_completed_hours?: number | null;
  last_completed_source?: string | null;
  created_at?: string | null;
}): CalibrationState {
  if (task.last_completed_source === "calibrated") return "calibrated";
  // Emptiness dominates a 'logged' stamp: only an undo/reverse can produce
  // 'logged' with empty completion fields, and that task IS an estimate again.
  const empty =
    task.last_completed_date == null &&
    task.last_completed_miles == null &&
    task.last_completed_hours == null;
  if (empty) return "estimated";
  if (task.last_completed_source === "logged") return "confirmed";
  if (withinSeedWindow(task.last_completed_date, task.created_at)) return "estimated";
  return "confirmed";
}

export function propertyTaskCalibrationState(task: {
  last_completed_at?: string | null;
  last_completed_source?: string | null;
  created_at?: string | null;
}): CalibrationState {
  if (task.last_completed_source === "calibrated") return "calibrated";
  if (task.last_completed_at == null) return "estimated";
  if (task.last_completed_source === "logged") return "confirmed";
  if (withinSeedWindow(task.last_completed_at, task.created_at)) return "estimated";
  return "confirmed";
}

/**
 * Mirror of the server's per-axis validity rule. Mode is passed in (resolved
 * by the caller via resolveTrackingMode) to keep this module import-free.
 */
export function vehicleTaskHasCalibratableAxis(
  task: {
    interval_miles?: number | null;
    interval_hours?: number | null;
    interval_months?: number | null;
  },
  vehicle: { mileage?: number | null; hours?: number | null } | null | undefined,
  mode: "mileage" | "hours" | "both" | "time_only",
): boolean {
  if ((mode === "mileage" || mode === "both") && (task.interval_miles ?? 0) > 0 && vehicle?.mileage != null) return true;
  if ((mode === "hours" || mode === "both") && (task.interval_hours ?? 0) > 0 && vehicle?.hours != null) return true;
  if ((task.interval_months ?? 0) > 0) return true;
  return false;
}
