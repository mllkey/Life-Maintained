import { supabase } from "./supabase";

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
    daily:          () => addDays(from, 1),
    "7_days":       () => addDays(from, 7),
    weekly:         () => addDays(from, 7),
    monthly:        () => addMonths(from, 1),
    "1_month":      () => addMonths(from, 1),
    "3_months":     () => addMonths(from, 3),
    quarterly:      () => addMonths(from, 3),
    "4_months":     () => addMonths(from, 4),
    "6_months":     () => addMonths(from, 6),
    bi_annually:    () => addMonths(from, 6),
    "12_months":    () => addYears(from, 1),
    annually:       () => addYears(from, 1),
    "every_year":   () => addYears(from, 1),
    "1_year":       () => addYears(from, 1),
    "2_years":      () => addYears(from, 2),
    "every_2_years":() => addYears(from, 2),
    "3_years":      () => addYears(from, 3),
    "every_3_years":() => addYears(from, 3),
    "5_years":      () => addYears(from, 5),
    "every_5_years":() => addYears(from, 5),
  };

  if (key in TABLE) return TABLE[key]();

  const numMatch = key.match(/^(\d+)_(day|week|month|year)s?$/);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
    switch (numMatch[2]) {
      case "day":   return addDays(from, n);
      case "week":  return addDays(from, n * 7);
      case "month": return addMonths(from, n);
      case "year":  return addYears(from, n);
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

  if (mileageInterval && mileageInterval > 0 && serviceMileage != null && avgMilesPerMonth && avgMilesPerMonth > 0) {
    const months = mileageInterval / avgMilesPerMonth;
    mileageDate = addDays(serviceDate, Math.round(months * 30.44));
  }

  if (intervalStr && !isAsNeededInterval(intervalStr)) {
    timeDate = parseIntervalToDate(intervalStr, serviceDate);
  }

  if (mileageDate && timeDate) return (mileageDate < timeDate ? mileageDate : timeDate).toISOString();
  return (mileageDate ?? timeDate)?.toISOString() ?? null;
}

export async function matchAndUpdateVehicleTask(
  vehicleId: string,
  serviceName: string,
  serviceDate: string,
  serviceMileage: number | null,
): Promise<MatchResult | null> {
  if (!serviceName.trim()) return null;

  try {
    const [{ data: tasks }, { data: vehicle }] = await Promise.all([
      supabase.from("user_vehicle_maintenance_tasks").select("*").eq("vehicle_id", vehicleId),
      supabase.from("vehicles").select("average_miles_per_month").eq("id", vehicleId).single(),
    ]);

    if (!tasks || tasks.length === 0) return null;

    const matched = fuzzyMatchTask(serviceName, tasks);
    if (!matched) return null;

    const intervalStr = matched.interval_months != null
      ? `${matched.interval_months}_months`
      : (matched.interval ?? null);
    const mileageInterval = matched.interval_miles ?? matched.mileage_interval ?? null;
    const asNeeded = isAsNeededInterval(intervalStr);
    const nextDue = asNeeded
      ? null
      : calculateNextDue(
          intervalStr,
          mileageInterval,
          serviceDate,
          serviceMileage,
          (vehicle as any)?.average_miles_per_month ?? null,
        );

    const updatePayload: Record<string, any> = {
      last_completed_date: new Date(serviceDate + "T12:00:00").toISOString().split("T")[0],
      last_completed_miles: serviceMileage,
      updated_at: new Date().toISOString(),
    };
    if (!asNeeded) {
      updatePayload.next_due_date = nextDue;
    }

    await supabase.from("user_vehicle_maintenance_tasks")
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

    await supabase.from("property_maintenance_tasks")
      .update(updatePayload)
      .eq("id", matched.id);

    return { taskId: matched.id, taskName: matched.task, nextDue };
  } catch {
    return null;
  }
}
