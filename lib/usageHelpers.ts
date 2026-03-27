import {
  inferTrackingModeFromVehicleType,
  type TrackingMode,
} from "./vehicleTypes";

export type { TrackingMode } from "./vehicleTypes";

/** Prefer explicit DB `tracking_mode`; fall back to type inference for legacy rows. */
export function resolveTrackingMode(vehicle: {
  tracking_mode?: string | null;
  vehicle_type?: string | null;
}): TrackingMode {
  const raw = vehicle.tracking_mode?.toLowerCase()?.trim();
  if (
    raw === "mileage" ||
    raw === "hours" ||
    raw === "both" ||
    raw === "time_only"
  ) {
    return raw;
  }
  return inferTrackingModeFromVehicleType(vehicle.vehicle_type);
}

export function isMileageTrackedMode(mode: TrackingMode): boolean {
  return mode === "mileage" || mode === "both";
}

export function isHoursTrackedMode(mode: TrackingMode): boolean {
  return mode === "hours" || mode === "both";
}

export function isTimeOnlyMode(mode: TrackingMode): boolean {
  return mode === "time_only";
}

/**
 * Primary meter label for generic UI. For `both`, mileage is treated as primary
 * unless you branch on task-level usage (see task helpers below).
 */
export function getPrimaryUsageLabel(mode: TrackingMode): "miles" | "hours" | "none" {
  if (mode === "time_only") return "none";
  if (mode === "hours") return "hours";
  if (mode === "mileage") return "miles";
  return "miles";
}

export function getCurrentUsageValue(
  vehicle: { mileage?: number | null; hours?: number | null },
  mode: TrackingMode,
): number {
  if (mode === "time_only") return 0;
  if (mode === "hours") return Number(vehicle.hours ?? 0);
  if (mode === "mileage") return Number(vehicle.mileage ?? 0);
  // both: default aggregate for dashboards that show one number — prefer miles
  return Number(vehicle.mileage ?? 0);
}

export function getCurrentHours(vehicle: { hours?: number | null }): number {
  return Number(vehicle.hours ?? 0);
}

export function getCurrentMiles(vehicle: { mileage?: number | null }): number {
  return Number(vehicle.mileage ?? 0);
}

export type UsageTaskLike = {
  status?: string | null;
  next_due_date?: string | null;
  next_due_miles?: number | null;
  next_due_hours?: number | null;
  interval_miles?: number | null;
  interval_hours?: number | null;
  interval_months?: number | null;
  last_completed_miles?: number | null;
  last_completed_hours?: number | null;
};

/** Label/copy helpers: true when the task row should read hour-based fields. */
export function taskUsesHoursUsage(
  task: UsageTaskLike,
  vehicleMode: TrackingMode,
): boolean {
  if (vehicleMode === "time_only" || vehicleMode === "mileage") return false;
  if (vehicleMode === "hours") {
    return (
      task.interval_hours != null ||
      task.next_due_hours != null ||
      task.last_completed_hours != null
    );
  }
  // both: hour copy when any hour field is present
  return (
    task.interval_hours != null ||
    task.next_due_hours != null ||
    task.last_completed_hours != null
  );
}

export function taskUsesMilesUsage(
  task: UsageTaskLike,
  vehicleMode: TrackingMode,
): boolean {
  if (vehicleMode === "time_only" || vehicleMode === "hours") return false;
  if (vehicleMode === "mileage") return true;
  return (
    task.interval_miles != null ||
    task.next_due_miles != null ||
    task.last_completed_miles != null
  );
}

export function getTaskIntervalMiles(task: UsageTaskLike): number | null {
  const v = task.interval_miles;
  return v != null && v > 0 ? v : null;
}

export function getTaskIntervalHours(task: UsageTaskLike): number | null {
  const v = task.interval_hours;
  return v != null && v > 0 ? v : null;
}

export function getTaskNextDueMiles(task: UsageTaskLike): number | null {
  const v = task.next_due_miles;
  return v != null && v >= 0 ? v : null;
}

export function getTaskNextDueHours(task: UsageTaskLike): number | null {
  const v = task.next_due_hours;
  return v != null && v >= 0 ? Number(v) : null;
}

export function getTaskLastCompletedMiles(task: UsageTaskLike): number | null {
  const v = task.last_completed_miles;
  return v != null && v >= 0 ? v : null;
}

export function getTaskLastCompletedHours(task: UsageTaskLike): number | null {
  const v = task.last_completed_hours;
  return v != null && v >= 0 ? Number(v) : null;
}

export function computeNextDueMilesAfterComplete(
  completedMiles: number,
  intervalMiles: number | null,
): number | null {
  if (intervalMiles == null || intervalMiles <= 0) return null;
  return completedMiles + intervalMiles;
}

export function computeNextDueHoursAfterComplete(
  completedHours: number,
  intervalHours: number | null,
): number | null {
  if (intervalHours == null || intervalHours <= 0) return null;
  return Math.round((completedHours + intervalHours) * 1000) / 1000;
}

const DUE_SOON_MILES = 500;
const DUE_SOON_HOURS = 50;

function parseDueDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    return new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  } catch {
    return null;
  }
}

/**
 * Unified task status for schedule grouping. Date-only tasks still use calendar rules.
 */
export function calcVehicleTaskStatus(
  task: UsageTaskLike,
  vehicle: { mileage?: number | null; hours?: number | null },
  vehicleMode: TrackingMode,
): "overdue" | "due_soon" | "upcoming" | "completed" {
  if (task.status === "completed") return "completed";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = parseDueDate(task.next_due_date);
  if (dueDate) dueDate.setHours(0, 0, 0, 0);

  const dateOverdue = dueDate != null && dueDate <= today;
  const dateDueSoon =
    dueDate != null &&
    dueDate > today &&
    differenceInDaysSafe(dueDate, today) <= 30;

  if (vehicleMode === "time_only") {
    if (dateOverdue) return "overdue";
    if (dateDueSoon) return "due_soon";
    return "upcoming";
  }

  let usageOverdue = false;
  let usageDueSoon = false;

  const checkHours = vehicleMode === "hours" || vehicleMode === "both";
  const checkMiles = vehicleMode === "mileage" || vehicleMode === "both";

  if (checkHours) {
    const nh = getTaskNextDueHours(task);
    if (nh != null) {
      const ch = getCurrentHours(vehicle);
      if (ch >= nh) usageOverdue = true;
      else if (nh - ch <= DUE_SOON_HOURS && nh > ch) usageDueSoon = true;
    }
  }
  if (checkMiles) {
    const nm = getTaskNextDueMiles(task);
    if (nm != null) {
      const cm = getCurrentMiles(vehicle);
      if (cm >= nm) usageOverdue = true;
      else if (!usageOverdue && nm - cm <= DUE_SOON_MILES && nm > cm) {
        usageDueSoon = true;
      }
    }
  }

  if (usageOverdue || dateOverdue) return "overdue";
  if (usageDueSoon || dateDueSoon) return "due_soon";
  return "upcoming";
}

function differenceInDaysSafe(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function formatEveryInterval(
  task: UsageTaskLike,
  vehicleMode: TrackingMode,
): string | null {
  const months = task.interval_months;
  const im = getTaskIntervalMiles(task);
  const ih = getTaskIntervalHours(task);
  const parts: string[] = [];

  if (
    vehicleMode !== "time_only" &&
    taskUsesHoursUsage(task, vehicleMode) &&
    ih != null
  ) {
    parts.push(`every ${formatHours(ih)}`);
  } else if (im != null) {
    parts.push(`every ${im.toLocaleString()} miles`);
  }
  if (months != null && months > 0) {
    parts.push(months === 1 ? "every month" : `every ${months} months`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function formatDueAtUsage(
  task: UsageTaskLike,
  vehicleMode: TrackingMode,
): string | null {
  const nh = getTaskNextDueHours(task);
  const nm = getTaskNextDueMiles(task);
  if (vehicleMode !== "time_only" && taskUsesHoursUsage(task, vehicleMode) && nh != null) {
    return `due at ${formatHours(nh)}`;
  }
  if (nm != null) {
    return `due at ${nm.toLocaleString()} mi`;
  }
  return null;
}

export function formatHours(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toLocaleString()} hours`;
}

export function formatServiceLogUsageReading(
  value: number | null | undefined,
  mode: TrackingMode,
): string | null {
  if (value == null || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  if (isHoursTrackedMode(mode) && !isMileageTrackedMode(mode)) {
    return `${n.toLocaleString()} hours`;
  }
  return `${n.toLocaleString()} mi`;
}
