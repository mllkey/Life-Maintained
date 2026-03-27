import { supabase } from "./supabase";
import { resolveTrackingMode } from "./usageHelpers";

export type MatchResult = { taskId: string; taskName: string; nextDue: string | null };

export const CATEGORY_GROUPS: string[][] = [
  ["oil", "lube", "motor oil", "synthetic"],
  ["tire", "tyre", "rotation", "alignment"],
  ["brake", "rotor", "pad", "caliper"],
  ["air filter", "cabin filter"],
  ["transmission", "trans", "gearbox"],
  ["battery"],
  ["spark plug", "ignition"],
  ["coolant", "antifreeze", "radiator"],
  ["wiper", "blade"],
  ["inspection", "check"],
  ["fluid"],
  ["belt", "timing"],
  ["hvac", "furnace", "filter"],
  ["gutter", "drain"],
  ["roof", "shingle"],
  ["pest", "termite"],
  ["paint", "exterior"],
  ["plumbing", "pipe"],
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[&,.()\-\/+]/g, " ").replace(/\s+/g, " ").trim();
}

export function fuzzyMatchTask(serviceName: string, tasks: any[]): any | null {
  const serviceNorm = normalize(serviceName);
  let bestMatch: any = null;
  let bestScore = 0;

  for (const t of tasks) {
    const taskNorm = normalize(t.name ?? t.task ?? "");
    let score = 0;

    const sWords = serviceNorm.split(" ").filter(w => w.length >= 3);
    const tWords = taskNorm.split(" ").filter(w => w.length >= 3);

    for (const sw of sWords) {
      if (tWords.some(tw => tw === sw || tw.includes(sw) || sw.includes(tw))) score += 2;
    }

    for (const group of CATEGORY_GROUPS) {
      const svcHas = group.some(kw => serviceNorm.includes(kw));
      const tskHas = group.some(kw => taskNorm.includes(kw));
      if (svcHas && tskHas) score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = t;
    }
  }

  return bestScore >= 3 ? bestMatch : null;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function parseIntervalToDate(interval: string, from: Date): Date | null {
  const key = interval.toLowerCase().replace(/[\s\-]+/g, "_").trim();

  const TABLE: Record<string, () => Date> = {
    daily: () => addDays(from, 1),
    "7_days": () => addDays(from, 7),
    weekly: () => addDays(from, 7),
    monthly: () => addMonths(from, 1),
    "1_month": () => addMonths(from, 1),
    "3_months": () => addMonths(from, 3),
    quarterly: () => addMonths(from, 3),
    "4_months": () => addMonths(from, 4),
    "6_months": () => addMonths(from, 6),
    bi_annually: () => addMonths(from, 6),
    "12_months": () => addYears(from, 1),
    annually: () => addYears(from, 1),
    "every_year": () => addYears(from, 1),
    "1_year": () => addYears(from, 1),
    "2_years": () => addYears(from, 2),
    "every_2_years": () => addYears(from, 2),
    "3_years": () => addYears(from, 3),
    "every_3_years": () => addYears(from, 3),
    "5_years": () => addYears(from, 5),
    "every_5_years": () => addYears(from, 5),
  };

  if (key in TABLE) return TABLE[key]();

  const numMatch = key.match(/^(\d+)_(day|week|month|year)s?$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    switch (numMatch[2]) {
      case "day":
        return addDays(from, n);
      case "week":
        return addDays(from, n * 7);
      case "month":
        return addMonths(from, n);
      case "year":
        return addYears(from, n);
    }
  }

  return null;
}

export function isAsNeededInterval(interval: string | null | undefined): boolean {
  if (!interval) return false;
  const key = interval.toLowerCase().replace(/[\s\-]+/g, "_").trim();
  return key === "as_needed" || key === "as_required" || key === "on_demand";
}

export function calculateNextDue(
  intervalStr: string | null | undefined,
  mileageInterval: number | null | undefined,
  serviceDateStr: string,
  serviceMileage: number | null,
  avgMilesPerMonth: number | null,
): string | null {
  const serviceDate = new Date(serviceDateStr + "T12:00:00");
  let mileageDate: Date | null = null;
  let timeDate: Date | null = null;

  if (
    mileageInterval &&
    mileageInterval > 0 &&
    serviceMileage != null &&
    avgMilesPerMonth &&
    avgMilesPerMonth > 0
  ) {
    const months = mileageInterval / avgMilesPerMonth;
    mileageDate = addDays(serviceDate, Math.round(months * 30.44));
  }

  if (intervalStr && !isAsNeededInterval(intervalStr)) {
    timeDate = parseIntervalToDate(intervalStr, serviceDate);
  }

  if (mileageDate && timeDate) {
    return (mileageDate < timeDate ? mileageDate : timeDate).toISOString();
  }

  return (mileageDate ?? timeDate)?.toISOString() ?? null;
}

export async function matchAndUpdateVehicleTask(
  vehicleId: string,
  serviceName: string,
  serviceDate: string,
  serviceMileage: number | null,
  serviceHours: number | null = null,
): Promise<MatchResult | null> {
  if (!serviceName.trim()) return null;

  try {
    const [{ data: tasks }, { data: vehicle }] = await Promise.all([
      supabase.from("user_vehicle_maintenance_tasks").select("*").eq("vehicle_id", vehicleId),
      supabase
        .from("vehicles")
        .select("average_miles_per_month, tracking_mode, vehicle_type")
        .eq("id", vehicleId)
        .single(),
    ]);

    if (!tasks || tasks.length === 0) return null;

    const matched = fuzzyMatchTask(serviceName, tasks);
    if (!matched) return null;

    const mode = resolveTrackingMode(
      (vehicle ?? {}) as { tracking_mode?: string | null; vehicle_type?: string | null }
    );

    const intervalStr =
      matched.interval_months != null
        ? `${matched.interval_months}_months`
        : (matched.interval ?? null);

    const mileageInterval = matched.interval_miles ?? matched.mileage_interval ?? null;
    const hoursInterval = matched.interval_hours ?? null;
    const asNeeded = isAsNeededInterval(intervalStr);

    const updatePayload: Record<string, unknown> = {
      last_completed_date: new Date(serviceDate + "T12:00:00").toISOString().split("T")[0],
      updated_at: new Date().toISOString(),
    };

    let nextDue: string | null = null;

    const hasHoursReading = serviceHours != null && Number.isFinite(serviceHours);
    const hasMileageReading = serviceMileage != null && Number.isFinite(serviceMileage);

    if (hasHoursReading && (mode === "hours" || mode === "both")) {
      const completedHours = Number(serviceHours);

      updatePayload.last_completed_hours = completedHours;
      updatePayload.last_completed_miles = null;
      updatePayload.next_due_miles = null;

      if (!asNeeded && hoursInterval != null && hoursInterval > 0) {
        updatePayload.next_due_hours = completedHours + hoursInterval;
      } else {
        updatePayload.next_due_hours = null;
      }

      if (!asNeeded && matched.interval_months != null && matched.interval_months > 0) {
        const d = new Date(serviceDate + "T12:00:00");
        d.setMonth(d.getMonth() + matched.interval_months);
        updatePayload.next_due_date = d.toISOString().split("T")[0];
        nextDue = d.toISOString();
      } else {
        updatePayload.next_due_date = null;
      }
    } else if (hasMileageReading && (mode === "mileage" || mode === "both")) {
      const completedMileage = Number(serviceMileage);

      updatePayload.last_completed_miles = completedMileage;
      updatePayload.last_completed_hours = null;
      updatePayload.next_due_hours = null;

      if (!asNeeded && mileageInterval != null && mileageInterval > 0) {
        updatePayload.next_due_miles = completedMileage + mileageInterval;
      } else {
        updatePayload.next_due_miles = null;
      }

      if (!asNeeded) {
        nextDue = calculateNextDue(
          intervalStr,
          mileageInterval,
          serviceDate,
          completedMileage,
          (vehicle as { average_miles_per_month?: number | null })?.average_miles_per_month ?? null,
        );
        updatePayload.next_due_date = nextDue ? nextDue.split("T")[0] : null;
      } else {
        updatePayload.next_due_date = null;
      }
    } else if (!asNeeded && matched.interval_months != null && matched.interval_months > 0) {
      const d = new Date(serviceDate + "T12:00:00");
      d.setMonth(d.getMonth() + matched.interval_months);
      updatePayload.next_due_date = d.toISOString().split("T")[0];
      nextDue = d.toISOString();

      updatePayload.last_completed_miles = null;
      updatePayload.last_completed_hours = null;
      updatePayload.next_due_miles = null;
      updatePayload.next_due_hours = null;
    } else {
      if (mode === "hours" || mode === "both") {
        updatePayload.last_completed_miles = null;
        updatePayload.next_due_miles = null;
      }
      if (mode === "mileage") {
        updatePayload.last_completed_hours = null;
        updatePayload.next_due_hours = null;
      }
      if (mode === "time_only") {
        updatePayload.last_completed_miles = null;
        updatePayload.last_completed_hours = null;
        updatePayload.next_due_miles = null;
        updatePayload.next_due_hours = null;
      }
      updatePayload.next_due_date = null;
    }

    await supabase
      .from("user_vehicle_maintenance_tasks")
      .update(updatePayload)
      .eq("id", matched.id);

    return { taskId: matched.id, taskName: matched.name, nextDue };
  } catch {
    return null;
  }
}

export async function matchAndUpdatePropertyTask(
  propertyId: string,
  serviceName: string,
  serviceDate: string,
): Promise<MatchResult | null> {
  if (!serviceName.trim()) return null;

  try {
    const { data: tasks } = await supabase
      .from("property_maintenance_tasks")
      .select("*")
      .eq("property_id", propertyId);

    if (!tasks || tasks.length === 0) return null;

    const matched = fuzzyMatchTask(serviceName, tasks);
    if (!matched) return null;

    const asNeeded = isAsNeededInterval(matched.interval);
    const nextDue = asNeeded
      ? null
      : calculateNextDue(matched.interval, null, serviceDate, null, null);

    const updatePayload: Record<string, any> = {
      last_completed_at: new Date(serviceDate + "T12:00:00").toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!asNeeded) {
      updatePayload.next_due_date = nextDue;
    }

    await supabase.from("property_maintenance_tasks").update(updatePayload).eq("id", matched.id);

    return { taskId: matched.id, taskName: matched.task, nextDue };
  } catch {
    return null;
  }
}