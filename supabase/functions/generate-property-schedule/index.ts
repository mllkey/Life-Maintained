import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ── Climate zone lookup (IECC simplified) ──────────────────────────────
function getClimateZone(zip: string): { zone: number; description: string } {
  if (!zip || zip.length < 3) return { zone: 4, description: "Mixed (default)" };
  const prefix = parseInt(zip.substring(0, 3), 10);

  // Hot: South Florida, Hawaii, South Texas, South Arizona
  if (prefix >= 327 && prefix <= 339) return { zone: 1, description: "Hot-Humid (South Florida)" };
  if (prefix >= 967 && prefix <= 968) return { zone: 1, description: "Hot-Humid (Hawaii)" };
  if (prefix >= 780 && prefix <= 789) return { zone: 1, description: "Hot (South Texas)" };
  if (prefix >= 850 && prefix <= 857) return { zone: 1, description: "Hot-Dry (South Arizona)" };

  // Warm: Southeast, Gulf Coast, Southern California
  if (prefix >= 350 && prefix <= 369) return { zone: 3, description: "Warm-Humid (Alabama)" };
  if (prefix >= 370 && prefix <= 385) return { zone: 3, description: "Warm-Humid (Tennessee/Mississippi)" };
  if (prefix >= 700 && prefix <= 714) return { zone: 3, description: "Warm-Humid (Louisiana)" };
  if (prefix >= 716 && prefix <= 729) return { zone: 3, description: "Warm-Humid (Arkansas/Oklahoma)" };
  if (prefix >= 750 && prefix <= 779) return { zone: 3, description: "Warm (Texas)" };
  if (prefix >= 290 && prefix <= 299) return { zone: 3, description: "Warm-Humid (South Carolina)" };
  if (prefix >= 300 && prefix <= 319) return { zone: 3, description: "Warm-Humid (Georgia)" };
  if (prefix >= 320 && prefix <= 326) return { zone: 3, description: "Warm-Humid (North Florida)" };
  if (prefix >= 386 && prefix <= 397) return { zone: 3, description: "Warm-Humid (Mississippi)" };
  if (prefix >= 900 && prefix <= 935) return { zone: 3, description: "Warm-Dry (Southern California)" };

  // Cold: Northern states, Alaska, mountain
  if (prefix >= 995 && prefix <= 999) return { zone: 7, description: "Very Cold (Alaska)" };
  if (prefix >= 550 && prefix <= 567) return { zone: 6, description: "Cold (Minnesota)" };
  if (prefix >= 570 && prefix <= 577) return { zone: 6, description: "Cold (South Dakota)" };
  if (prefix >= 580 && prefix <= 588) return { zone: 6, description: "Cold (North Dakota)" };
  if (prefix >= 590 && prefix <= 599) return { zone: 6, description: "Cold (Montana)" };
  if (prefix >= 820 && prefix <= 831) return { zone: 6, description: "Cold (Wyoming)" };

  // Cool: Upper Midwest, Northeast, Mountain
  if (prefix >= 430 && prefix <= 458) return { zone: 5, description: "Cool (Ohio)" };
  if (prefix >= 460 && prefix <= 479) return { zone: 5, description: "Cool (Indiana)" };
  if (prefix >= 480 && prefix <= 499) return { zone: 5, description: "Cool (Michigan)" };
  if (prefix >= 500 && prefix <= 528) return { zone: 5, description: "Cool (Iowa)" };
  if (prefix >= 530 && prefix <= 549) return { zone: 5, description: "Cool (Wisconsin)" };
  if (prefix >= 600 && prefix <= 629) return { zone: 5, description: "Cool (Illinois)" };
  if (prefix >= 680 && prefix <= 693) return { zone: 5, description: "Cool (Nebraska)" };
  if (prefix >= 100 && prefix <= 149) return { zone: 5, description: "Cool (New York)" };
  if (prefix >= 150 && prefix <= 196) return { zone: 5, description: "Cool (Pennsylvania)" };
  if (prefix >= 800 && prefix <= 816) return { zone: 5, description: "Cool (Colorado)" };
  if (prefix >= 832 && prefix <= 838) return { zone: 5, description: "Cool (Idaho)" };
  if (prefix >= 980 && prefix <= 994) return { zone: 5, description: "Cool (Washington)" };
  if (prefix >= 10 && prefix <= 34) return { zone: 5, description: "Cool (Massachusetts/Connecticut)" };
  if (prefix >= 35 && prefix <= 59) return { zone: 6, description: "Cold (Vermont/New Hampshire/Maine)" };
  if (prefix >= 60 && prefix <= 69) return { zone: 5, description: "Cool (Connecticut)" };

  // Mixed: Mid-Atlantic, Central, Pacific NW coast
  if (prefix >= 200 && prefix <= 289) return { zone: 4, description: "Mixed (Mid-Atlantic)" };
  if (prefix >= 400 && prefix <= 427) return { zone: 4, description: "Mixed (Kentucky)" };
  if (prefix >= 630 && prefix <= 658) return { zone: 4, description: "Mixed (Missouri)" };
  if (prefix >= 660 && prefix <= 679) return { zone: 4, description: "Mixed (Kansas)" };
  if (prefix >= 197 && prefix <= 199) return { zone: 4, description: "Mixed (Delaware)" };
  if (prefix >= 840 && prefix <= 847) return { zone: 5, description: "Cool-Dry (Utah)" };
  if (prefix >= 870 && prefix <= 884) return { zone: 4, description: "Mixed-Dry (New Mexico)" };
  if (prefix >= 889 && prefix <= 898) return { zone: 3, description: "Warm-Dry (Nevada)" };
  if (prefix >= 936 && prefix <= 966) return { zone: 4, description: "Mixed (Northern California)" };
  if (prefix >= 970 && prefix <= 979) return { zone: 5, description: "Cool (Oregon)" };

  return { zone: 4, description: "Mixed (default)" };
}

// ── Property categories ──────────────────────────────────────────────
const VALID_CATEGORIES = ["HVAC", "Plumbing", "Electrical", "Roof", "Exterior", "Interior", "Appliances", "Safety", "Pest Control", "Landscaping", "Structural", "Seasonal", "General"];

function normalizeCategory(cat: string): string {
  if (!cat) return "General";
  const lower = cat.toLowerCase().trim();
  const found = VALID_CATEGORIES.find(v => v.toLowerCase() === lower);
  if (found) return found;
  if (lower.includes("hvac") || lower.includes("heating") || lower.includes("cooling") || lower.includes("furnace") || lower.includes("air condition")) return "HVAC";
  if (lower.includes("plumb") || lower.includes("water") || lower.includes("drain") || lower.includes("pipe") || lower.includes("sewer") || lower.includes("septic")) return "Plumbing";
  if (lower.includes("electric") || lower.includes("wiring") || lower.includes("panel") || lower.includes("outlet")) return "Electrical";
  if (lower.includes("roof") || lower.includes("gutter") || lower.includes("shingle")) return "Roof";
  if (lower.includes("exterior") || lower.includes("siding") || lower.includes("paint") || lower.includes("deck") || lower.includes("fence") || lower.includes("driveway")) return "Exterior";
  if (lower.includes("interior") || lower.includes("floor") || lower.includes("wall") || lower.includes("caulk")) return "Interior";
  if (lower.includes("appliance") || lower.includes("dryer") || lower.includes("washer") || lower.includes("refrigerator") || lower.includes("dishwasher") || lower.includes("oven")) return "Appliances";
  if (lower.includes("safety") || lower.includes("smoke") || lower.includes("detector") || lower.includes("fire") || lower.includes("carbon")) return "Safety";
  if (lower.includes("pest") || lower.includes("termite") || lower.includes("rodent") || lower.includes("insect")) return "Pest Control";
  if (lower.includes("landscape") || lower.includes("lawn") || lower.includes("tree") || lower.includes("irrigation") || lower.includes("sprinkler")) return "Landscaping";
  if (lower.includes("structural") || lower.includes("foundation") || lower.includes("basement") || lower.includes("crawl")) return "Structural";
  if (lower.includes("season") || lower.includes("winter") || lower.includes("spring") || lower.includes("fall")) return "Seasonal";
  return "General";
}

function normalizePriority(p: string): string {
  const lower = (p || "").toLowerCase().trim();
  if (lower === "high" || lower === "medium" || lower === "low") return lower;
  return "medium";
}

// ── Interval clamps ──────────────────────────────────────────────────
interface IntervalClamp { match: RegExp[]; max_months?: number; min_months?: number; }

const PROPERTY_CLAMPS: IntervalClamp[] = [
  { match: [/hvac.*filter/i, /air.*filter.*replace/i, /furnace.*filter/i], max_months: 3, min_months: 1 },
  { match: [/hvac.*service/i, /hvac.*tune/i, /furnace.*inspect/i, /ac.*service/i], max_months: 12, min_months: 6 },
  { match: [/gutter.*clean/i], max_months: 12, min_months: 3 },
  { match: [/roof.*inspect/i], max_months: 24, min_months: 12 },
  { match: [/smoke.*detector/i, /carbon.*monoxide/i, /co.*detector/i], max_months: 6, min_months: 3 },
  { match: [/pest.*control/i, /termite/i], max_months: 12, min_months: 3 },
  { match: [/water.*heater.*flush/i, /water.*heater.*drain/i], max_months: 12, min_months: 6 },
  { match: [/dryer.*vent/i], max_months: 12, min_months: 6 },
  { match: [/sump.*pump/i], max_months: 12, min_months: 3 },
  { match: [/septic/i], max_months: 60, min_months: 24 },
  { match: [/chimney/i, /fireplace/i], max_months: 12, min_months: 12 },
  { match: [/exterior.*paint/i], max_months: 84, min_months: 48 },
  { match: [/caulk/i, /weather.*strip/i, /seal/i], max_months: 24, min_months: 6 },
  { match: [/irrigation/i, /sprinkler.*system/i], max_months: 12, min_months: 6 },
  { match: [/foundation/i], max_months: 60, min_months: 12 },
  { match: [/electrical.*panel/i, /electrical.*inspect/i], max_months: 60, min_months: 24 },
  { match: [/fire.*extinguisher/i], max_months: 12, min_months: 12 },
];

// ── Required tasks ───────────────────────────────────────────────────
interface RequiredTask {
  match: RegExp[];
  task: string;
  description: string;
  category: string;
  interval_months: number;
  estimated_cost_low: number;
  estimated_cost_high: number;
  priority: string;
  condition?: (ctx: { propertyType: string; yearBuilt: number | null; climateZone: number }) => boolean;
}

const REQUIRED_TASKS: RequiredTask[] = [
  { match: [/hvac.*filter/i, /air.*filter.*replace/i, /furnace.*filter/i], task: "HVAC Filter Replacement", description: "Replace HVAC air filters every 1-3 months depending on filter type, pets, and allergies.", category: "HVAC", interval_months: 3, estimated_cost_low: 15, estimated_cost_high: 40, priority: "high" },
  { match: [/smoke.*detector/i, /carbon.*monoxide/i, /co.*detector/i, /smoke.*co/i], task: "Test Smoke & CO Detectors", description: "Test all smoke and carbon monoxide detectors. Replace batteries annually.", category: "Safety", interval_months: 6, estimated_cost_low: 0, estimated_cost_high: 25, priority: "high" },
  { match: [/gutter/i], task: "Clean Gutters & Downspouts", description: "Remove debris from gutters and flush downspouts.", category: "Roof", interval_months: 6, estimated_cost_low: 100, estimated_cost_high: 250, priority: "medium", condition: (ctx) => ctx.propertyType !== "condo" && ctx.propertyType !== "apartment" },
  { match: [/hvac.*service/i, /hvac.*tune/i, /furnace.*inspect/i], task: "HVAC Professional Service", description: "Annual professional HVAC inspection, cleaning, and tune-up.", category: "HVAC", interval_months: 12, estimated_cost_low: 100, estimated_cost_high: 250, priority: "high" },
];

interface ValidatedTask {
  task: string;
  description: string;
  category: string;
  interval_months: number;
  estimated_cost_low: number;
  estimated_cost_high: number;
  priority: string;
}

function clampTask(t: ValidatedTask): ValidatedTask {
  for (const c of PROPERTY_CLAMPS) {
    if (c.match.some(re => re.test(t.task))) {
      let mo = t.interval_months;
      if (c.max_months !== undefined && mo > c.max_months) mo = c.max_months;
      if (c.min_months !== undefined && mo < c.min_months) mo = c.min_months;
      return { ...t, interval_months: mo };
    }
  }
  return t;
}

function validateAndEnforce(tasks: ValidatedTask[], ctx: { propertyType: string; yearBuilt: number | null; climateZone: number }): ValidatedTask[] {
  let v = tasks.map(t => ({
    ...clampTask(t),
    category: normalizeCategory(t.category),
    priority: normalizePriority(t.priority),
  }));
  v = v.filter(t => t.task.trim() !== "" && t.interval_months > 0);

  for (const req of REQUIRED_TASKS) {
    if (req.condition && !req.condition(ctx)) continue;
    if (!v.some(t => req.match.some(re => re.test(t.task)))) {
      v.push({
        task: req.task, description: req.description, category: normalizeCategory(req.category),
        interval_months: req.interval_months, estimated_cost_low: req.estimated_cost_low,
        estimated_cost_high: req.estimated_cost_high, priority: normalizePriority(req.priority),
      });
    }
  }

  const seen = new Set<string>();
  v = v.filter(t => { const k = t.task.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });

  if (v.length > 20) {
    const scored = v.map((t, i) => ({
      idx: i,
      score: (t.priority === "high" ? 3 : t.priority === "medium" ? 2 : 1)
        + (REQUIRED_TASKS.some(req => req.match.some(re => re.test(t.task))) ? 10 : 0),
    }));
    scored.sort((a, b) => a.score - b.score);
    const removeIdxs = new Set(scored.slice(0, v.length - 20).map(s => s.idx));
    v = v.filter((_, i) => !removeIdxs.has(i));
  }

  return v;
}

// ── Interval helper ──────────────────────────────────────────────────
function intervalToString(months: number): string {
  if (months <= 1) return "Monthly";
  if (months <= 3) return "3_months";
  if (months <= 6) return "6_months";
  if (months <= 12) return "12_months";
  if (months <= 24) return "24_months";
  if (months <= 36) return "36_months";
  return "60_months";
}

// ── Template fallback ────────────────────────────────────────────────
function getTemplateTasks(propType: string, yearBuilt: number | null, climateZone: number): ValidatedTask[] {
  const isOld = yearBuilt !== null && yearBuilt < 1980;
  const isFreezeZone = climateZone >= 5;

  const houseTasks: ValidatedTask[] = [
    { task: "HVAC Filter Replacement", description: "Replace HVAC air filters every 1-3 months.", category: "HVAC", interval_months: 3, estimated_cost_low: 15, estimated_cost_high: 40, priority: "high" },
    { task: "HVAC Professional Service", description: "Annual professional inspection and tune-up.", category: "HVAC", interval_months: 12, estimated_cost_low: 100, estimated_cost_high: 250, priority: "high" },
    { task: "Clean Gutters & Downspouts", description: "Remove debris from gutters, flush downspouts.", category: "Roof", interval_months: 6, estimated_cost_low: 100, estimated_cost_high: 250, priority: "medium" },
    { task: "Roof Inspection", description: "Visual inspection for damage, missing shingles, flashing.", category: "Roof", interval_months: 12, estimated_cost_low: 150, estimated_cost_high: 350, priority: "medium" },
    { task: "Test Smoke & CO Detectors", description: "Test all detectors, replace batteries.", category: "Safety", interval_months: 6, estimated_cost_low: 0, estimated_cost_high: 25, priority: "high" },
    { task: "Pest Control Inspection", description: "Professional pest inspection.", category: "Pest Control", interval_months: 12, estimated_cost_low: 75, estimated_cost_high: 200, priority: "medium" },
    { task: "Water Heater Flush", description: "Drain and flush to remove sediment.", category: "Plumbing", interval_months: 12, estimated_cost_low: 50, estimated_cost_high: 150, priority: "medium" },
    { task: "Dryer Vent Cleaning", description: "Clean dryer exhaust vent to prevent fire risk.", category: "Appliances", interval_months: 12, estimated_cost_low: 75, estimated_cost_high: 150, priority: "high" },
  ];

  const condoTasks: ValidatedTask[] = [
    { task: "HVAC Filter Replacement", description: "Replace HVAC air filters.", category: "HVAC", interval_months: 3, estimated_cost_low: 15, estimated_cost_high: 40, priority: "high" },
    { task: "Test Smoke & CO Detectors", description: "Test all detectors, replace batteries.", category: "Safety", interval_months: 6, estimated_cost_low: 0, estimated_cost_high: 25, priority: "high" },
    { task: "Dryer Vent Cleaning", description: "Clean dryer exhaust vent.", category: "Appliances", interval_months: 12, estimated_cost_low: 75, estimated_cost_high: 150, priority: "high" },
    { task: "Water Filter Replacement", description: "Replace under-sink or whole-unit water filter.", category: "Plumbing", interval_months: 6, estimated_cost_low: 20, estimated_cost_high: 60, priority: "medium" },
    { task: "Check Caulk & Weatherstripping", description: "Inspect and replace caulk in bathrooms, kitchen, windows.", category: "Interior", interval_months: 12, estimated_cost_low: 0, estimated_cost_high: 50, priority: "low" },
  ];

  const commercialTasks: ValidatedTask[] = [
    { task: "HVAC Filter Replacement", description: "Replace commercial HVAC filters.", category: "HVAC", interval_months: 3, estimated_cost_low: 30, estimated_cost_high: 75, priority: "high" },
    { task: "HVAC Professional Service", description: "Annual commercial HVAC inspection and service.", category: "HVAC", interval_months: 12, estimated_cost_low: 200, estimated_cost_high: 500, priority: "high" },
    { task: "Fire Extinguisher Inspection", description: "Inspect and certify all fire extinguishers.", category: "Safety", interval_months: 12, estimated_cost_low: 30, estimated_cost_high: 75, priority: "high" },
    { task: "Roof Inspection", description: "Professional commercial roof inspection.", category: "Roof", interval_months: 12, estimated_cost_low: 200, estimated_cost_high: 400, priority: "medium" },
    { task: "Pest Control", description: "Commercial pest control service.", category: "Pest Control", interval_months: 3, estimated_cost_low: 100, estimated_cost_high: 250, priority: "medium" },
  ];

  const vacationTasks: ValidatedTask[] = [
    { task: "Seasonal Opening Inspection", description: "Full property inspection at start of season.", category: "General", interval_months: 12, estimated_cost_low: 50, estimated_cost_high: 150, priority: "high" },
    { task: "Test Smoke & CO Detectors", description: "Test all detectors, replace batteries.", category: "Safety", interval_months: 6, estimated_cost_low: 0, estimated_cost_high: 25, priority: "high" },
    { task: "Pest Control Inspection", description: "Inspect for pest activity during vacancy.", category: "Pest Control", interval_months: 12, estimated_cost_low: 75, estimated_cost_high: 200, priority: "medium" },
    { task: "HVAC Filter Replacement", description: "Replace HVAC air filters.", category: "HVAC", interval_months: 6, estimated_cost_low: 15, estimated_cost_high: 40, priority: "medium" },
    { task: "Clean Gutters & Downspouts", description: "Remove debris from gutters.", category: "Roof", interval_months: 12, estimated_cost_low: 100, estimated_cost_high: 250, priority: "medium" },
  ];

  const oldHomeTasks: ValidatedTask[] = [
    { task: "Plumbing System Inspection", description: "Professional inspection of pipes, joints, and fixtures.", category: "Plumbing", interval_months: 24, estimated_cost_low: 150, estimated_cost_high: 350, priority: "high" },
    { task: "Electrical Panel Inspection", description: "Professional inspection of wiring and panel.", category: "Electrical", interval_months: 24, estimated_cost_low: 150, estimated_cost_high: 350, priority: "high" },
    { task: "Foundation Inspection", description: "Check for cracks, settling, moisture intrusion.", category: "Structural", interval_months: 36, estimated_cost_low: 200, estimated_cost_high: 500, priority: "medium" },
  ];

  const freezeTasks: ValidatedTask[] = [
    { task: "Winterize Exterior Faucets", description: "Disconnect hoses, insulate outdoor faucets before first freeze.", category: "Seasonal", interval_months: 12, estimated_cost_low: 0, estimated_cost_high: 30, priority: "high" },
    { task: "Inspect Pipe Insulation", description: "Check insulation on exposed pipes in basement, crawlspace, garage.", category: "Plumbing", interval_months: 12, estimated_cost_low: 0, estimated_cost_high: 50, priority: "medium" },
  ];

  let base: ValidatedTask[];
  switch (propType) {
    case "condo": case "apartment": case "townhouse": base = condoTasks; break;
    case "commercial": base = commercialTasks; break;
    case "vacation": base = vacationTasks; break;
    default: base = houseTasks;
  }

  if (isOld && (propType === "house" || propType === "townhouse")) {
    base = [...base, ...oldHomeTasks];
  }
  if (isFreezeZone && propType !== "condo" && propType !== "apartment") {
    base = [...base, ...freezeTasks];
  }

  return base;
}

// ── Main handler ─────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // Auth
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const jwt = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);
    const authUserId = user.id;

    // Parse body
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const { property_id, property_type, year_built, square_footage, zip_code } = body;
    if (!property_id || typeof property_id !== "string") return json({ error: "Missing property_id" }, 400);

    const propType = typeof property_type === "string" ? property_type : "house";
    const yearBuilt = typeof year_built === "number" ? year_built : null;
    const sqft = typeof square_footage === "number" ? square_footage : null;
    const zip = typeof zip_code === "string" ? zip_code : "";

    // Verify ownership
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: property } = await adminClient
      .from("properties").select("id").eq("id", property_id).eq("user_id", authUserId).maybeSingle();
    if (!property) return json({ error: "Property not found or not owned by user" }, 403);

    // Check existing tasks
    const { count: existingCount } = await adminClient
      .from("property_maintenance_tasks").select("id", { count: "exact", head: true }).eq("property_id", property_id);
    if ((existingCount ?? 0) > 0) return json({ error: "Schedule already exists" }, 409);

    // Climate + cache
    const climate = getClimateZone(zip);
    const today = new Date();
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const cacheKey = `prop|${propType}|${yearBuilt ?? "unknown"}|${sqft ?? "unknown"}|${climate.zone}`.toLowerCase();

    // Property description for AI prompt
    const ageDesc = yearBuilt
      ? yearBuilt < 1960 ? "pre-1960 (older electrical, plumbing, potential lead paint/asbestos)"
        : yearBuilt < 1980 ? "1960s-70s (may have aluminum wiring, older plumbing, original HVAC)"
        : yearBuilt < 2000 ? "1980s-90s (may have polybutylene pipes, aging HVAC and roof)"
        : yearBuilt < 2015 ? "2000s-2010s (modern systems, standard maintenance)"
        : "2015+ (newer build, builder warranty may apply)"
      : "unknown age";
    const sqftDesc = sqft ? `${sqft.toLocaleString()} sqft` : "unknown size";
    const typeLabels: Record<string, string> = {
      house: "Single family home", condo: "Condominium", apartment: "Apartment",
      townhouse: "Townhouse", commercial: "Commercial building", vacation: "Vacation home", other: "Residential property",
    };
    const propertyDesc = `${typeLabels[propType] ?? "Residential property"}, ${ageDesc}, ${sqftDesc}`;

    // Try cache
    const { data: cached } = await adminClient.from("ai_schedule_cache").select("tasks_json").eq("cache_key", cacheKey).maybeSingle();
    let validatedTasks: ValidatedTask[] | null = null;
    let usedAi = false;

    if (cached?.tasks_json) {
      try { validatedTasks = JSON.parse(cached.tasks_json); console.log(`[CACHE HIT] ${cacheKey}`); } catch { console.warn("[CACHE] Parse failed"); }
    }

    // AI generation
    if (!validatedTasks && anthropicKey) {
      const claudeModel = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-20250514";
      const currentMonth = today.toLocaleString("en-US", { month: "long" });
      const currentYear = today.getFullYear();

      const prompt = `You are an expert home maintenance advisor. Generate a realistic, trustworthy maintenance schedule for this specific property.

Property: ${propertyDesc}
Climate zone: ${climate.description} (IECC zone ${climate.zone})
Location: ${zip ? `ZIP ${zip}` : "United States"}
Current date: ${currentMonth} ${currentYear}

Important context:
- Generate tasks the homeowner should actually track and maintain
- SEASONAL ANCHORING: Set each task's interval_months so the FIRST due date lands in the right season. For example, if it is March and gutter cleaning should happen in November, use interval_months: 8 (not 6). If winterizing faucets should happen in October and it is March, use interval_months: 7. Roof inspections in spring, HVAC tune-ups before heating/cooling season, etc. The interval_months you return will be used to calculate the first due date from today — make it land in the correct month.
- Adjust intervals for the climate zone: freeze zones need winterization, pipe protection, ice dam prevention; humid zones need mold/moisture checks; hot-dry zones need different cooling and exterior cadences
- Adjust for property age: older homes need more frequent structural, plumbing, and electrical inspections
- For condos/apartments: skip tasks the HOA/building handles (roof, exterior, gutters, landscaping). Focus on unit-interior tasks.
- For commercial: include fire safety, ADA compliance checks, commercial HVAC, and higher-frequency pest control
- For vacation homes: include seasonal opening/closing and vacancy-related tasks
- Cost estimates should reflect regional pricing for this climate zone and area
- Include BOTH a low and high cost estimate for each task

Output rules:
- Generate 10-16 tasks. Quality over quantity.
- interval_months must be a positive integer (the interval, not absolute date)
- estimated_cost_low and estimated_cost_high must be numbers in USD. Use 0 for free DIY tasks.
- Do NOT generate duplicate or near-duplicate tasks
- Priorities: high = safety, HVAC, water damage prevention; medium = routine maintenance; low = cosmetic
- Descriptions should include practical advice and interval guidance
- For recurring tasks, mention which season or month is ideal (e.g., "Best done in late fall before freeze season")

Respond ONLY with a valid JSON array, no markdown, no backticks:
[
  {
    "task": "Task Name",
    "description": "Practical description",
    "category": "HVAC|Plumbing|Electrical|Roof|Exterior|Interior|Appliances|Safety|Pest Control|Landscaping|Structural|Seasonal|General",
    "interval_months": <positive integer>,
    "estimated_cost_low": <number>,
    "estimated_cost_high": <number>,
    "priority": "high"|"medium"|"low"
  }
]`;

      try {
        const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: claudeModel, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const aiText = aiData.content?.[0]?.text ?? "";
          let aiTasks: any[];
          try { aiTasks = JSON.parse(aiText); } catch {
            const m = aiText.match(/\[[\s\S]*\]/);
            if (m) aiTasks = JSON.parse(m[0]); else throw new Error("Could not parse AI response");
          }

          if (Array.isArray(aiTasks) && aiTasks.length >= 5) {
            const parsed: ValidatedTask[] = aiTasks
              .filter(t => typeof t.task === "string" && t.task.trim())
              .map(t => ({
                task: t.task.trim(),
                description: typeof t.description === "string" ? t.description : "",
                category: typeof t.category === "string" ? t.category : "General",
                interval_months: typeof t.interval_months === "number" && t.interval_months > 0 ? Math.round(t.interval_months) : 12,
                estimated_cost_low: typeof t.estimated_cost_low === "number" ? Math.round(t.estimated_cost_low) : 0,
                estimated_cost_high: typeof t.estimated_cost_high === "number" ? Math.round(t.estimated_cost_high) : 0,
                priority: typeof t.priority === "string" ? t.priority : "medium",
              }));

            validatedTasks = validateAndEnforce(parsed, { propertyType: propType, yearBuilt, climateZone: climate.zone });
            usedAi = true;

            if (validatedTasks.length >= 5) {
              await adminClient.from("ai_schedule_cache").upsert({
                cache_key: cacheKey,
                vehicle_desc: propertyDesc,
                vehicle_category: `property_${propType}`,
                fuel_type: `climate_${climate.zone}`,
                tasks_json: JSON.stringify(validatedTasks),
                task_count: validatedTasks.length,
              }, { onConflict: "cache_key" });
            }
          }
        } else {
          console.error("[AI] Claude API error:", aiResponse.status);
        }
      } catch (aiErr) {
        console.error("[AI] Error, falling through to templates:", aiErr instanceof Error ? aiErr.message : aiErr);
      }
    }

    // Fallback
    if (!validatedTasks || validatedTasks.length < 5) {
      console.warn("[FALLBACK] Using template tasks for", propertyDesc);
      validatedTasks = getTemplateTasks(propType, yearBuilt, climate.zone);
      usedAi = false;
    }

    // Insert tasks — NOTE: do NOT include `priority` in the insert since the
    // property_maintenance_tasks table may not have that column in all environments.
    // The priority is used for AI validation/sorting only.
    const tasksToInsert = validatedTasks.map(t => ({
      user_id: authUserId,
      property_id,
      task: t.task,
      description: t.description,
      category: t.category,
      interval: intervalToString(t.interval_months),
      estimated_cost: Math.round((t.estimated_cost_low + t.estimated_cost_high) / 2),
      next_due_date: addMonths(today, t.interval_months).toISOString().split("T")[0],
      is_completed: false,
      created_at: today.toISOString(),
      updated_at: today.toISOString(),
    }));

    const { error: insertError } = await adminClient.from("property_maintenance_tasks").insert(tasksToInsert);
    if (insertError) return json({ error: "Failed to insert tasks", detail: insertError.message }, 500);

    console.log(`[SUCCESS] ${tasksToInsert.length} property tasks for ${propertyDesc} (source: ${usedAi ? "ai" : "template"})`);
    return json({ success: true, tasks_created: tasksToInsert.length, property_id, source: usedAi ? "ai" : "template" });

  } catch (err) {
    console.error("[ERROR]", err);
    return json({ error: "Failed to generate schedule", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});
