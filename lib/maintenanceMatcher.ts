import { supabase } from "./supabase";
import { completeVehicleTask } from "./rpc";
import type { Database } from "./supabase-types";

type PropertyTaskUpdate = Database["public"]["Tables"]["property_maintenance_tasks"]["Update"];

export type MatchResult = {
  taskId: string;
  taskName: string;
  nextDueDate: string | null;
  nextDueMiles: number | null;
  nextDueHours: number | null;
};

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

// --- Precision-first auto-complete matcher (F-003) -------------------------
// Used ONLY by matchAndUpdateVehicleTask / matchAndUpdatePropertyTask to decide
// whether a logged service should auto-mark a scheduled task complete. It must
// never mark the WRONG task done: it refuses (returns null, silently) on any
// categoryless service, cross-category conflict, or ambiguous tie. The exported
// CATEGORY_GROUPS above is intentionally left untouched and stays loose for the
// pricing-hint path.
type MatchCategory = { id: string; keywords: string[] };

const MATCH_CATEGORIES: MatchCategory[] = [
  { id: "engine_oil", keywords: ["oil change", "motor oil", "engine oil", "oil and filter", "oil & filter"] },
  { id: "tire_rotation", keywords: ["tire rotation", "tyre rotation", "rotate tires", "wheel rotation"] },
  { id: "wheel_alignment", keywords: ["wheel alignment", "alignment"] },
  { id: "brakes", keywords: ["brake pad", "brake rotor", "brake caliper", "brake service", "brake fluid", "brakes"] },
  { id: "cabin_air_filter", keywords: ["cabin air filter", "cabin filter", "pollen filter"] },
  { id: "engine_air_filter", keywords: ["engine air filter", "engine air", "air filter element", "intake filter"] },
  { id: "transmission", keywords: ["transmission fluid", "transmission service", "transmission", "gearbox", "trans fluid"] },
  { id: "battery", keywords: ["battery replacement", "battery"] },
  { id: "spark_plugs", keywords: ["spark plug", "spark plugs", "ignition coil"] },
  { id: "coolant", keywords: ["coolant flush", "coolant", "antifreeze", "radiator flush", "radiator coolant"] },
  { id: "wiper_blades", keywords: ["wiper blade", "wiper blades", "windshield wiper"] },
  { id: "timing_belt", keywords: ["timing belt", "timing chain", "serpentine belt", "drive belt"] },
  { id: "hvac", keywords: ["hvac", "furnace", "air conditioner", "heat pump", "furnace filter", "hvac filter"] },
  { id: "gutters", keywords: ["gutter", "gutters", "downspout"] },
  { id: "roof", keywords: ["roof", "shingle", "shingles"] },
  { id: "pest_control", keywords: ["pest control", "termite", "exterminator", "pest treatment"] },
  { id: "exterior_paint", keywords: ["exterior paint", "repaint", "paint exterior", "house paint"] },
  { id: "plumbing", keywords: ["plumbing", "water heater", "drain clog", "sump pump", "burst pipe", "leaky pipe"] },
];

const MATCH_STOPWORDS = new Set<string>([
  "the", "and", "for", "with", "service", "services", "replace", "replacement",
  "change", "changed", "check", "checked", "inspect", "inspection", "maintenance",
  "system", "fluid", "filter", "new", "kit", "front", "rear", "left", "right",
  "annual", "yearly", "scheduled", "general", "full", "complete",
]);

function matchTokens(norm: string): string[] {
  return norm.split(" ").filter(w => w.length >= 3 && MATCH_STOPWORDS.has(w) === false);
}

function matchCategoriesFor(norm: string): Set<string> {
  const out = new Set<string>();
  for (const cat of MATCH_CATEGORIES) {
    if (cat.keywords.some(kw => norm.includes(kw))) out.add(cat.id);
  }
  return out;
}

const MATCH_MARGIN = 2;

export function fuzzyMatchTask(serviceName: string, tasks: any[]): any | null {
  const serviceNorm = normalize(serviceName);
  if (serviceNorm.length === 0) return null;

  const svcCats = matchCategoriesFor(serviceNorm);
  if (svcCats.size === 0) return null;
  const svcTokens = matchTokens(serviceNorm);

  let best: any = null;
  let bestScore = 0;
  let secondScore = 0;

  for (const t of tasks) {
    const taskNorm = normalize(t.name ?? t.task ?? "");
    if (taskNorm.length === 0) continue;

    const tskCats = matchCategoriesFor(taskNorm);

    // Conflict veto: both sides categorized but to disjoint categories.
    let sharedCategory = false;
    if (svcCats.size > 0 && tskCats.size > 0) {
      for (const id of svcCats) {
        if (tskCats.has(id)) { sharedCategory = true; break; }
      }
      if (sharedCategory === false) continue;
    }

    // Exact-token overlap on specific (non-stopword) words.
    const taskTokenSet = new Set(matchTokens(taskNorm));
    const counted = new Set<string>();
    let sharedWords = 0;
    for (const w of svcTokens) {
      if (counted.has(w) === false && taskTokenSet.has(w)) {
        sharedWords += 1;
        counted.add(w);
      }
    }

    // Require a genuine signal: a shared category, or >= 2 shared specific words.
    const hasSignal = sharedCategory || sharedWords >= 2;
    if (hasSignal === false) continue;

    const score = (sharedCategory ? 4 : 0) + sharedWords;

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = t;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (best === null) return null;
  if (bestScore - secondScore < MATCH_MARGIN) return null; // ambiguous -> refuse

  return best;
}
// --- end F-003 -------------------------------------------------------------

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
    const { data: tasks } = await supabase
      .from("user_vehicle_maintenance_tasks")
      .select("*")
      .eq("vehicle_id", vehicleId);

    if (!tasks || tasks.length === 0) return null;

    const matched = fuzzyMatchTask(serviceName, tasks);
    if (!matched) return null;

    // Route through canonical RPC — it handles tracking mode, interval
    // computation, vehicle usage update, and mileage history atomically.
    const { data: rpcData, error: rpcErr } = await completeVehicleTask({
      p_task_id: matched.id,
      p_mileage: serviceMileage ?? undefined,
      p_hours: serviceHours ?? undefined,
      p_completed_date: new Date(serviceDate + "T12:00:00").toISOString(),
      p_skip_log: true,
    });

    if (rpcErr) {
      const e: unknown = rpcErr;
      const rpcMessage =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as { message?: unknown }).message ?? "Unknown RPC error")
            : "Unknown RPC error";
      console.warn("[matcher] complete_vehicle_task RPC error:", rpcMessage);
      return null;
    }

    return {
      taskId: matched.id,
      taskName: matched.name,
      nextDueDate: rpcData?.next_due_date ? new Date(rpcData.next_due_date + "T12:00:00").toISOString() : null,
      nextDueMiles: rpcData?.next_due_miles ?? null,
      nextDueHours: rpcData?.next_due_hours ?? null,
    };
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

    const updatePayload: PropertyTaskUpdate = {
      last_completed_at: new Date(serviceDate + "T12:00:00").toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!asNeeded) {
      updatePayload.next_due_date = nextDue;
    }

    await supabase.from("property_maintenance_tasks").update(updatePayload).eq("id", matched.id);

    return { taskId: matched.id, taskName: matched.task, nextDueDate: nextDue, nextDueMiles: null, nextDueHours: null };
  } catch {
    return null;
  }
}