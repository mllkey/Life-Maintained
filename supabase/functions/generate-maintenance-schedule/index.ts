/*
 * generate-maintenance-schedule — Supabase Edge Function
 *
 * Generates a personalized maintenance schedule for a vehicle immediately
 * after it is added by the user.
 *
 * Example curl:
 *   curl -X POST https://fqblqrrgjpwysrsiolcn.supabase.co/functions/v1/generate-maintenance-schedule \
 *     -H "Authorization: Bearer <user-jwt>" \
 *     -H "Content-Type: application/json" \
 *     -d '{
 *           "vehicle_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
 *           "make": "Toyota",
 *           "year": 2020,
 *           "current_mileage": 45000,
 *           "vehicle_type": "gas",
 *           "is_awd": false
 *         }'
 */

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ── 1. Parse & validate request body ──────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const {
      vehicle_id,
      make,
      model,
      year,
      current_mileage,
      current_hours,
      vehicle_type,
      fuel_type,
      is_awd,
      vehicle_category,
      tracking_mode: reqTrackingMode,
    } = body;

    if (!vehicle_id || typeof vehicle_id !== "string") {
      return json({ error: "Missing or invalid required field: vehicle_id (string)" }, 400);
    }
    if (!make || typeof make !== "string") {
      return json({ error: "Missing or invalid required field: make (string)" }, 400);
    }
    if (year === undefined || year === null || typeof year !== "number" || !Number.isInteger(year)) {
      return json({ error: "Missing or invalid required field: year (integer)" }, 400);
    }

    const vehicleModel = typeof model === "string" ? model : "";
    const vehicleCategory = typeof vehicle_category === "string" ? vehicle_category : "car";

    // Resolve tracking mode: explicit from request > infer from vehicle category
    const HOURS_TYPES = new Set(["boat", "pwc", "lawnmower", "lawn_mower", "chainsaw", "generator", "excavator", "skid_steer", "mini_excavator", "compact_track_loader", "backhoe", "wheel_loader", "telehandler", "forklift", "snow_blower", "pressure_washer", "wood_chipper", "stump_grinder", "concrete_saw", "welder"]);
    const TIME_ONLY_TYPES = new Set(["trailer", "dump_trailer", "dumpster"]);

    function resolveTrackingMode(explicit: unknown, category: string): "mileage" | "hours" | "both" | "time_only" {
      if (explicit === "mileage" || explicit === "hours" || explicit === "both" || explicit === "time_only") return explicit;
      if (HOURS_TYPES.has(category)) return "hours";
      if (TIME_ONLY_TYPES.has(category)) return "time_only";
      return "mileage";
    }

    const explicitTracking = typeof reqTrackingMode === "string" ? reqTrackingMode.toLowerCase().trim() : reqTrackingMode;
    const trackingMode = resolveTrackingMode(explicitTracking, vehicleCategory);

    // Tracking mode behavior in this version:
    // - "mileage": full mileage support (interval_miles, next_due_miles)
    // - "hours": full hours support (interval_hours, next_due_hours)
    // - "both": treated as hours-primary — generates hours intervals, nulls mileage fields
    //           Full dual-meter support (writing both miles and hours) is deferred.
    // - "time_only": date-based intervals only, no usage tracking
    const isHoursMode = trackingMode === "hours" || trackingMode === "both";
    const isMileageMode = trackingMode === "mileage";
    const isTimeOnlyMode = trackingMode === "time_only";

    const resolvedCurrentMileage = typeof current_mileage === "number" ? current_mileage : 0;

    let resolvedCurrentHours = 0;
    if (isHoursMode) {
      if (typeof current_hours === "number" && Number.isFinite(current_hours)) {
        resolvedCurrentHours = current_hours;
      } else if (current_hours === undefined || current_hours === null) {
        resolvedCurrentHours = 0;
      } else {
        return json({ error: "Invalid current_hours — must be a finite number, or omit for a new asset with no hour reading yet" }, 400);
      }
    } else {
      resolvedCurrentHours = typeof current_hours === "number" && Number.isFinite(current_hours) ? current_hours : 0;
    }

    // Validate: mileage assets need mileage
    if (isMileageMode && (current_mileage === undefined || current_mileage === null || typeof current_mileage !== "number")) {
      return json({ error: "Missing or invalid required field: current_mileage (number)" }, 400);
    }

    // `vehicle_type` historically carries the fuel type in this project; `fuel_type` is supported as well.
    const resolvedVehicleType = typeof fuel_type === "string"
      ? fuel_type
      : (typeof vehicle_type === "string" ? vehicle_type : "gas");
    const resolvedIsAwd = typeof is_awd === "boolean" ? is_awd : false;

    // ── Preload mode: skip auth/ownership/insert, just cache ────────────
    const isPreload = typeof vehicle_id === "string" && vehicle_id.startsWith("preload-");

    // ── Category exclusion map ─────────────────────────────────────────────
    const CATEGORY_EXCLUSIONS: Record<string, string[]> = {
      motorcycle: [
        "Tire Rotation",
        "Cabin Air Filter",
        "Wiper Blade Replacement",
        "Serpentine Belt Replacement",
        "Transmission Fluid (Automatic)",
        "PCV Valve Replacement",
        "Timing Belt Replacement",
        "Multi-Point Inspection",
        "Transmission Fluid (Hybrid/CVT)",
      ],
      boat: [
        "Tire Rotation",
        "Brake Pad Inspection",
        "Brake Fluid Flush",
        "Cabin Air Filter",
        "Engine Air Filter",
        "Wiper Blade Replacement",
        "Serpentine Belt Replacement",
        "Transmission Fluid (Automatic)",
        "PCV Valve Replacement",
        "Timing Belt Replacement",
        "Multi-Point Inspection",
        "Spark Plug Replacement",
        "Transmission Fluid (Hybrid/CVT)",
        "Transfer Case Fluid",
        "Front Differential Fluid",
        "Rear Differential Fluid",
      ],
      pwc: [
        "Tire Rotation",
        "Brake Pad Inspection",
        "Brake Fluid Flush",
        "Cabin Air Filter",
        "Engine Air Filter",
        "Wiper Blade Replacement",
        "Serpentine Belt Replacement",
        "Transmission Fluid (Automatic)",
        "PCV Valve Replacement",
        "Timing Belt Replacement",
        "Multi-Point Inspection",
        "Transmission Fluid (Hybrid/CVT)",
        "Transfer Case Fluid",
        "Front Differential Fluid",
        "Rear Differential Fluid",
      ],
      snowmobile: [
        "Tire Rotation",
        "Brake Fluid Flush",
        "Cabin Air Filter",
        "Wiper Blade Replacement",
        "Serpentine Belt Replacement",
        "Transmission Fluid (Automatic)",
        "PCV Valve Replacement",
        "Timing Belt Replacement",
        "Multi-Point Inspection",
        "Transmission Fluid (Hybrid/CVT)",
      ],
      atv: [
        "Tire Rotation",
        "Cabin Air Filter",
        "Wiper Blade Replacement",
        "Serpentine Belt Replacement",
        "Transmission Fluid (Automatic)",
        "PCV Valve Replacement",
        "Timing Belt Replacement",
        "Multi-Point Inspection",
        "Transmission Fluid (Hybrid/CVT)",
      ],
      utv: [
        "Cabin Air Filter",
        "Wiper Blade Replacement",
        "Serpentine Belt Replacement",
        "PCV Valve Replacement",
        "Timing Belt Replacement",
        "Transmission Fluid (Hybrid/CVT)",
      ],
      rv: [],
    };

    // ── 2. Authenticate user from JWT (skipped in preload mode) ───────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    let authUserId = "preload";
    if (!isPreload) {
      const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.error("[AUTH] Missing or invalid Authorization header");
        return json({ error: "Missing or invalid Authorization header" }, 401);
      }
      const jwt = authHeader.replace("Bearer ", "").trim();

      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });

      const { data: { user }, error: authError } = await userClient.auth.getUser();

      if (authError || !user) {
        console.error("[AUTH] Auth failed — authError:", authError?.message, "user:", user?.id);
        return json({ error: "Unauthorized: invalid or expired token" }, 401);
      }
      authUserId = user.id;
    }

    // ── 3. Verify vehicle ownership ────────────────────────────────────────
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    if (!isPreload) {
      const { data: vehicle, error: vehicleError } = await adminClient
        .from("vehicles")
        .select("id")
        .eq("id", vehicle_id)
        .eq("user_id", authUserId)
        .maybeSingle();

      if (vehicleError) {
        console.error("Vehicle lookup error:", vehicleError);
        return json({ error: "Failed to verify vehicle ownership", detail: vehicleError.message }, 500);
      }
      if (!vehicle) {
        return json({ error: "Forbidden: vehicle not found or does not belong to this user" }, 403);
      }
    }

    // ── 4. Check for existing tasks (prevent duplicate schedules) ──────────
    if (!isPreload) {
      const { count: existingCount, error: countError } = await adminClient
        .from("user_vehicle_maintenance_tasks")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicle_id);

      if (countError) {
        console.error("Count query error:", countError);
        return json({ error: "Failed to check existing tasks", detail: countError.message }, 500);
      }
      if ((existingCount ?? 0) > 0) {
        return json(
          { error: "Maintenance schedule already exists for this vehicle. Delete existing tasks first to regenerate." },
          409,
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // AI-POWERED SCHEDULE GENERATION (with cache + hard validation)
    // Falls through to template fallback below if anything fails.
    // ═══════════════════════════════════════════════════════════════════════

    const today = new Date();
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const vehicleDesc = `${year} ${make} ${vehicleModel}`.trim();
    const cacheKey = `${year}|${make}|${vehicleModel}|${vehicleCategory}|${resolvedVehicleType}|${trackingMode}`.toLowerCase().trim();

    interface ValidatedTask {
      task: string;
      description: string;
      category: string;
      interval_miles: number | null;
      interval_hours: number | null;
      interval_months: number | null;
      priority: string;
    }
    interface IntervalClamp {
      match: RegExp[];
      max_months?: number;
      min_months?: number;
      max_miles?: number;
      min_miles?: number;
      max_hours?: number;
      min_hours?: number;
    }
    interface RequiredTask {
      match: RegExp[];
      task: string;
      description: string;
      category: string;
      interval_miles: number | null;
      interval_hours: number | null;
      interval_months: number;
      priority: string;
    }

    const VALID_CATEGORIES = ["Engine", "Drivetrain", "Brakes", "Fluids", "Electrical", "Safety", "Suspension", "Body", "Controls", "Cooling", "Tires", "Seasonal", "General"];
    function normalizeCategory(cat: string): string {
      if (!cat) return "General";
      const lower = cat.toLowerCase().trim();
      const found = VALID_CATEGORIES.find(v => v.toLowerCase() === lower);
      if (found) return found;
      if (lower.includes("brake")) return "Brakes";
      if (lower.includes("engine") || lower.includes("motor")) return "Engine";
      if (lower.includes("tire") || lower.includes("wheel")) return "Tires";
      if (lower.includes("fluid")) return "Fluids";
      if (lower.includes("electric") || lower.includes("battery") || lower.includes("light")) return "Electrical";
      if (lower.includes("suspension") || lower.includes("fork") || lower.includes("shock")) return "Suspension";
      if (lower.includes("drive") || lower.includes("chain") || lower.includes("transmission") || lower.includes("clutch")) return "Drivetrain";
      if (lower.includes("cool") || lower.includes("radiator")) return "Cooling";
      if (lower.includes("control") || lower.includes("cable") || lower.includes("throttle")) return "Controls";
      if (lower.includes("body") || lower.includes("paint") || lower.includes("wash")) return "Body";
      if (lower.includes("safety") || lower.includes("inspect")) return "Safety";
      if (lower.includes("season") || lower.includes("winter") || lower.includes("storage")) return "Seasonal";
      return "General";
    }
    function normalizePriority(p: string): string {
      const lower = (p || "").toLowerCase().trim();
      if (lower === "high" || lower === "medium" || lower === "low") return lower;
      return "medium";
    }

    const MOTORCYCLE_CLAMPS: IntervalClamp[] = [
      { match: [/brake.*fluid/i], max_months: 24, max_miles: 20000 },
      { match: [/coolant/i], max_months: 36, max_miles: 30000 },
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 12, max_miles: 5000, min_miles: 2000 },
      { match: [/chain.*clean/i, /chain.*lube/i, /chain.*lubrication/i, /chain maintenance/i], max_months: 2, max_miles: 600, min_miles: 200 },
      { match: [/chain.*adjust/i, /chain.*tension/i], max_months: 6, max_miles: 5000, min_miles: 1000 },
      { match: [/valve.*check/i, /valve.*clearance/i, /valve.*adjust/i, /valve.*inspection/i], max_months: 18, max_miles: 10000, min_miles: 3000 },
      { match: [/tire.*inspect/i, /tire.*check/i, /tire.*wear/i, /tire.*pressure/i], max_months: 6, max_miles: 5000 },
      { match: [/brake.*pad/i, /brake.*inspection/i], max_months: 12, max_miles: 15000 },
      { match: [/spark plug/i], max_months: 24, max_miles: 20000 },
      { match: [/air filter/i], max_months: 12, max_miles: 15000 },
      { match: [/fork.*oil/i, /fork.*seal/i], max_months: 24, max_miles: 20000 },
    ];
    const CAR_TRUCK_CLAMPS: IntervalClamp[] = [
      { match: [/brake.*fluid/i], max_months: 36, max_miles: 45000 },
      { match: [/coolant/i], max_months: 60, max_miles: 100000 },
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 12, max_miles: 10000, min_miles: 3000 },
      { match: [/transmission.*fluid/i], max_months: 60, max_miles: 60000 },
      { match: [/brake.*pad/i, /brake.*inspection/i], max_months: 18, max_miles: 30000 },
      { match: [/tire.*rotation/i], max_months: 12, max_miles: 10000, min_miles: 3000 },
      { match: [/spark plug/i], max_months: 60, max_miles: 100000 },
      { match: [/air filter/i], max_months: 24, max_miles: 30000 },
      { match: [/cabin.*air.*filter/i], max_months: 18, max_miles: 20000 },
      { match: [/wiper.*blade/i], max_months: 12 },
    ];
    const BOAT_PWC_CLAMPS: IntervalClamp[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 12, max_hours: 100 },
      { match: [/impeller/i], max_months: 24, max_hours: 300 },
      { match: [/anode/i, /zinc/i], max_months: 12, max_hours: 200 },
      { match: [/lower unit/i, /gear.*oil/i, /gear.*lube/i], max_months: 12, max_hours: 200 },
      { match: [/winteriz/i], max_months: 12 },
      { match: [/spark plug/i], max_months: 12, max_hours: 200 },
      { match: [/fuel.*filter/i, /fuel.*water.*separator/i], max_months: 12, max_hours: 200 },
    ];

    const SMALL_EQUIPMENT_CLAMPS: IntervalClamp[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 12, max_hours: 50, min_hours: 20 },
      { match: [/air filter/i], max_months: 12, max_hours: 100, min_hours: 25 },
      { match: [/spark plug/i], max_months: 24, max_hours: 200 },
      { match: [/fuel.*filter/i, /fuel.*system/i], max_months: 12, max_hours: 100 },
      { match: [/blade/i, /cutting/i, /chain.*sharpen/i], max_months: 6, max_hours: 50 },
      { match: [/grease/i, /lubric/i], max_months: 6, max_hours: 50 },
    ];

    const HEAVY_EQUIPMENT_CLAMPS: IntervalClamp[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 6, max_hours: 250, min_hours: 100 },
      { match: [/hydraulic.*filter/i, /hydraulic.*fluid/i, /hydraulic.*service/i], max_months: 12, max_hours: 1000 },
      { match: [/air filter/i], max_months: 6, max_hours: 500 },
      { match: [/fuel.*filter/i], max_months: 6, max_hours: 500 },
      { match: [/coolant/i], max_months: 24, max_hours: 3000 },
      { match: [/transmission.*fluid/i, /transmission.*filter/i], max_months: 12, max_hours: 1000 },
      { match: [/grease/i, /lubric/i], max_months: 1, max_hours: 50, min_hours: 8 },
      { match: [/track.*tension/i, /track.*inspect/i, /undercarriage/i], max_months: 6, max_hours: 500 },
    ];

    const MOTORCYCLE_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter per manufacturer spec", category: "Engine", interval_miles: 4000, interval_hours: null, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid to maintain stopping performance", category: "Brakes", interval_miles: null, interval_hours: null, interval_months: 24, priority: "high" },
      { match: [/chain.*clean/i, /chain.*lube/i, /chain.*lubrication/i, /chain maintenance/i], task: "Chain Clean & Lube", description: "Clean and lubricate the drive chain", category: "Drivetrain", interval_miles: 400, interval_hours: null, interval_months: 1, priority: "high" },
      { match: [/chain.*adjust/i, /chain.*tension/i], task: "Chain Adjustment", description: "Check and adjust chain tension and alignment", category: "Drivetrain", interval_miles: 3000, interval_hours: null, interval_months: 6, priority: "medium" },
      { match: [/valve.*check/i, /valve.*clearance/i, /valve.*adjust/i, /valve.*inspection/i], task: "Valve Check / Adjustment", description: "Check and adjust valve clearances per manufacturer spec", category: "Engine", interval_miles: 7500, interval_hours: null, interval_months: 12, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads for wear and replace if needed", category: "Brakes", interval_miles: 7500, interval_hours: null, interval_months: 12, priority: "high" },
      { match: [/tire.*inspect/i, /tire.*check/i, /tire.*wear/i, /tire.*pressure/i], task: "Tire Inspection", description: "Inspect tires for wear, damage, and proper pressure", category: "Safety", interval_miles: 3000, interval_hours: null, interval_months: 3, priority: "high" },
    ];
    const CAR_TRUCK_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: 5000, interval_hours: null, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid", category: "Brakes", interval_miles: null, interval_hours: null, interval_months: 30, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads and rotors for wear", category: "Brakes", interval_miles: 20000, interval_hours: null, interval_months: 12, priority: "high" },
      { match: [/tire.*rotation/i], task: "Tire Rotation", description: "Rotate tires for even wear", category: "Tires", interval_miles: 7500, interval_hours: null, interval_months: 6, priority: "medium" },
    ];
    const BOAT_PWC_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: null, interval_hours: 100, interval_months: 12, priority: "high" },
      { match: [/impeller/i], task: "Impeller Inspection / Replacement", description: "Inspect and replace water pump impeller", category: "Cooling", interval_miles: null, interval_hours: 200, interval_months: 12, priority: "high" },
      { match: [/lower unit/i, /gear.*oil/i, /gear.*lube/i], task: "Lower Unit Gear Oil Change", description: "Change lower unit gear oil and check for water intrusion", category: "Drivetrain", interval_miles: null, interval_hours: 100, interval_months: 12, priority: "high" },
      { match: [/winteriz/i], task: "Winterization", description: "Full winterization including fuel stabilizer, fog engine, drain water systems", category: "Seasonal", interval_miles: null, interval_hours: null, interval_months: 12, priority: "high" },
    ];

    const SMALL_EQUIPMENT_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil Change", description: "Change engine oil per manufacturer spec", category: "Engine", interval_miles: null, interval_hours: 25, interval_months: 12, priority: "high" },
      { match: [/air filter/i], task: "Air Filter Service", description: "Clean or replace air filter", category: "Engine", interval_miles: null, interval_hours: 50, interval_months: 12, priority: "medium" },
      { match: [/spark plug/i], task: "Spark Plug Replacement", description: "Replace spark plug per manufacturer interval", category: "Engine", interval_miles: null, interval_hours: 100, interval_months: 24, priority: "medium" },
    ];

    const HEAVY_EQUIPMENT_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: null, interval_hours: 250, interval_months: 6, priority: "high" },
      { match: [/hydraulic/i], task: "Hydraulic System Service", description: "Check hydraulic fluid level, replace filters, inspect for leaks", category: "Fluids", interval_miles: null, interval_hours: 500, interval_months: 12, priority: "high" },
      { match: [/air filter/i], task: "Air Filter Replacement", description: "Replace engine air filter", category: "Engine", interval_miles: null, interval_hours: 250, interval_months: 6, priority: "medium" },
      { match: [/grease/i, /lubric/i], task: "Grease All Fittings", description: "Grease all zerk fittings — pins, bushings, pivots", category: "General", interval_miles: null, interval_hours: 10, interval_months: 1, priority: "high" },
    ];

    // ── Clamp & required task routing by asset category ──────────────────
    // Marine: boat, pwc → tighter hours intervals, impeller/lower unit/winterization
    // Small equipment: lawnmower, chainsaw, generator, etc. → very tight hours (25-200)
    // Heavy equipment: excavator, skid_steer, backhoe, etc. → medium hours (100-1000)
    // Motorcycle/ATV/UTV: mileage-based clamps
    // Car/truck: standard mileage clamps
    const SMALL_EQUIPMENT_CATS = new Set(["lawnmower", "lawn_mower", "chainsaw", "generator", "snow_blower", "pressure_washer", "wood_chipper", "stump_grinder", "concrete_saw", "welder"]);
    const HEAVY_EQUIPMENT_CATS = new Set(["excavator", "skid_steer", "mini_excavator", "compact_track_loader", "backhoe", "wheel_loader", "telehandler", "forklift"]);

    function getClampsForCategory(cat: string): IntervalClamp[] {
      if (cat === "motorcycle" || cat === "atv" || cat === "utv" || cat === "snowmobile") return MOTORCYCLE_CLAMPS;
      if (cat === "boat" || cat === "pwc") return BOAT_PWC_CLAMPS;
      if (SMALL_EQUIPMENT_CATS.has(cat)) return SMALL_EQUIPMENT_CLAMPS;
      if (HEAVY_EQUIPMENT_CATS.has(cat)) return HEAVY_EQUIPMENT_CLAMPS;
      return CAR_TRUCK_CLAMPS;
    }
    function getRequiredForCategory(cat: string): RequiredTask[] {
      if (cat === "motorcycle" || cat === "atv" || cat === "utv" || cat === "snowmobile") return MOTORCYCLE_REQUIRED;
      if (cat === "boat" || cat === "pwc") return BOAT_PWC_REQUIRED;
      if (SMALL_EQUIPMENT_CATS.has(cat)) return SMALL_EQUIPMENT_REQUIRED;
      if (HEAVY_EQUIPMENT_CATS.has(cat)) return HEAVY_EQUIPMENT_REQUIRED;
      return CAR_TRUCK_REQUIRED;
    }
    function clampTask(t: ValidatedTask, clamps: IntervalClamp[]): ValidatedTask {
      for (const c of clamps) {
        if (c.match.some(re => re.test(t.task))) {
          let mi = t.interval_miles;
          let hr = t.interval_hours;
          let mo = t.interval_months;
          if (mi !== null) {
            if (c.max_miles !== undefined && mi > c.max_miles) mi = c.max_miles;
            if (c.min_miles !== undefined && mi < c.min_miles) mi = c.min_miles;
          }
          if (hr !== null) {
            if (c.max_hours !== undefined && hr > c.max_hours) hr = c.max_hours;
            if (c.min_hours !== undefined && hr < c.min_hours) hr = c.min_hours;
          }
          if (mo !== null) {
            if (c.max_months !== undefined && mo > c.max_months) mo = c.max_months;
            if (c.min_months !== undefined && mo < c.min_months) mo = c.min_months;
          }
          return { ...t, interval_miles: mi, interval_hours: hr, interval_months: mo };
        }
      }
      return t;
    }
    function validateAndEnforce(tasks: ValidatedTask[], vCat: string): ValidatedTask[] {
      const clamps = getClampsForCategory(vCat);
      const required = getRequiredForCategory(vCat);
      let v = tasks.map(t => ({ ...clampTask(t, clamps), category: normalizeCategory(t.category), priority: normalizePriority(t.priority) }));
      v = v.filter(t => t.task.trim() !== "" && (t.interval_miles !== null || t.interval_hours !== null || t.interval_months !== null));
      for (const req of required) {
        if (!v.some(t => req.match.some(re => re.test(t.task)))) {
          v.push({ task: req.task, description: req.description, category: normalizeCategory(req.category), interval_miles: req.interval_miles, interval_hours: req.interval_hours, interval_months: req.interval_months, priority: normalizePriority(req.priority) });
        }
      }
      const seen = new Set<string>();
      v = v.filter(t => { const k = t.task.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
      return v;
    }

    let aiSuccess = false;
    try {
      const { data: cached } = await adminClient.from("ai_schedule_cache").select("tasks_json").eq("cache_key", cacheKey).maybeSingle();
      let validatedTasks: ValidatedTask[] | null = null;

      if (cached?.tasks_json) {
        try {
          const raw = JSON.parse(cached.tasks_json) as ValidatedTask[];
          validatedTasks = Array.isArray(raw)
            ? raw.map((t) => ({ ...t, interval_hours: t.interval_hours ?? null, interval_miles: t.interval_miles ?? null }))
            : null;
        } catch { console.warn("[CACHE] Parse failed"); }
      }

      if (!validatedTasks && anthropicKey) {
        const claudeModel = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-20250514";
        const categoryHint = vehicleCategory !== "car" ? ` (category: ${vehicleCategory})` : "";
        const fuelHint = resolvedVehicleType !== "gas" ? ` (fuel type: ${resolvedVehicleType})` : "";
        const awdHint = resolvedIsAwd ? " (AWD/4WD)" : "";

        const isHoursAsset = isHoursMode;
        const usageWord = isHoursAsset ? "engine hours" : "miles";
        const intervalField = isHoursAsset ? "interval_hours" : "interval_miles";
        const currentUsageDesc = isHoursAsset
          ? `Current engine hours: ${resolvedCurrentHours}`
          : `Current mileage: ${resolvedCurrentMileage}`;

        const hoursContext = isHoursAsset ? `
CRITICAL: This is an hours-tracked asset (e.g., marine engine, small engine, heavy equipment).
- All usage-based intervals MUST use engine/runtime hours via the "interval_hours" field
- "interval_miles" MUST be null for every task — this asset does not track mileage
- Engine hours reflect actual runtime — a 100-hour oil change means 100 hours of engine operation
- Marine engines, small engines, and heavy equipment have MUCH tighter service intervals than road vehicles
- Seasonal storage and winterization are critical for marine and outdoor equipment
- Factor in operating environment: marine (salt water, corrosion), dusty conditions, heavy load cycles
- Typical intervals: oil 25-100 hrs, filters 50-250 hrs, major service 200-500 hrs depending on equipment
` : "";

        const prompt = `You are an expert maintenance advisor for vehicles and assets. Generate a realistic, trustworthy maintenance schedule for this specific asset.

Asset: ${vehicleDesc}${categoryHint}${fuelHint}${awdHint}
${currentUsageDesc}
${hoursContext}
Important context:
- Assume prior maintenance history is unknown
- The schedule starts from the asset's current ${usageWord}
- Do NOT assume the asset has never been serviced

Use the following three-tier framework to determine which tasks to include and how to set their intervals. Your final output must still be a single flat JSON array — do NOT nest or group by tier.

TIER 1 — PRIMARY SERVICES
Tasks with distinct manufacturer-specified intervals unique to this asset.
- Each must have its own realistic interval
- Do NOT assign identical intervals to unrelated tasks
- These form the backbone of the maintenance schedule

TIER 2 — GROUPED SERVICES
Tasks that are legitimately performed together during major service milestones for this specific asset.
- Only group tasks that a technician would realistically perform in the same visit
- Do NOT group tasks solely because their intervals happen to align numerically
- Grouping should reflect real service practices, not convenience

TIER 3 — CONDITION-BASED
Wear-dependent items.
- Include inspection intervals where appropriate
- Descriptions must clearly state: "Inspect regularly — replace based on condition"
- Avoid presenting these as fixed scheduled replacements

Rules:
- Be specific to this exact year/make/model — do not use generic averages
- Account for engine type, cooling type, drivetrain type, and asset category
- Each task description must include the recommended interval AND a realistic range
- Do NOT assign identical intervals to unrelated tasks unless they are genuinely part of the same service milestone
- Priorities: high = oil, critical fluids, safety-critical; medium = filters, secondary fluids, inspections; lower = condition-based replacements
- Output should feel like it was written by an experienced technician — practical, realistic, not artificially uniform
- Include BOTH ${usageWord}-based AND time-based intervals for every task (whichever comes first)
- Interval values are the INTERVAL (e.g., every ${isHoursAsset ? "50 hours" : "3000 miles"}), NOT the absolute ${usageWord}
- Be conservative on safety-critical items

Respond ONLY with a valid JSON array, no markdown, no backticks, no explanation. Each item:
[
  {
    "task": "Task Name",
    "description": "Brief practical description including recommended interval range",
    "category": "Engine|Drivetrain|Brakes|Fluids|Electrical|Safety|Suspension|Body|Controls|Cooling|Tires|Seasonal|General",
    "interval_miles": <number or null>,
    "interval_hours": <number or null>,
    "interval_months": <number or null>,
    "priority": "high"|"medium"|"low"
  }
]

Generate 12-16 tasks. Quality over quantity. Every task should be something a knowledgeable owner would actually schedule and track.
Every task MUST have at least one of ${intervalField} or interval_months.`;

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
            if (m) aiTasks = JSON.parse(m[0]); else throw new Error("Could not parse AI JSON");
          }
          if (Array.isArray(aiTasks) && aiTasks.length >= 5) {
            const parsed: ValidatedTask[] = aiTasks.filter(t => typeof t.task === "string" && t.task.trim()).map(t => ({
              task: t.task.trim(),
              description: typeof t.description === "string" ? t.description : "",
              category: typeof t.category === "string" ? t.category : "General",
              interval_miles: isHoursMode ? null : (typeof t.interval_miles === "number" && t.interval_miles > 0 ? t.interval_miles : null),
              interval_hours: isHoursMode ? (typeof t.interval_hours === "number" && t.interval_hours > 0 ? t.interval_hours : null) : null,
              interval_months: typeof t.interval_months === "number" && t.interval_months > 0 ? t.interval_months : null,
              priority: typeof t.priority === "string" ? t.priority : "medium",
            }));
            validatedTasks = validateAndEnforce(parsed, vehicleCategory);

            // ══════════════════════════════════════════════════════════════
            // POST-PROCESSING: Task family dedup, merge, cleanup, trimming
            // ══════════════════════════════════════════════════════════════
            if (validatedTasks && !isHoursMode) {
              const isSmallMoto = (vehicleCategory === "motorcycle" || vehicleCategory === "atv" || vehicleCategory === "utv" || vehicleCategory === "snowmobile");

              interface TaskFamily {
                key: string;
                patterns: RegExp[];
                canonical: string;
                description: string;
                priorityOverride?: string;
                remove?: boolean;
                removeCondition?: () => boolean;
                mergeIntervals?: boolean;
                conditionBased?: boolean;
              }

              const families: TaskFamily[] = [
                { key: "engine_oil", patterns: [/oil.*change/i, /oil.*filter/i, /engine.*oil/i], canonical: "Engine Oil and Filter Change", description: "Change engine oil and replace oil filter. Recommended every 2,500-3,500 miles or 6 months for small-displacement engines, 5,000-7,500 miles for larger engines.", priorityOverride: "high" },
                { key: "chain_maintenance", patterns: [/chain.*clean/i, /chain.*lube/i, /chain.*adjust/i, /chain.*tension/i, /chain.*maintenance/i], canonical: "Clean, Lubricate, and Adjust Chain", description: "Clean and lubricate drive chain, check and adjust tension. Recommended every 300-600 miles depending on riding conditions.", priorityOverride: "high", mergeIntervals: true },
                { key: "chain_replacement", patterns: [/chain.*replace/i, /drive.*chain.*replace/i], canonical: "Replace Chain", description: "Inspect regularly and replace as needed based on wear.", conditionBased: true },
                { key: "tire_inspection", patterns: [/tire.*pressure/i, /tire.*check/i, /tire.*condition/i, /tire.*inspect/i], canonical: "Check Tire Pressure and Condition", description: "Check tire pressure and inspect tread depth, sidewalls, and overall condition. Recommended every 1,000-3,000 miles or monthly.", priorityOverride: "high" },
                { key: "tire_replacement", patterns: [/tire.*replace/i], canonical: "Replace Tires", description: "Inspect regularly and replace as needed based on wear.", conditionBased: true },
                { key: "brake_fluid", patterns: [/brake.*fluid/i], canonical: "Replace Brake Fluid", description: "Replace brake fluid to maintain stopping performance. Recommended every 1-2 years regardless of mileage." },
                { key: "brake_pads", patterns: [/brake.*pad/i], canonical: "Inspect Brake Pads", description: "Inspect brake pads regularly and replace as needed based on wear.", priorityOverride: "high", conditionBased: true },
                { key: "brake_inspection", patterns: [/brake(?!.*pad)(?!.*fluid).*inspect/i, /brake.*system.*inspect/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "coolant", patterns: [/coolant.*replace/i, /coolant.*service/i, /coolant.*flush/i, /coolant.*system/i, /coolant.*inspect/i], canonical: "Replace Coolant", description: "Replace engine coolant to maintain proper cooling and prevent corrosion. Recommended every 2 years or per manufacturer spec." },
                { key: "spark_plugs", patterns: [/spark.*plug/i], canonical: "Replace Spark Plugs", description: "Replace spark plugs per manufacturer interval. Recommended every 4,000-8,000 miles for small engines, longer for larger engines." },
                { key: "air_filter", patterns: [/air.*filter/i], canonical: "Air Filter Cleaning and Replacement", description: "Clean or replace the air filter. Recommended every 3,000-6,000 miles depending on riding conditions." },
                { key: "cable_lube", patterns: [/cable.*lube/i, /cable.*lubric/i, /throttle.*cable/i, /clutch.*cable/i], canonical: "Lubricate Control Cables", description: "Lubricate throttle, clutch, and other control cables. Recommended every 3,000-6,000 miles or annually depending on conditions." },
                { key: "valve_clearance", patterns: [/valve.*clear/i, /valve.*check/i, /valve.*adjust/i, /valve.*inspect/i], canonical: "Check and Adjust Valve Clearance", description: "Check and adjust valve clearances per manufacturer spec. Recommended every 6,000-8,000 miles for small engines.", priorityOverride: "high" },
                { key: "battery", patterns: [/battery.*maintain/i, /battery.*check/i, /battery.*inspect/i, /battery.*replace/i, /battery.*service/i], canonical: "Battery Inspection and Maintenance", description: "Check battery terminals, voltage, and electrolyte level. Clean connections and charge as needed." },
                { key: "fork_oil", patterns: [/fork.*oil/i, /fork.*seal/i, /front.*fork.*service/i, /fork.*service/i], canonical: "Replace Fork Oil", description: "Replace fork oil and inspect seals. Recommended every 10,000-15,000 miles or every 2 years.", priorityOverride: "medium" },
                { key: "fuel_system", patterns: [/fuel.*system/i, /fuel.*inject.*clean/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "suspension_generic", patterns: [/suspension.*inspect/i, /shock.*inspect/i, /rear.*shock/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "hardware", patterns: [/engine.*mount/i, /hardware.*check/i, /fastener/i, /bolt.*torque/i], canonical: "", description: "", remove: true },
                { key: "steering_bearing", patterns: [/steering.*head.*bearing/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "wheel_bearing", patterns: [/wheel.*bearing/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "general_inspection", patterns: [/general.*inspect/i, /safety.*inspect/i, /multi.*point/i], canonical: "", description: "", remove: true },
                { key: "winterization", patterns: [/winteriz/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto || vehicleCategory === "motorcycle" || vehicleCategory === "atv" || vehicleCategory === "utv" },
              ];

              // Step 1: Map each task to a family
              const matched = new Set<number>();
              const familyGroups = new Map<number, number[]>();

              for (let fi = 0; fi < families.length; fi++) {
                const fam = families[fi];
                for (let ti = 0; ti < validatedTasks.length; ti++) {
                  if (matched.has(ti)) continue;
                  if (fam.patterns.some(p => p.test(validatedTasks[ti].task))) {
                    const arr = familyGroups.get(fi) || [];
                    arr.push(ti);
                    familyGroups.set(fi, arr);
                    matched.add(ti);
                  }
                }
              }

              // Step 2: Process each family — determine what to keep
              const keepIndexes = new Set<number>();
              const overrides = new Map<number, Partial<ValidatedTask>>();

              for (const [fi, taskIdxs] of familyGroups.entries()) {
                const fam = families[fi];
                if (fam.remove) {
                  if (!fam.removeCondition || fam.removeCondition()) continue;
                }
                const keepIdx = taskIdxs[0];
                keepIndexes.add(keepIdx);
                const ov: Partial<ValidatedTask> = {};
                if (fam.canonical) ov.task = fam.canonical;
                if (fam.description) ov.description = fam.description;
                if (fam.priorityOverride) ov.priority = fam.priorityOverride;
                if (fam.mergeIntervals && taskIdxs.length > 1) {
                  let minMiles: number | null = null;
                  let minMonths: number | null = null;
                  for (const ti of taskIdxs) {
                    const t = validatedTasks[ti];
                    if (t.interval_miles !== null && (minMiles === null || t.interval_miles < minMiles)) minMiles = t.interval_miles;
                    if (t.interval_months !== null && (minMonths === null || t.interval_months < minMonths)) minMonths = t.interval_months;
                  }
                  if (minMiles !== null) ov.interval_miles = minMiles;
                  if (minMonths !== null) ov.interval_months = minMonths;
                }
                if (fam.conditionBased) {
                  const currentDesc = (ov.description || validatedTasks[keepIdx].description).toLowerCase();
                  if (!currentDesc.includes("inspect") && !currentDesc.includes("check") && !currentDesc.includes("condition") && !currentDesc.includes("when worn")) {
                    const base = (ov.description || validatedTasks[keepIdx].description).replace(/\.\s*$/, "");
                    ov.description = base + ". Inspect regularly and replace as needed based on wear.";
                  }
                }
                if (Object.keys(ov).length > 0) overrides.set(keepIdx, ov);
              }

              // Keep unmatched tasks ONLY for non-small-moto vehicles
              for (let i = 0; i < validatedTasks.length; i++) {
                if (!matched.has(i)) {
                  if (!isSmallMoto) keepIndexes.add(i);
                }
              }

              // Step 3: Build filtered list with overrides (safe index mapping)
              validatedTasks = validatedTasks
                .map((t, i) => ({ t, i }))
                .filter(({ i }) => keepIndexes.has(i))
                .map(({ t, i }) => {
                  const ov = overrides.get(i);
                  return ov ? { ...t, ...ov } as ValidatedTask : t;
                });

              // Step 4: Spark plug interval guard
              const oilTask = validatedTasks.find(t => /oil.*change|oil.*filter|engine.*oil/i.test(t.task));
              const sparkTask = validatedTasks.find(t => /spark.*plug/i.test(t.task));
              if (oilTask && sparkTask && oilTask.interval_miles && sparkTask.interval_miles && oilTask.interval_miles === sparkTask.interval_miles) {
                sparkTask.interval_miles = Math.min(sparkTask.interval_miles * 2, 10000);
              }

              // Step 5: Fork oil priority cap
              validatedTasks = validatedTasks.map(t => /fork.*oil/i.test(t.task) ? { ...t, priority: "medium" } : t);

              // Step 6: Interval diversity — max 2 unrelated tasks with same interval_miles
              const PROTECTED_NAMES = ["Engine Oil and Filter Change", "Clean, Lubricate, and Adjust Chain", "Inspect Brake Pads", "Check Tire Pressure and Condition", "Check and Adjust Valve Clearance"];
              const mileageCounts = new Map<number, number[]>();
              validatedTasks.forEach((t, i) => {
                if (t.interval_miles !== null) {
                  const arr = mileageCounts.get(t.interval_miles) || [];
                  arr.push(i);
                  mileageCounts.set(t.interval_miles, arr);
                }
              });
              for (const [miles, idxs] of mileageCounts.entries()) {
                if (idxs.length > 2) {
                  const sortedIdxs = [...idxs].sort((a, b) => {
                    const pa = validatedTasks[a].priority === "high" ? 3 : validatedTasks[a].priority === "medium" ? 2 : 1;
                    const pb = validatedTasks[b].priority === "high" ? 3 : validatedTasks[b].priority === "medium" ? 2 : 1;
                    return pa - pb;
                  });
                  let adjusted = 0;
                  for (const idx of sortedIdxs) {
                    if (adjusted >= idxs.length - 2) break;
                    if (PROTECTED_NAMES.includes(validatedTasks[idx].task)) continue;
                    validatedTasks[idx] = { ...validatedTasks[idx], interval_miles: Math.round(miles * 1.2) };
                    adjusted++;
                  }
                }
              }

              // Step 7: Trim to max 18 tasks
              if (validatedTasks.length > 18) {
                const scored = validatedTasks.map((t, i) => {
                  const priScore = t.priority === "high" ? 3 : t.priority === "medium" ? 2 : 1;
                  const coreScore = PROTECTED_NAMES.includes(t.task) ? 10 : 0;
                  return { idx: i, score: priScore + coreScore };
                });
                scored.sort((a, b) => a.score - b.score);
                const removeCount = validatedTasks.length - 18;
                const removeIdxs = new Set(scored.slice(0, removeCount).map(s => s.idx));
                validatedTasks = validatedTasks.filter((_, i) => !removeIdxs.has(i));
              }

              // Step 8: Final dedup by normalized name
              const seenNames = new Set<string>();
              validatedTasks = validatedTasks.filter(t => {
                const k = t.task.toLowerCase().trim();
                if (seenNames.has(k)) return false;
                seenNames.add(k);
                return true;
              });

              if (validatedTasks.length < 10) {
                console.warn(`[POST-PROCESS] Only ${validatedTasks.length} tasks after cleanup`);
              }
            }
            if (validatedTasks.length >= 5) {
              await adminClient.from("ai_schedule_cache").upsert({ cache_key: cacheKey, vehicle_desc: vehicleDesc, vehicle_category: vehicleCategory, fuel_type: resolvedVehicleType, tasks_json: JSON.stringify(validatedTasks), task_count: validatedTasks.length }, { onConflict: "cache_key" });
            }
          }
        }
      }

      if (validatedTasks && validatedTasks.length >= 5) {
        if (isPreload) {
          return json({ success: true, source: "preload-ai", cached: true, task_count: validatedTasks.length });
        }
        const aiTasksToInsert = validatedTasks.map(t => ({
          user_id: authUserId, vehicle_id, template_id: null,
          name: t.task, description: t.description, category: t.category,
          interval_miles: t.interval_miles, interval_hours: t.interval_hours, interval_months: t.interval_months,
          last_completed_date: null, last_completed_miles: null, last_completed_hours: null,
          next_due_miles: (!isHoursMode && t.interval_miles !== null) ? Math.round(resolvedCurrentMileage) + t.interval_miles : null,
          next_due_hours: (isHoursMode && t.interval_hours !== null) ? Math.round(resolvedCurrentHours) + t.interval_hours : null,
          next_due_date: t.interval_months !== null ? addMonths(today, t.interval_months).toISOString() : null,
          status: "upcoming", priority: t.priority, is_custom: false, source: "ai",
        }));
        const { error: aiInsertErr } = await adminClient.from("user_vehicle_maintenance_tasks").insert(aiTasksToInsert);
        if (!aiInsertErr) {
          const edgeFnSecret = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
          let estimatesCached = 0;
          let estimateWarning: string | undefined;
          if (!edgeFnSecret) {
            console.error("[ESTIMATES] EDGE_FUNCTION_SECRET is not set — skipping cost estimate generation. Set this secret in Supabase dashboard.");
            estimateWarning = "Cost estimates were not generated because EDGE_FUNCTION_SECRET is not configured.";
          } else {
            const estimateUrl = `${supabaseUrl}/functions/v1/estimate-repair-cost`;
            const estimateHeaders: Record<string, string> = { "Content-Type": "application/json", "x-edge-secret": edgeFnSecret };
            const estimateNames = aiTasksToInsert.map((t: any) => (t.name as string).toLowerCase().trim());
            const BATCH = 5;
            for (let i = 0; i < estimateNames.length; i += BATCH) {
              const batch = estimateNames.slice(i, i + BATCH);
              const results = await Promise.allSettled(batch.map(svc =>
                fetch(estimateUrl, {
                  method: "POST",
                  headers: estimateHeaders,
                  body: JSON.stringify({ year, make, model: vehicleModel, service_name: svc, vehicle_type: resolvedVehicleType }),
                }).then(r => {
                  if (r.ok) { estimatesCached++; }
                  else { console.warn(`[ESTIMATES] Failed for ${svc}: ${r.status}`); }
                  return r.ok;
                })
              ));
              for (const r of results) {
                if (r.status === "rejected") console.warn(`[ESTIMATES] Error:`, r.reason);
              }
            }
            if (estimatesCached === 0 && estimateNames.length > 0) {
              console.error(`[ESTIMATES] All ${estimateNames.length} estimate calls failed for ${vehicleDesc} — likely auth misconfiguration`);
              estimateWarning = "Cost estimates failed to generate. Check EDGE_FUNCTION_SECRET configuration.";
            }
          }
          return json({ success: true, tasks_created: aiTasksToInsert.length, estimates_cached: estimatesCached, vehicle_id, source: "ai", ...(estimateWarning ? { warning: estimateWarning } : {}) });
        }
        console.error("[AI] Insert failed:", aiInsertErr.message);
      }
    } catch (aiBlockErr) {
      console.error("[AI BLOCK] Error, falling back to templates:", aiBlockErr instanceof Error ? aiBlockErr.message : aiBlockErr);
    }

    // ── TEMPLATE FALLBACK ──────────────────────────────────────────────
    // NOTE: For hours-tracked assets, template fallback produces TIME-ONLY tasks
    // (interval_months + next_due_date). Hours intervals are only generated by
    // the AI path. This is intentional — mileage templates cannot be safely
    // reinterpreted as engine hours.
    if (isHoursMode) {
      console.warn(`[TEMPLATE FALLBACK] Hours-tracked asset ${vehicleCategory} falling back to time-only templates. AI generation failed or was unavailable.`);
    }

    if (isPreload) {
      return json({ success: true, source: "preload-template-fallback", cached: false, message: "AI generation failed, no cache created" });
    }

    // ── 5. Determine which vehicle_type values to query ────────────────────
    // Note: `maintenance_templates.vehicle_type` is used in this project for fuel-type-aware templates.
    // We add extra fuel-type template sets when a vehicle_type (category) requires them.
    const typeSet = new Set<string>(["all", resolvedVehicleType]);
    if (resolvedVehicleType === "hybrid") {
      // Hybrid schedules should behave like gas schedules, with a few targeted additions.
      typeSet.add("gas");
    }
    if (vehicleCategory === "dump_truck" || vehicleCategory === "standard_dump" || vehicleCategory === "roll_off" || vehicleCategory === "hook_lift") {
      // Dump trucks are diesel maintenance regardless of the selected fuel type.
      typeSet.add("diesel");
    }
    const typeArray = Array.from(typeSet);
    if (resolvedIsAwd) typeArray.push("awd_4wd");

    // ── 6. Fetch matching templates ────────────────────────────────────────
    const { data: templates, error: templatesError } = await adminClient
      .from("maintenance_templates")
      .select("*")
      .in("vehicle_type", typeArray)
      .eq("make", "ALL");

    if (templatesError) {
      console.error("Templates query error:", templatesError);
      return json({ error: "Failed to load maintenance templates", detail: templatesError.message }, 500);
    }
    if (!templates || templates.length === 0) {
      return json({ success: true, tasks_created: 0, vehicle_id }, 200);
    }

    // ── 6b. Filter templates by vehicle category ───────────────────────────
    const excluded = CATEGORY_EXCLUSIONS[vehicleCategory] ?? [];
    const filteredTemplates = excluded.length > 0
      ? templates.filter((t: Record<string, unknown>) => !excluded.includes(t.task as string))
      : templates;

    type IntervalRule = {
      miles: number | null;
      months: number | null;
      match: RegExp[];
    };

    const dieselRules: IntervalRule[] = [
      { miles: 10000, months: 12, match: [/oil change/i] },
      { miles: 10000, months: 12, match: [/oil filter/i] },
      { miles: 15000, months: 12, match: [/fuel filter/i, /water separator/i] },
      { miles: 30000, months: 24, match: [/air filter/i] },
      { miles: 5000, months: 6, match: [/\bdef\b/i, /diesel exhaust fluid/i] },
      { miles: 100000, months: null, match: [/dpf/i] },
      { miles: 60000, months: null, match: [/glow plug/i] },
      { miles: 60000, months: null, match: [/turbocharger/i] },
      { miles: 60000, months: 48, match: [/coolant flush/i] },
      { miles: 30000, months: 36, match: [/transmission fluid/i] },
      { miles: 15000, months: 12, match: [/brake.*inspection/i] },
      { miles: 10000, months: 12, match: [/tire rotation/i] },
    ];

    const evRules: IntervalRule[] = [
      { miles: 7500, months: 6, match: [/tire rotation/i] },
      { miles: 25000, months: 24, match: [/brake fluid/i] },
      { miles: 15000, months: 12, match: [/cabin air filter/i] },
      { miles: 50000, months: 48, match: [/battery thermal/i, /battery.*coolant/i, /coolant.*battery/i] },
      { miles: null, months: 12, match: [/battery health check/i, /battery.*health/i] },
      { miles: null, months: 12, match: [/wiper.*blade/i] },
    ];

    const dumpTruckRules: IntervalRule[] = [
      { miles: 25000, months: 12, match: [/pto service/i] },
      { miles: null, months: 12, match: [/hydraulic system service/i] },
      { miles: null, months: 3, match: [/body hinge lubrication/i] },
      { miles: null, months: 6, match: [/tailgate.*(chain|latch)/i] },
      { miles: 7500, months: 3, match: [/king pin grease/i] },
      { miles: 7500, months: 3, match: [/propshaft grease/i] },
      { miles: 30000, months: 24, match: [/front wheel bearing repack/i, /front.*wheel bearing/i] },
      { miles: 30000, months: 24, match: [/rear differential service/i, /rear differential/i] },
    ];

    const rollOffHookLiftRules: IntervalRule[] = [
      { miles: null, months: 3, match: [/hook.*cable/i, /hook\/cable/i] },
      { miles: null, months: 6, match: [/rail/i, /guide roller/i] },
    ];

    const rollOffOnlyRules: IntervalRule[] = [
      { miles: null, months: 3, match: [/winch cable/i, /winch chain/i, /winch cable\/chain/i] },
    ];

    const trailerRules: IntervalRule[] = [
      { miles: null, months: 12, match: [/wheel bearing repack/i, /wheel bearing/i] },
      { miles: null, months: 6, match: [/brake.*adjust/i] },
      { miles: null, months: 1, match: [/grease.*zerk/i] },
      { miles: null, months: 6, match: [/coupler/i] },
      { miles: null, months: 6, match: [/safety chain/i] },
      { miles: null, months: 6, match: [/electrical.*(connection|connections|light|lights)/i] },
      { miles: null, months: 12, match: [/jack stand/i] },
      { miles: null, months: 12, match: [/(floor|deck).*inspection/i] },
      { miles: null, months: 12, match: [/suspension.*inspection/i] },
      { miles: null, months: 3, match: [/tire inspection/i] },
      { miles: null, months: 42, match: [/tire replacement/i] },
      { miles: null, months: 6, match: [/breakaway/i] },
      { miles: null, months: 3, match: [/lug nut/i] },
    ];

    const dumpTrailerRules: IntervalRule[] = [
      { miles: null, months: 3, match: [/hydraulic fluid/i] },
      { miles: null, months: 1, match: [/hydraulic cylinder.*grease/i, /hydraulic cylinder/i] },
      { miles: null, months: 1, match: [/dump body.*(pivot|hinge)/i, /pivot hinge.*grease/i, /dump body.*hinge/i] },
      { miles: null, months: 1, match: [/rear door.*hinge.*grease/i, /rear door.*hinge/i] },
      { miles: null, months: 1, match: [/scissor/i] },
      { miles: null, months: 6, match: [/tarp/i] },
    ];

    const dumpsterRules: IntervalRule[] = [
      { miles: null, months: 1, match: [/door hinge lubrication/i, /door hinge/i] },
      { miles: null, months: 6, match: [/door seal inspection/i, /door seal/i] },
      { miles: null, months: 6, match: [/floor inspection/i, /rust/i, /holes/i] },
      { miles: null, months: 12, match: [/exterior rust treatment/i] },
      { miles: null, months: 12, match: [/paint touch/i] },
      { miles: null, months: 6, match: [/wheel/i, /caster/i] },
      { miles: null, months: 3, match: [/drain plug/i] },
      { miles: null, months: 12, match: [/structural weld inspection/i, /weld inspection/i] },
      { miles: null, months: 6, match: [/latch/i, /lock mechanism/i] },
      { miles: null, months: 3, match: [/pressure wash/i, /\bclean\b/i] },
    ];

    const isTrailer = vehicleCategory === "trailer" || vehicleCategory === "dump_trailer";
    const isDumpTrailer = vehicleCategory === "dump_trailer";
    const isDumpTruck = vehicleCategory === "dump_truck" || vehicleCategory === "standard_dump" || vehicleCategory === "roll_off" || vehicleCategory === "hook_lift";
    const isRollOff = vehicleCategory === "roll_off";
    const isHookLift = vehicleCategory === "hook_lift";
    const isDumpster = vehicleCategory === "dumpster";
    const isDiesel = resolvedVehicleType === "diesel";
    const isEv = resolvedVehicleType === "ev";
    const isHybrid = resolvedVehicleType === "hybrid";

    const exclusiveRules: IntervalRule[] | null = isTrailer
      ? (isDumpTrailer ? [...trailerRules, ...dumpTrailerRules] : trailerRules)
      : isDumpster
        ? dumpsterRules
      : isDumpTruck
        ? [
            ...dieselRules,
            ...dumpTruckRules,
            ...(isRollOff || isHookLift ? rollOffHookLiftRules : []),
            ...(isRollOff ? rollOffOnlyRules : []),
          ]
        : isDiesel
          ? dieselRules
          : isEv
            ? evRules
            : null;

    const useExclusiveRules = exclusiveRules !== null;

    function findExclusiveRule(taskName: string): IntervalRule | null {
      if (!exclusiveRules) return null;
      for (const rule of exclusiveRules) {
        if (rule.match.some(re => re.test(taskName))) return rule;
      }
      return null;
    }

    const shouldDedupByTaskName = useExclusiveRules || isHybrid;

    // ── 7. Fetch all relevant overrides for this make in one query ─────────
    const templateIds = filteredTemplates.map((t: Record<string, unknown>) => t.id as string);

    const { data: overrides, error: overridesError } = await adminClient
      .from("make_template_overrides")
      .select("*")
      .in("template_id", templateIds)
      .ilike("make", make.trim());

    if (overridesError) {
      console.error("Overrides query error:", overridesError);
      return json({ error: "Failed to load make overrides", detail: overridesError.message }, 500);
    }

    const overrideMap = new Map<string, Record<string, unknown>>();
    for (const override of (overrides ?? [])) {
      const o = override as Record<string, unknown>;
      const yearStart = o.year_start as number | null;
      const yearEnd = o.year_end as number | null;
      if ((yearStart === null || yearStart <= year) && (yearEnd === null || yearEnd >= year)) {
        overrideMap.set(o.template_id as string, o);
      }
    }

    // ── 8 & 9. Resolve values and calculate due dates ──────────────────────
    const tasksToInsert: Record<string, unknown>[] = [];
    const insertedTaskNames = new Set<string>();

    for (const template of filteredTemplates) {
      const t = template as Record<string, unknown>;
      const templateId = t.id as string;
      const override = overrideMap.get(templateId) ?? null;

      if (override && (override.is_excluded as boolean) === true) {
        continue;
      }

      let resolvedMiles: number | null = null;
      let resolvedMonths: number | null = null;

      const rawTemplateMiles = t.mileage_interval as number;
      const rawTemplateMonths = t.time_interval_months as number;
      const templateMiles = rawTemplateMiles > 0 ? rawTemplateMiles : null;
      const templateMonths = rawTemplateMonths > 0 ? rawTemplateMonths : null;

      if (override) {
        const overrideMiles = (override.interval_miles as number | null) ?? null;
        const overrideMonths = (override.interval_months as number | null) ?? null;
        resolvedMiles = overrideMiles !== null ? overrideMiles : templateMiles;
        resolvedMonths = overrideMonths !== null ? overrideMonths : templateMonths;
      } else {
        resolvedMiles = templateMiles;
        resolvedMonths = templateMonths;
      }

      const taskName = t.task as string;

      if (useExclusiveRules) {
        const rule = findExclusiveRule(taskName);
        if (!rule) continue;
        resolvedMiles = rule.miles;
        resolvedMonths = rule.months;
      } else if (isHybrid) {
        // Hybrid: extend brake pad intervals and add battery health checks.
        if (/brake.*pad/i.test(taskName)) {
          resolvedMiles = 40000;
        }
        if (/hybrid.*battery.*health/i.test(taskName) || /battery.*health check/i.test(taskName) || /battery.*health/i.test(taskName)) {
          resolvedMiles = null;
          resolvedMonths = 12;
        }
      }

      if (shouldDedupByTaskName) {
        if (insertedTaskNames.has(taskName)) continue;
        insertedTaskNames.add(taskName);
      }

      const nextDueMiles =
        resolvedMiles !== null && resolvedMiles > 0
          ? Math.round(resolvedCurrentMileage) + resolvedMiles
          : null;

      const nextDueDate =
        resolvedMonths !== null && resolvedMonths > 0
          ? addMonths(today, resolvedMonths).toISOString()
          : null;

      tasksToInsert.push({
        user_id: authUserId,
        vehicle_id,
        template_id: templateId,
        name: t.task as string,
        description: (t.description as string | null) ?? null,
        category: t.category as string,
        interval_miles: isHoursMode ? null : resolvedMiles,
        interval_hours: null,  // Template fallback does not generate hours intervals — only AI path does
        interval_months: resolvedMonths,
        last_completed_date: null,
        last_completed_miles: null,
        last_completed_hours: null,
        next_due_miles: isHoursMode ? null : nextDueMiles,
        next_due_hours: null,  // Template fallback uses time-only intervals for hours assets
        next_due_date: nextDueDate,
        status: "upcoming",
        priority: t.priority as string,
        is_custom: false,
        source: "template",
      });
    }

    if (tasksToInsert.length === 0) {
      return json({ success: true, tasks_created: 0, vehicle_id }, 200);
    }

    // ── 10. Batch insert all tasks ─────────────────────────────────────────
    const { error: insertError } = await adminClient.from("user_vehicle_maintenance_tasks").insert(tasksToInsert);
    if (insertError) return json({ error: "Failed to generate schedule", detail: insertError.message }, 500);
    const tplEdgeFnSecret = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
    let tplEstimatesCached = 0;
    let tplEstimateWarning: string | undefined;
    if (!tplEdgeFnSecret) {
      console.error("[ESTIMATES] EDGE_FUNCTION_SECRET is not set — skipping cost estimate generation. Set this secret in Supabase dashboard.");
      tplEstimateWarning = "Cost estimates were not generated because EDGE_FUNCTION_SECRET is not configured.";
    } else {
      const tplEstimateUrl = `${supabaseUrl}/functions/v1/estimate-repair-cost`;
      const tplEstimateHeaders: Record<string, string> = { "Content-Type": "application/json", "x-edge-secret": tplEdgeFnSecret };
      const tplEstimateNames = tasksToInsert.map((t: any) => (t.name as string).toLowerCase().trim());
      const TPL_BATCH = 5;
      for (let i = 0; i < tplEstimateNames.length; i += TPL_BATCH) {
        const batch = tplEstimateNames.slice(i, i + TPL_BATCH);
        const results = await Promise.allSettled(batch.map(svc =>
          fetch(tplEstimateUrl, {
            method: "POST",
            headers: tplEstimateHeaders,
            body: JSON.stringify({ year, make, model: vehicleModel, service_name: svc, vehicle_type: resolvedVehicleType }),
          }).then(r => {
            if (r.ok) { tplEstimatesCached++; }
            else { console.warn(`[ESTIMATES] Failed for ${svc}: ${r.status}`); }
            return r.ok;
          })
        ));
        for (const r of results) {
          if (r.status === "rejected") console.warn(`[ESTIMATES] Error:`, r.reason);
        }
      }
      if (tplEstimatesCached === 0 && tasksToInsert.length > 0) {
        console.error(`[ESTIMATES] All template estimate calls failed for ${vehicleDesc} — likely auth misconfiguration`);
        tplEstimateWarning = "Cost estimates failed to generate. Check EDGE_FUNCTION_SECRET configuration.";
      }
    }
    return json({ success: true, tasks_created: tasksToInsert.length, estimates_cached: tplEstimatesCached, vehicle_id, source: "template", ...(tplEstimateWarning ? { warning: tplEstimateWarning } : {}) });

  } catch (err) {
    console.error("Unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Failed to generate schedule", detail: message }, 500);
  }
});

