/**
 * lib/usageHelpers.ts
 *
 * Centralized helpers for usage-based tracking (mileage, hours, time-only).
 * Every screen that needs to know "is this miles or hours?" should import from here.
 * Do NOT scatter if/else tracking-mode logic across screens.
 */

import { inferTrackingMode } from "./vehicleTypes";

function fullCalendarDaysBetween(later: Date, earlier: Date): number {
  const L = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const E = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.floor((L - E) / 86400000);
}

// ── Types ───────────────────────────────────────────────────────────────

export type TrackingMode = "mileage" | "hours" | "both" | "time_only";

export interface VehicleRow {
  vehicle_type?: string | null;
  tracking_mode?: string | null;
  mileage?: number | null;
  hours?: number | null;
  average_miles_per_month?: number | null;
  last_mileage_update?: string | null;
}

export interface TaskRow {
  interval_miles?: number | null;
  interval_hours?: number | null;
  interval_months?: number | null;
  next_due_miles?: number | null;
  next_due_hours?: number | null;
  next_due_date?: string | null;
  last_completed_miles?: number | null;
  last_completed_hours?: number | null;
  last_completed_date?: string | null;
  [key: string]: any;
}

// ── Tracking mode resolution ────────────────────────────────────────────

/**
 * Resolve the tracking mode for a vehicle.
 * Priority: explicit DB tracking_mode > inference from vehicle_type.
 */
export function resolveTrackingMode(vehicle: VehicleRow | null | undefined): TrackingMode {
  if (!vehicle) return "mileage";
  const explicit = vehicle.tracking_mode;
  if (explicit === "mileage" || explicit === "hours" || explicit === "both" || explicit === "time_only") {
    return explicit;
  }
  return inferTrackingMode(vehicle.vehicle_type ?? "");
}

export function isMileageTracked(vehicle: VehicleRow | null | undefined): boolean {
  const mode = resolveTrackingMode(vehicle);
  return mode === "mileage" || mode === "both";
}

export function isHoursTracked(vehicle: VehicleRow | null | undefined): boolean {
  const mode = resolveTrackingMode(vehicle);
  return mode === "hours" || mode === "both";
}

export function isTimeOnly(vehicle: VehicleRow | null | undefined): boolean {
  return resolveTrackingMode(vehicle) === "time_only";
}

// ── Usage labels ────────────────────────────────────────────────────────

/**
 * Returns the primary usage unit label for display.
 * "miles" | "hours" | null (for time-only)
 * NOTE: "both" mode biases to hours as the primary display unit in this pass.
 * Full dual-meter UI is deferred.
 */
export function primaryUsageLabel(vehicle: VehicleRow | null | undefined): "miles" | "hours" | null {
  const mode = resolveTrackingMode(vehicle);
  if (mode === "hours") return "hours";
  if (mode === "mileage") return "miles";
  if (mode === "both") return "hours"; // primary display is hours for dual-meter
  return null;
}

/**
 * Short unit abbreviation for compact display.
 */
export function usageUnitShort(vehicle: VehicleRow | null | undefined): string {
  const label = primaryUsageLabel(vehicle);
  if (label === "hours") return "hrs";
  if (label === "miles") return "mi";
  return "";
}

/**
 * Returns the current usage reading from the vehicle row.
 */
export function currentUsageValue(vehicle: VehicleRow | null | undefined): number | null {
  if (!vehicle) return null;
  const mode = resolveTrackingMode(vehicle);

  if (mode === "hours" || mode === "both") {
    return vehicle.hours ?? null;
  }

  if (mode === "mileage") {
    const stored = vehicle.mileage ?? null;
    if (stored == null) return null;

    const avg = Math.max(0, vehicle.average_miles_per_month ?? 0);
    const lastUpdateRaw = vehicle.last_mileage_update;

    if (avg > 0 && lastUpdateRaw) {
      const lastUpdateMs = new Date(lastUpdateRaw).getTime();
      if (Number.isFinite(lastUpdateMs)) {
        const nowMs = Date.now();
        const monthsElapsed = Math.max(0, (nowMs - lastUpdateMs) / (1000 * 60 * 60 * 24 * 30.44));
        const estimated = stored + Math.round(avg * monthsElapsed);
        return Math.max(stored, estimated);
      }
    }

    return stored;
  }

  return null;
}

/**
 * Returns "Update mileage" / "Update hours" / null for time-only.
 */
export function updateUsageLabel(vehicle: VehicleRow | null | undefined): string | null {
  const label = primaryUsageLabel(vehicle);
  if (label === "hours") return "Update hours";
  if (label === "miles") return "Update mileage";
  return null;
}

/**
 * Returns the DB column name to write usage updates to.
 */
export function usageDbColumn(vehicle: VehicleRow | null | undefined): "mileage" | "hours" | null {
  const mode = resolveTrackingMode(vehicle);
  if (mode === "hours" || mode === "both") return "hours";
  if (mode === "mileage") return "mileage";
  return null;
}

// ── Task interval reading ───────────────────────────────────────────────

/**
 * Returns the usage-based interval for a task (miles or hours).
 * Returns null for time-only tasks.
 */
export function taskIntervalUsage(task: TaskRow, vehicle: VehicleRow | null | undefined): number | null {
  const mode = resolveTrackingMode(vehicle);
  if (mode === "hours" || mode === "both") return task.interval_hours ?? null;
  if (mode === "mileage") return task.interval_miles ?? null;
  return null;
}

/**
 * Returns the next-due usage value for a task.
 */
export function taskNextDueUsage(task: TaskRow, vehicle: VehicleRow | null | undefined): number | null {
  const mode = resolveTrackingMode(vehicle);
  if (mode === "hours" || mode === "both") return task.next_due_hours != null ? Number(task.next_due_hours) : null;
  if (mode === "mileage") return task.next_due_miles ?? null;
  return null;
}

/**
 * Returns the last-completed usage value for a task.
 */
export function taskLastCompletedUsage(task: TaskRow, vehicle: VehicleRow | null | undefined): number | null {
  const mode = resolveTrackingMode(vehicle);
  if (mode === "hours" || mode === "both") return task.last_completed_hours != null ? Number(task.last_completed_hours) : null;
  if (mode === "mileage") return task.last_completed_miles ?? null;
  return null;
}

// ── Completion calculation ──────────────────────────────────────────────

/**
 * After marking a task complete, calculate the next due usage value.
 * Returns null if the task has no usage-based interval.
 */
export function calculateNextDueUsage(
  task: TaskRow,
  vehicle: VehicleRow | null | undefined,
  completedUsageValue: number | null,
): number | null {
  if (completedUsageValue == null) return null;
  const interval = taskIntervalUsage(task, vehicle);
  if (interval == null) return null;
  return completedUsageValue + interval;
}

/**
 * Returns the DB field names to write on mark-complete for usage values.
 * E.g., { lastCompletedField: "last_completed_hours", nextDueField: "next_due_hours" }
 */
export function completionUsageFields(vehicle: VehicleRow | null | undefined): {
  lastCompletedField: string;
  nextDueField: string;
} | null {
  const mode = resolveTrackingMode(vehicle);
  if (mode === "hours" || mode === "both") {
    return { lastCompletedField: "last_completed_hours", nextDueField: "next_due_hours" };
  }
  if (mode === "mileage") {
    return { lastCompletedField: "last_completed_miles", nextDueField: "next_due_miles" };
  }
  return null;
}

// ── Formatting ──────────────────────────────────────────────────────────

/**
 * Format a usage value for display.
 * e.g., "45,000 mi" or "123.4 hrs"
 */
export function formatUsageValue(value: number | null | undefined, vehicle: VehicleRow | null | undefined): string {
  if (value == null) return "";
  const unit = usageUnitShort(vehicle);
  // Hours can have decimals, mileage is always whole
  const mode = resolveTrackingMode(vehicle);
  if (mode === "hours" || mode === "both") {
    const formatted = Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${formatted} ${unit}`;
  }
  return `${value.toLocaleString()} ${unit}`;
}

/**
 * Format a task interval for display.
 * e.g., "every 50 hours" or "every 5,000 miles"
 */
export function formatIntervalUsage(task: TaskRow, vehicle: VehicleRow | null | undefined): string | null {
  const interval = taskIntervalUsage(task, vehicle);
  if (interval == null) return null;
  const label = primaryUsageLabel(vehicle);
  return `every ${interval.toLocaleString()} ${label}`;
}

/**
 * Format a "due at" usage string.
 * e.g., "due at 50,000 mi" or "due at 250.0 hrs"
 */
export function formatDueAtUsage(task: TaskRow, vehicle: VehicleRow | null | undefined): string | null {
  const nextDue = taskNextDueUsage(task, vehicle);
  if (nextDue == null) return null;
  return `due at ${formatUsageValue(nextDue, vehicle)}`;
}

// ── Due status (usage-based) ────────────────────────────────────────────

/**
 * Evaluate whether a task is overdue or due soon based on usage.
 * This is ONLY the usage component — date-based status is handled separately.
 *
 * Returns "overdue" | "due_soon" | "good" | null (if no usage tracking).
 *
 * @param dueThresholdPct - percentage of interval remaining to consider "due soon" (default 10%)
 */
export function usageDueStatus(
  task: TaskRow,
  vehicle: VehicleRow | null | undefined,
  dueThresholdPct = 0.1,
): "overdue" | "due_soon" | "good" | null {
  const mode = resolveTrackingMode(vehicle);
  if (mode === "time_only") return null;

  const currentUsage = currentUsageValue(vehicle);
  const nextDue = taskNextDueUsage(task, vehicle);
  const interval = taskIntervalUsage(task, vehicle);

  if (currentUsage == null || nextDue == null) return null;

  if (currentUsage >= nextDue) return "overdue";

  // "Due soon" if within threshold % of the interval
  if (interval != null && interval > 0) {
    const remaining = nextDue - currentUsage;
    if (remaining <= interval * dueThresholdPct) return "due_soon";
  }

  return "good";
}

/**
 * Combined status: worst of date-based and usage-based.
 * Accepts a pre-computed dateStatus so this helper stays UI-free.
 */
export function combinedDueStatus(
  dateStatus: "overdue" | "due_soon" | "good",
  task: TaskRow,
  vehicle: VehicleRow | null | undefined,
): "overdue" | "due_soon" | "good" {
  const usageStatus = usageDueStatus(task, vehicle);
  if (dateStatus === "overdue" || usageStatus === "overdue") return "overdue";
  if (dateStatus === "due_soon" || usageStatus === "due_soon") return "due_soon";
  return "good";
}

/** Mode-based checks (for call sites that already resolved `TrackingMode`). */
export function isHoursTrackedMode(mode: TrackingMode): boolean {
  return mode === "hours" || mode === "both";
}

export function isMileageTrackedMode(mode: TrackingMode): boolean {
  return mode === "mileage" || mode === "both";
}

/**
 * Task schedule status for dashboard / lists — matches vehicle detail `calcStatus` logic.
 */
export function calcVehicleTaskStatus(
  task: TaskRow,
  vehicle: VehicleRow | null | undefined,
  mode: TrackingMode,
): "overdue" | "due_soon" | "upcoming" | "completed" {
  if (task.status === "completed") return "completed";
  const today = new Date();
  const dueDate = task.next_due_date ? new Date(task.next_due_date) : null;

  const currentUsage = currentUsageValue(vehicle);
  const nextDueUsage = taskNextDueUsage(task, vehicle);
  const hoursMode = isHoursTrackedMode(mode);
  const dueSoonThreshold = hoursMode ? 25 : 500;

  if (
    (nextDueUsage != null && currentUsage != null && currentUsage >= nextDueUsage) ||
    (dueDate != null && dueDate <= today)
  ) return "overdue";
  if (
    (nextDueUsage != null && currentUsage != null && nextDueUsage - currentUsage <= dueSoonThreshold) ||
    (dueDate != null && fullCalendarDaysBetween(dueDate, today) <= 30)
  ) return "due_soon";
  return "upcoming";
}