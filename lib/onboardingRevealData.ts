// Shared onboarding reveal data — the asset-scoped reads behind the building
// scene's readiness check and plan-reveal's cards. One implementation, so the
// count the scene confirms and the rows the reveal renders cannot drift apart.
//
// Every read here THROWS on a Supabase error. A failed read is "unknown", never
// "zero rows"; callers decide what unknown means for them.
import { supabase } from "@/lib/supabase";
import { formatCostDisplay } from "@/lib/costFormat";

export type RevealVertical = "vehicle" | "home" | "health";
export type RevealItem = { name: string; dueLabel: string; costStr: string | null };
export type RevealData = { items: RevealItem[]; count: number; heroSentence: string | null };

export type VehicleTaskRow = {
  name: string;
  next_due_date: string | null;
  next_due_miles: number | null;
  next_due_hours: number | null;
  interval_miles: number | null;
  interval_hours: number | null;
  interval_months: number | null;
};

// Rows fetched for (and at most carried in) a reveal preview.
export const REVEAL_PREVIEW_LIMIT = 5;

function parseDate(dateStr: string | null): Date | null {
  const s = dateStr != null ? String(dateStr).trim() : "";
  const d = s.length > 0 ? new Date(s + (s.includes("T") ? "" : "T12:00:00")) : null;
  return d != null && !isNaN(d.getTime()) ? d : null;
}

function formatDue(dateStr: string | null, fallback: string | null): string {
  const d = parseDate(dateStr);
  if (d) return "Due " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return fallback || "Added to your plan";
}

function formatCost(v: number | null | undefined): string | null {
  if (v == null || Number(v) <= 0) return null;
  return "$" + Math.round(Number(v)).toLocaleString();
}

function vehicleDueLabel(t: VehicleTaskRow): string {
  const d = parseDate(t.next_due_date);
  if (d) return "Due " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (t.next_due_miles != null) return "Due at " + Number(t.next_due_miles).toLocaleString() + " mi";
  if (t.next_due_hours != null) return "Due at " + Number(t.next_due_hours).toLocaleString() + " hrs";
  if (t.interval_months != null) return "Every " + t.interval_months + " months";
  if (t.interval_miles != null) return "Every " + Number(t.interval_miles).toLocaleString() + " mi";
  if (t.interval_hours != null) return "Every " + Number(t.interval_hours).toLocaleString() + " hrs";
  return "Added to your maintenance plan";
}

function vehicleHeroSentence(t: VehicleTaskRow, displayName: string): string {
  const name = t.name.trim();
  const service = name.toLowerCase();
  if (t.next_due_miles != null) return `${displayName} needs ${service} at ${Number(t.next_due_miles).toLocaleString()} miles.`;
  if (t.next_due_hours != null) return `${displayName} needs ${service} at ${Number(t.next_due_hours).toLocaleString()} hours.`;
  const d = parseDate(t.next_due_date);
  if (d) return `${name} is coming up ${d.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`;
  return `${name} is first in your maintenance plan.`;
}

function exactCount(count: number | null, what: string): number {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new Error(`[onboarding] ${what}: row count unavailable`);
  }
  return count;
}

// Optional by design: a missing or failed cost lookup leaves the pills off, it
// never fails the reveal.
async function loadVehicleCostMap(assetId: string, rows: VehicleTaskRow[]): Promise<Record<string, string | null>> {
  const costMap: Record<string, string | null> = {};
  if (rows.length === 0) return costMap;
  try {
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("year, make, model, vehicle_type")
      .eq("id", assetId)
      .maybeSingle();
    if (!vehicle) return costMap;
    const vehicleKey = `${vehicle.year ?? ""}|${vehicle.make}|${vehicle.model ?? ""}|${vehicle.vehicle_type ?? ""}`.toLowerCase();
    const names = rows.map((t) => t.name.toLowerCase().trim());
    const { data: cached } = await supabase
      .from("repair_cost_cache")
      .select("service_name, shop_low, shop_high")
      .eq("vehicle_key", vehicleKey)
      .in("service_name", names);
    for (const c of cached ?? []) {
      costMap[String(c.service_name).toLowerCase().trim()] =
        formatCostDisplay(
          c.shop_low != null ? Number(c.shop_low) : null,
          c.shop_high != null ? Number(c.shop_high) : null,
        ) || null;
    }
  } catch {
    return {};
  }
  return costMap;
}

/** Exact number of plan rows for one asset. Health counts active (non-retired) appointments only. */
export async function loadOnboardingTaskCount(vertical: RevealVertical, assetId: string): Promise<number> {
  if (!assetId) return 0;

  if (vertical === "vehicle") {
    const { count, error } = await supabase
      .from("user_vehicle_maintenance_tasks")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", assetId);
    if (error) throw error;
    return exactCount(count, "vehicle tasks");
  }

  if (vertical === "home") {
    const { count, error } = await supabase
      .from("property_maintenance_tasks")
      .select("id", { count: "exact", head: true })
      .eq("property_id", assetId);
    if (error) throw error;
    return exactCount(count, "property tasks");
  }

  const { count, error } = await supabase
    .from("health_appointments")
    .select("id", { count: "exact", head: true })
    .eq("family_member_id", assetId)
    .is("retired_at", null);
  if (error) throw error;
  return exactCount(count, "health appointments");
}

/** First rows + exact count for one asset, shaped for the reveal cards. */
export async function loadOnboardingRevealData(vertical: RevealVertical, assetId: string, assetName: string): Promise<RevealData> {
  if (!assetId) return { items: [], count: 0, heroSentence: null };

  if (vertical === "vehicle") {
    const [rowsRes, count] = await Promise.all([
      supabase
        .from("user_vehicle_maintenance_tasks")
        .select("name, next_due_date, next_due_miles, next_due_hours, interval_miles, interval_hours, interval_months")
        .eq("vehicle_id", assetId)
        .order("next_due_date", { ascending: true, nullsFirst: false })
        .limit(REVEAL_PREVIEW_LIMIT),
      loadOnboardingTaskCount(vertical, assetId),
    ]);
    if (rowsRes.error) throw rowsRes.error;
    const raw: VehicleTaskRow[] = (rowsRes.data ?? []).filter((r) => typeof r.name === "string" && r.name.length > 0);
    const costMap = await loadVehicleCostMap(assetId, raw);
    const items = raw.map((r) => ({
      name: r.name,
      dueLabel: vehicleDueLabel(r),
      costStr: costMap[r.name.toLowerCase().trim()] ?? null,
    }));
    const first = raw[0];
    const heroSentence = first ? vehicleHeroSentence(first, assetName) : null;
    return { items, count, heroSentence };
  }

  if (vertical === "home") {
    const [rowsRes, count] = await Promise.all([
      supabase
        .from("property_maintenance_tasks")
        .select("task, next_due_date, estimated_cost, interval")
        .eq("property_id", assetId)
        .order("next_due_date", { ascending: true, nullsFirst: false })
        .limit(REVEAL_PREVIEW_LIMIT),
      loadOnboardingTaskCount(vertical, assetId),
    ]);
    if (rowsRes.error) throw rowsRes.error;
    const items = (rowsRes.data ?? [])
      .filter((r) => typeof r.task === "string" && r.task.length > 0)
      .map((r) => ({
        name: r.task,
        dueLabel: formatDue(r.next_due_date, r.interval ? String(r.interval) : null),
        costStr: formatCost(r.estimated_cost),
      }));
    return { items, count, heroSentence: null };
  }

  const [rowsRes, count] = await Promise.all([
    supabase
      .from("health_appointments")
      .select("appointment_type, next_due_date, estimated_cost, interval_months")
      .eq("family_member_id", assetId)
      .is("retired_at", null)
      .order("next_due_date", { ascending: true, nullsFirst: false })
      .limit(REVEAL_PREVIEW_LIMIT),
    loadOnboardingTaskCount(vertical, assetId),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  const items = (rowsRes.data ?? [])
    .filter((r) => typeof r.appointment_type === "string" && r.appointment_type.length > 0)
    .map((r) => ({
      name: r.appointment_type,
      dueLabel: formatDue(r.next_due_date, r.interval_months != null ? `Every ${r.interval_months} months` : null),
      costStr: formatCost(r.estimated_cost),
    }));
  return { items, count, heroSentence: null };
}

function isPositiveInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

/** True when a reveal can render from this data: a positive count and at least one named row. */
export function isRevealPreviewReady(data: RevealData | null | undefined): data is RevealData {
  if (!data) return false;
  if (!isPositiveInteger(data.count)) return false;
  return data.items.some((i) => i.name.trim().length > 0);
}

/** Route-param form of a confirmed preview: at most REVEAL_PREVIEW_LIMIT items plus count and hero sentence. */
export function serializeRevealPreview(data: RevealData): string {
  return JSON.stringify({
    // Blank-named rows are dropped here so the payload always passes
    // parseRevealPreview, which rejects any item without a name.
    items: data.items
      .filter((i) => i.name.trim().length > 0)
      .slice(0, REVEAL_PREVIEW_LIMIT)
      .map((i) => ({ name: i.name, dueLabel: i.dueLabel, costStr: i.costStr })),
    count: data.count,
    heroSentence: data.heroSentence,
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseRevealItem(v: unknown): RevealItem | null {
  if (!isRecord(v)) return null;
  const { name, dueLabel, costStr } = v;
  if (typeof name !== "string" || name.trim().length === 0) return null;
  if (typeof dueLabel !== "string") return null;
  if (costStr !== null && typeof costStr !== "string") return null;
  return { name, dueLabel, costStr };
}

/**
 * Validates the preview handed over by the building scene. Returns null unless
 * the whole payload is well-formed: a positive integer taskCount that matches
 * the payload's own count, 1..REVEAL_PREVIEW_LIMIT complete items, and a
 * string-or-null hero sentence. Anything else means "no scene payload".
 */
export function parseRevealPreview(previewParam: string, taskCountParam: string): RevealData | null {
  if (!previewParam || !/^[0-9]+$/.test(taskCountParam)) return null;
  const taskCount = Number(taskCountParam);
  if (!isPositiveInteger(taskCount)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(previewParam);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { items: rawItems, count, heroSentence } = parsed;
  if (!isPositiveInteger(count) || count !== taskCount) return null;
  if (heroSentence !== null && typeof heroSentence !== "string") return null;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > REVEAL_PREVIEW_LIMIT) return null;

  const items: RevealItem[] = [];
  for (const raw of rawItems) {
    const item = parseRevealItem(raw);
    if (!item) return null;
    items.push(item);
  }
  return { items, count, heroSentence };
}
