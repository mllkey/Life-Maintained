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

import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { jsonResponse as json } from "../_shared/json.ts";
import { requireUser, AuthError } from "../_shared/auth.ts";
import { enforceAiRateLimit, RateLimitError } from "../_shared/rateLimit.ts";
import { requirePaidTier, PremiumGateError } from "../_shared/tierGate.ts";

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Released in the finally below; set once the generation claim is acquired.
  let releaseClaim: (() => Promise<void>) | null = null;

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
      force_refresh,
    } = body;

    const isForceRefresh = force_refresh === true;

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

    // Tracking mode behavior:
    // - "mileage": mileage-primary (interval_miles, next_due_miles)
    // - "hours": hours-primary (interval_hours, next_due_hours; interval_miles = null)
    // - "both": dual-meter capable (preserves both miles and hours intervals)
    // - "time_only": date-based intervals only, no usage tracking
    const isHoursOnlyMode = trackingMode === "hours";
    const isMileageMode = trackingMode === "mileage";
    const isBothMode = trackingMode === "both";
    const isTimeOnlyMode = trackingMode === "time_only";
    const isHoursCapableMode = isHoursOnlyMode || isBothMode;

    const resolvedCurrentMileage = typeof current_mileage === "number" ? current_mileage : 0;

    let resolvedCurrentHours = 0;
    if (isHoursCapableMode) {
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

    // Packet A: dump-truck categories are diesel-maintenance regardless of submitted fuel.
    // effectiveFuel is the single source of truth for ALL downstream fuel-dependent logic.
    const DUMP_CATEGORIES = new Set(["dump_truck", "standard_dump", "roll_off", "hook_lift"]);
    const effectiveFuel = DUMP_CATEGORIES.has(vehicleCategory) ? "diesel" : resolvedVehicleType;

    // Preload mode removed (closes PASS-B-004). Auth is mandatory below.

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

    // ── 2. Authenticate user from JWT (real signature verification) ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    let authUserId = "";
    let isServiceRoleCall = false;

    // Distinguish service-role admin calls from user calls by detecting
    // the service role key directly. We compare against the env var so
    // the check is constant-time-ish and doesnt rely on parsing the JWT.
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid Authorization header" }, 401);
    }
    const incomingJwt = authHeader.replace("Bearer ", "").trim();
    if (supabaseServiceKey && incomingJwt === supabaseServiceKey) {
      isServiceRoleCall = true;
    } else {
      const { userId } = await requireUser(req);
      authUserId = userId;
    }

    // ── 3. Verify vehicle ownership ────────────────────────────────────────
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    if (isServiceRoleCall) {
      // Admin call: look up user_id from vehicles table instead of verifying ownership
      const { data: vRow } = await adminClient.from("vehicles").select("user_id").eq("id", vehicle_id).maybeSingle();
      if (!vRow?.user_id) {
        return json({ error: "Vehicle not found" }, 404);
      }
      authUserId = vRow.user_id;
    } else {
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

      // Premium gate: first generation for a vehicle is free by design
      // (onboarding value reveal). Only paid re-generation (force refresh)
      // is gated. Non-refresh calls with an existing schedule short-circuit
      // on the existing-count check before any AI spend. Service-role admin
      // calls never reach this branch.
      if (isForceRefresh) {
        await requirePaidTier(adminClient, authUserId);
      }
      // Rate limit on user calls only. Internal admin calls skip.
      await enforceAiRateLimit(adminClient, authUserId, "generate-maintenance-schedule");
    }

    // Concurrency claim: serialize generation per vehicle.
    // Several client surfaces can trigger generation near-simultaneously. Without
    // this, two invocations both pass the existing-tasks check below (a TOCTOU
    // window spanning the multi-second AI call) and each insert a full schedule.
    // The claim is atomic and TTL-backed; released in the handler finally on every path.
    {
      const lockToken = crypto.randomUUID();

      const { data: claimedLockToken, error: claimError } = await adminClient.rpc(
        "claim_schedule_generation",
        {
          p_vehicle_id: vehicle_id,
          p_lock_token: lockToken,
          p_ttl_seconds: 180,
        },
      );

      if (claimError) {
        console.error("[CLAIM] acquire error:", claimError.message);
        return json({ error: "Failed to acquire generation lock", detail: claimError.message }, 500);
      }

      if (claimedLockToken !== lockToken) {
        return json({ error: "Schedule generation already in progress for this vehicle." }, 409);
      }

      releaseClaim = async () => {
        const { error: releaseError } = await adminClient.rpc(
          "release_schedule_generation",
          {
            p_vehicle_id: vehicle_id,
            p_lock_token: lockToken,
          },
        );

        if (releaseError) {
          throw new Error(releaseError.message);
        }
      };
    }

    // ── 4. Check for existing tasks (prevent duplicate schedules) ──────────
    // Force-refresh no longer deletes the old schedule up front. The swap is
    // performed atomically inside the replacement RPC at insert time, so
    // a failed or empty generation can never destroy an existing schedule.
    if (!isForceRefresh) {
      const { count: existingCount, error: countError } = await adminClient
        .from("user_vehicle_maintenance_tasks")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", vehicle_id)
        .eq("user_id", authUserId);

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
    const cacheKey = `v2|${year}|${make}|${vehicleModel}|${vehicleCategory}|${effectiveFuel}|${trackingMode}`.toLowerCase().trim();

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
      // Brake fluid: moisture-absorbing fluid; most mfrs (Honda, Kawasaki, Yamaha) say every 2 years. Miles cap conservative since it's primarily time-based.
      { match: [/brake.*fluid/i], max_months: 24, max_miles: 15000 },
      // Coolant: most air-cooled bikes lack it; liquid-cooled mfrs say 2-3 years.
      { match: [/coolant/i], max_months: 24, max_miles: 24000 },
      // Oil: Kawasaki ZX-10R/Yamaha R1 say every 3,750 mi or 6 mo. Cap at 6 mo (not 12) for safety.
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 6, max_miles: 4000, min_miles: 2000 },
      // Chain lube: most chain manufacturers say every 300-400 mi; 500 mi is the absolute max.
      { match: [/chain.*clean/i, /chain.*lube/i, /chain.*lubrication/i, /chain maintenance/i], max_months: 1, max_miles: 500, min_miles: 200 },
      // Chain tension: Kawasaki says every 600 mi; 3,000 mi is a reasonable outer bound.
      { match: [/chain.*adjust/i, /chain.*tension/i], max_months: 6, max_miles: 3000, min_miles: 600 },
      // Valve clearance: ZX-10R 7,500 mi; R1 11,250 mi; CBR600RR 8,000 mi. 10k is a safe outer bound.
      { match: [/valve.*check/i, /valve.*clearance/i, /valve.*adjust/i, /valve.*inspection/i], max_months: 18, max_miles: 10000, min_miles: 3000 },
      // Tire inspect: safety-critical; inspect at least every 3,000 mi or 3 months. More frequent than before.
      { match: [/tire.*inspect/i, /tire.*check/i, /tire.*wear/i, /tire.*pressure/i], max_months: 3, max_miles: 3000 },
      // Brake pad: ZX-10R/R1 say inspect every 3,750 mi. 8,000 mi is a conservative outer bound.
      { match: [/brake.*pad/i, /brake.*inspection/i], max_months: 12, max_miles: 8000 },
      // Spark plug: already tightened; sport bikes 7,500, standard/touring up to 16,000.
      { match: [/spark plug/i], max_months: 24, max_miles: 16000, min_miles: 3000 },
      // Air filter: ZX-10R/R1 say 7,500-10,000 mi. Cap at 10,000 mi conservatively.
      { match: [/air filter/i], max_months: 12, max_miles: 10000 },
      // Fork oil: most mfrs say 10,000-15,000 mi or 2 years. 15,000 mi is the outer bound.
      { match: [/fork.*oil/i, /fork.*seal/i], max_months: 24, max_miles: 15000 },
    ];
    const CAR_TRUCK_CLAMPS: IntervalClamp[] = [
      // Brake fluid: NHTSA recommends every 2 years. BMW/Mercedes/VW mandate 2 years regardless of miles.
      { match: [/brake.*fluid/i], max_months: 24, max_miles: 30000 },
      // Coolant: traditional green = 2 yr/30k mi; long-life OAT = 5 yr/150k. Cap at 3 yr/60k (conservative middle ground).
      { match: [/coolant/i], max_months: 36, max_miles: 60000 },
      // Oil: conventional = 3,000-5,000 mi / 6 mo. Already tightened last pass.
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 6, max_miles: 7500, min_miles: 3000 },
      // Transmission fluid: most mfrs recommend 30,000-45,000 mi for conventional ATF/MTF.
      { match: [/transmission.*fluid/i], max_months: 36, max_miles: 45000 },
      // Brake pad inspection: most mfrs say every 12,000-15,000 mi or annually. 20,000 mi cap is conservative.
      { match: [/brake.*pad/i, /brake.*inspection/i], max_months: 12, max_miles: 20000 },
      // Tire rotation: most mfrs say every 5,000-7,500 mi. Cap at 7,500 mi.
      { match: [/tire.*rotation/i], max_months: 6, max_miles: 7500, min_miles: 3000 },
      // Spark plug: copper = 10-30k mi; platinum = 30-60k mi; iridium = 60-100k mi. Cap at 60k for conservative mid-range.
      { match: [/spark plug/i], max_months: 48, max_miles: 60000 },
      // Air filter: most mfrs say 15,000-30,000 mi / 1-2 years. 20k mi / 2 yr is conservative.
      { match: [/air filter/i], max_months: 24, max_miles: 20000 },
      // Cabin filter: Honda/Toyota say 15,000-25,000 mi or annually. Cap at 15k mi / 12 mo.
      { match: [/cabin.*air.*filter/i], max_months: 12, max_miles: 15000 },
      // Wiper blades: universally recommended every 6-12 months.
      { match: [/wiper.*blade/i], max_months: 12 },
      // Serpentine/drive belt: most mfrs say 60,000-90,000 mi or 5-7 years.
      { match: [/serpentine.*belt/i, /drive.*belt/i, /accessory.*belt/i], max_months: 60, max_miles: 60000 },
      // Timing belt: most mfrs (non-chain) say 60,000-90,000 mi or 6-10 years. Safety-critical.
      { match: [/timing.*belt/i], max_months: 60, max_miles: 60000 },
      // Battery: average lifespan 3-5 years. Test at 3 years is conservative.
      { match: [/battery/i], max_months: 36 },
      // Power steering fluid: most mfrs say 50,000-75,000 mi or 3-4 years.
      { match: [/power.*steering.*fluid/i], max_months: 36, max_miles: 50000 },
      // Differential/axle fluid: most mfrs say 30,000-50,000 mi.
      { match: [/differential.*fluid/i, /axle.*fluid/i, /rear.*axle/i], max_months: 36, max_miles: 40000 },
    ];
    const BOAT_PWC_CLAMPS: IntervalClamp[] = [
      // Engine oil: Mercury/Yamaha/Sea-Doo all say 100 hours or annually. This is firm.
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 12, max_hours: 100 },
      // Impeller: Sea-Doo says inspect every 100 hours; many sources say replace at 200 hours. Cap at 200 hr / 1 yr.
      { match: [/impeller/i], max_months: 12, max_hours: 200 },
      // Anodes/zincs: check every 50-100 hours in saltwater; annually minimum. Critical for corrosion prevention.
      { match: [/anode/i, /zinc/i], max_months: 12, max_hours: 100 },
      // Lower unit/gear oil: Mercury/Yamaha say every 100 hours or annually. 200 was double the spec.
      { match: [/lower unit/i, /gear.*oil/i, /gear.*lube/i], max_months: 12, max_hours: 100 },
      // Winterization: annual for cold-climate storage. Not hours-based.
      { match: [/winteriz/i], max_months: 12 },
      // Spark plug: Mercury/Yamaha say every 100 hours or annually.
      { match: [/spark plug/i], max_months: 12, max_hours: 100 },
      // Fuel filter/water separator: most mfrs say every 100 hours or annually.
      { match: [/fuel.*filter/i, /fuel.*water.*separator/i], max_months: 12, max_hours: 100 },
      // Coolant (inboard): most inboard engines say every 2 years / 300-500 hours.
      { match: [/coolant/i], max_months: 24, max_hours: 300 },
      // Belts/drive belts (inboard): inspect annually or every 200 hours.
      { match: [/belt/i], max_months: 12, max_hours: 200 },
    ];

    const SMALL_EQUIPMENT_CLAMPS: IntervalClamp[] = [
      // Engine oil: Briggs & Stratton says every 25 hours; Honda small engines say 50 hours. Use 25 for safety-first.
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 12, max_hours: 25, min_hours: 10 },
      // Air filter: B&S says clean every 25 hr, replace every 100 hr. 50 hr is a safe inspection interval.
      { match: [/air filter/i], max_months: 12, max_hours: 50, min_hours: 15 },
      // Spark plug: B&S and Honda both say replace every 100 hours or annually. 200 hours was double.
      { match: [/spark plug/i], max_months: 12, max_hours: 100 },
      // Fuel filter: B&S says replace annually or every 50 hours.
      { match: [/fuel.*filter/i, /fuel.*system/i], max_months: 12, max_hours: 50 },
      // Blade/cutting edge: most manufacturers say sharpen every 25 hours or inspect each season.
      { match: [/blade/i, /cutting/i, /chain.*sharpen/i], max_months: 6, max_hours: 25 },
      // Lubrication: grease points every 25 hours per most manuals.
      { match: [/grease/i, /lubric/i], max_months: 3, max_hours: 25 },
    ];

    const HEAVY_EQUIPMENT_CLAMPS: IntervalClamp[] = [
      // Engine oil: Caterpillar/Komatsu both say 250 hours. John Deere says 500 hr with premium oil; use 250 for safety.
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 6, max_hours: 250, min_hours: 100 },
      // Hydraulic filter: Cat says hydraulic filter every 500 hours. 1,000 was for full fluid change — split these.
      { match: [/hydraulic.*filter/i, /hydraulic.*fluid/i, /hydraulic.*service/i], max_months: 12, max_hours: 500 },
      // Air filter: Cat/Komatsu say every 500 hours. Dust conditions can require much sooner.
      { match: [/air filter/i], max_months: 6, max_hours: 500 },
      // Fuel filter: Cat primary filter every 500 hours.
      { match: [/fuel.*filter/i], max_months: 6, max_hours: 500 },
      // Coolant: Cat SCA-treated coolant = 1,500 hr/12 mo; ELC = 6,000 hr/3 yr. Use conservative SCA spec.
      { match: [/coolant/i], max_months: 24, max_hours: 1500 },
      // Transmission fluid: Cat says every 1,000 hours.
      { match: [/transmission.*fluid/i, /transmission.*filter/i], max_months: 12, max_hours: 1000 },
      // Grease: Cat says 10 hours for most fittings. Monthly max is already tight.
      { match: [/grease/i, /lubric/i], max_months: 1, max_hours: 50, min_hours: 8 },
      // Track tension/undercarriage: Cat recommends thorough inspection every 250 hours. Visual checks more often.
      { match: [/track.*tension/i, /track.*inspect/i, /undercarriage/i], max_months: 6, max_hours: 250 },
      // Final drive/travel motor oil: Cat says every 1,000 hours.
      { match: [/final.*drive/i, /travel.*motor/i, /swing.*drive/i], max_months: 12, max_hours: 1000 },
    ];

    const MOTORCYCLE_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter per manufacturer spec", category: "Engine", interval_miles: 4000, interval_hours: null, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid to maintain stopping performance", category: "Brakes", interval_miles: null, interval_hours: null, interval_months: 24, priority: "high" },
      { match: [/valve.*check/i, /valve.*clearance/i, /valve.*adjust/i, /valve.*inspection/i], task: "Valve Check / Adjustment", description: "Check and adjust valve clearances per manufacturer spec", category: "Engine", interval_miles: 15000, interval_hours: null, interval_months: 24, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads for wear and replace if needed", category: "Brakes", interval_miles: 7500, interval_hours: null, interval_months: 12, priority: "high" },
      { match: [/tire.*inspect/i, /tire.*check/i, /tire.*wear/i, /tire.*pressure/i], task: "Tire Inspection", description: "Inspect tires for wear, damage, and proper pressure", category: "Safety", interval_miles: 3000, interval_hours: null, interval_months: 3, priority: "high" },
    ];
    const CAR_TRUCK_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: 5000, interval_hours: null, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid", category: "Brakes", interval_miles: null, interval_hours: null, interval_months: 24, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads and rotors for wear", category: "Brakes", interval_miles: 20000, interval_hours: null, interval_months: 12, priority: "high" },
      { match: [/tire.*rotation/i], task: "Tire Rotation", description: "Rotate tires for even wear", category: "Tires", interval_miles: 7500, interval_hours: null, interval_months: 6, priority: "medium" },
    ];
    const BOAT_PWC_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: null, interval_hours: 100, interval_months: 12, priority: "high" },
      { match: [/impeller/i], task: "Impeller Inspection / Replacement", description: "Inspect and replace water pump impeller", category: "Cooling", interval_miles: null, interval_hours: 100, interval_months: 12, priority: "high" },
      { match: [/lower unit/i, /gear.*oil/i, /gear.*lube/i], task: "Lower Unit Gear Oil Change", description: "Change lower unit gear oil and check for water intrusion", category: "Drivetrain", interval_miles: null, interval_hours: 100, interval_months: 12, priority: "high" },
      { match: [/winteriz/i], task: "Winterization", description: "Full winterization including fuel stabilizer, fog engine, drain water systems", category: "Seasonal", interval_miles: null, interval_hours: null, interval_months: 12, priority: "high" },
    ];

    const SMALL_EQUIPMENT_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil Change", description: "Change engine oil per manufacturer spec", category: "Engine", interval_miles: null, interval_hours: 25, interval_months: 12, priority: "high" },
      { match: [/air filter/i], task: "Air Filter Service", description: "Clean or replace air filter", category: "Engine", interval_miles: null, interval_hours: 50, interval_months: 12, priority: "medium" },
      { match: [/spark plug/i], task: "Spark Plug Replacement", description: "Replace spark plug per manufacturer interval", category: "Engine", interval_miles: null, interval_hours: 100, interval_months: 12, priority: "medium" },
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
    // EV guard: electric vehicles have no internal-combustion tasks. Strip any the
    // model emitted AND never force-inject them. Deterministic on fuel_type. NOTE:
    // drivetrain belts (final-drive belt on an electric motorcycle) are intentionally
    // NOT in ICE_ONLY — only engine accessory/serpentine/timing belts are.
    const ICE_ONLY: RegExp[] = [/oil.*change/i, /oil.*filter/i, /engine oil/i, /spark.*plug/i, /fuel.*filter/i, /fuel.*system/i, /fuel.*inject/i, /emission/i, /\bpcv\b/i, /catalytic/i, /muffler/i, /exhaust/i, /smog/i, /timing belt/i, /serpentine/i, /accessory belt/i];
    const isEvFuel = effectiveFuel === "ev";
    const isIceOnly = (name: string) => ICE_ONLY.some(re => re.test(name));
    function validateAndEnforce(tasks: ValidatedTask[], vCat: string): ValidatedTask[] {
      const clamps = getClampsForCategory(vCat);
      const required = getRequiredForCategory(vCat);
      let v = tasks.map(t => ({ ...clampTask(t, clamps), category: normalizeCategory(t.category), priority: normalizePriority(t.priority) }));
      v = v.filter(t => t.task.trim() !== "" && (t.interval_miles !== null || t.interval_hours !== null || t.interval_months !== null));
      if (isEvFuel) v = v.filter(t => !isIceOnly(t.task));
      for (const req of required) {
        if (isEvFuel && isIceOnly(req.task)) continue;
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
        const claudeModel = Deno.env.get("CLAUDE_SONNET_MODEL") ?? "claude-sonnet-4-5";
        const categoryHint = vehicleCategory !== "car" ? ` (category: ${vehicleCategory})` : "";
        const fuelHint = effectiveFuel !== "gas" ? ` (fuel type: ${effectiveFuel})` : "";
        const awdHint = resolvedIsAwd ? " (AWD/4WD)" : "";

        const isHoursAsset = isHoursOnlyMode;
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
- For motorcycles: spark plug intervals are 3,000-7,500 miles for sport/supersport bikes, up to 16,000 miles for standard/touring — NEVER use car spark plug intervals (30,000-100,000 miles) for motorcycles
- For cars and trucks: oil change intervals should reflect oil type — 3,000-5,000 miles for conventional oil, 5,000-7,500 miles for synthetic blend or full synthetic. Default to conventional (3,000-5,000 miles) unless the vehicle is known to require or recommend synthetic (e.g., turbocharged engines, European vehicles, luxury brands)
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

        const TIMEOUT_MS = 90_000;
        const aiController = new AbortController();
        const aiTimeoutId = setTimeout(() => aiController.abort(), TIMEOUT_MS);
        const aiStartedAt = Date.now();
        const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: claudeModel, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
          signal: aiController.signal,
        });
        clearTimeout(aiTimeoutId);
        const aiElapsedMs = Date.now() - aiStartedAt;
        console.log(`[generate-maintenance-schedule] AI call completed in ${aiElapsedMs}ms, status=${aiResponse.status}`);

        if (!aiResponse.ok) {
          const errText = await aiResponse.text();
          console.error("[generate-maintenance-schedule] Claude API error:", aiResponse.status, errText.slice(0, 200));
        }
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
              interval_miles: isHoursOnlyMode ? null : (typeof t.interval_miles === "number" && t.interval_miles > 0 ? t.interval_miles : null),
              interval_hours: isHoursCapableMode ? (typeof t.interval_hours === "number" && t.interval_hours > 0 ? t.interval_hours : null) : null,
              interval_months: typeof t.interval_months === "number" && t.interval_months > 0 ? t.interval_months : null,
              priority: typeof t.priority === "string" ? t.priority : "medium",
            }));
            validatedTasks = validateAndEnforce(parsed, vehicleCategory);

            // ══════════════════════════════════════════════════════════════
            // POST-PROCESSING: Task family dedup, merge, cleanup, trimming
            // ══════════════════════════════════════════════════════════════
            if (validatedTasks && !isHoursOnlyMode) {
              const isSmallMoto = (vehicleCategory === "motorcycle" || vehicleCategory === "atv" || vehicleCategory === "utv" || vehicleCategory === "snowmobile");

              // ── Motorcycle drive-chain correctness (deterministic) ───────────
              // Drive chain exists only on chain-driven bikes; the LLM is unreliable
              // about drive type, so this is the hard guard. (1) Known shaft/belt
              // models get every final-drive chain/sprocket task stripped. (2) Otherwise
              // all final-drive chain MAINTENANCE tasks collapse into one canonical entry
              // (the family matcher below is word-order sensitive and misses natural
              // titles). Chain REPLACEMENT stays distinct; primary/timing/cam chains and
              // cars are never touched. Scoped to motorcycles only (not ATV/UTV/snowmobile).
              if (vehicleCategory === "motorcycle" && validatedTasks) {
                const vt = validatedTasks;
                const NON_CHAIN_DRIVE: RegExp[] = [
                  /gold\s*wing/i, /\bgl1\d{3}\b/i, /\bvalkyrie\b/i, /\bst1\d{3}\b/i, /\bnt\d{3}\b/i, /deauville/i,
                  /moto\s*guzzi/i, /\bural\b/i,
                  /\bfjr\s?1300\b|\bfjr\b/i, /super\s*t[eé]n[eé]r[eé]|\bxt1200\b/i, /\bv-?max\b/i, /royal\s*star|\bventure\b/i,
                  /harley|h-?d\b|sportster|softail|street\s*glide|road\s*glide|road\s*king|fat\s*boy|electra\s*glide|\bdyna\b|\bflh|\bfxd|\bxl\d/i,
                  /\bindian\b|chieftain|roadmaster|\bscout\b|\bchief\b|springfield/i,
                  /\bbuell\b/i, /\bvulcan\b/i, /boulevard/i, /\bshadow\b/i,
                  // Shaft/belt models the LLM commonly mis-tags as chain (verified; no chain-bike overlap).
                  /concours/i, /\bgtr\s?14\d{2}\b/i, /\b14\d{2}\s?gtr\b/i,
                  /\bvfr\s?1200/i, /\bctx\s?1300\b/i, /pacific\s*coast/i,
                  /rocket\s*(iii|3\b)/i, /tiger\s*explorer/i, /\btiger\s?1200\b/i,
                  /roadliner|stratoliner|\braider\b|road\s*star|\bstryker\b|\beluder\b|star\s*venture|\bbolt\b/i,
                  /\bcavalcade\b/i, /\bvictory\b/i,
                ];
                const mkmdl = `${make} ${vehicleModel}`;
                const isBmwShaft = /\bbmw\b/i.test(mkmdl)
                  && (/\br\s?\d{2,4}/i.test(mkmdl) || /\bk\s?\d{3,4}/i.test(mkmdl) || /\br\s?9\s?t\b/i.test(mkmdl) || /\br\s?nine\s?t\b/i.test(mkmdl))
                  && !/\b[fg]\s?\d{2,4}/i.test(mkmdl)
                  && !/\bs\s?1000/i.test(mkmdl);
                const isNonChainDrive = NON_CHAIN_DRIVE.some((re) => re.test(mkmdl)) || isBmwShaft;
                const hasChainWord = (name: string): boolean => {
                  const n = name.toLowerCase();
                  if (/timing chain|cam chain|primary chain/.test(n)) return false;
                  return /\bchain\b/.test(n) || /sprocket/.test(n);
                };
                const isChainMaintenance = (name: string): boolean => {
                  if (!hasChainWord(name)) return false;
                  const n = name.toLowerCase();
                  return /clean|lube|lubric|adjust|tension|maintenance|service|inspect/.test(n) && !/replace/.test(n);
                };
                if (isNonChainDrive) {
                  validatedTasks = vt.filter((t) => !hasChainWord(t.task));
                } else {
                  const chainIdxs: number[] = [];
                  vt.forEach((t, i) => { if (isChainMaintenance(t.task)) chainIdxs.push(i); });
                  if (chainIdxs.length >= 1) {
                    let minMiles: number | null = null;
                    for (const ci of chainIdxs) {
                      const mi = vt[ci].interval_miles;
                      if (mi !== null && (minMiles === null || mi < minMiles)) minMiles = mi;
                    }
                    const keepIdx = chainIdxs[0];
                    const existingDesc = (vt[keepIdx].description ?? "").trim();
                    vt[keepIdx] = {
                      ...vt[keepIdx],
                      task: "Clean, Lubricate, and Adjust Chain",
                      description: existingDesc !== "" ? existingDesc : "Clean and lubricate drive chain, check and adjust tension. Recommended every 300-600 miles depending on riding conditions.",
                      interval_miles: minMiles !== null ? Math.max(minMiles, 300) : 500,
                      priority: "high",
                    };
                    const drop = new Set<number>(chainIdxs.slice(1));
                    validatedTasks = vt.filter((_, i) => !drop.has(i));
                  }
                }
              }

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
                { key: "spark_plugs", patterns: [/spark.*plug/i], canonical: "Replace Spark Plugs", description: "Replace spark plugs per manufacturer interval. Recommended every 3,000-7,500 miles for sport motorcycles, 7,500-16,000 miles for standard/touring bikes, 4,000-8,000 miles for small engines, longer for larger car engines." },
                { key: "air_filter", patterns: [/air.*filter/i], canonical: "Air Filter Cleaning and Replacement", description: "Clean or replace the air filter. Recommended every 3,000-6,000 miles depending on riding conditions." },
                { key: "cable_lube", patterns: [/cable.*lube/i, /cable.*lubric/i, /throttle.*cable/i, /clutch.*cable/i], canonical: "Lubricate Control Cables", description: "Lubricate throttle, clutch, and other control cables. Recommended every 3,000-6,000 miles or annually depending on conditions." },
                { key: "valve_clearance", patterns: [/valve.*clear/i, /valve.*check/i, /valve.*adjust/i, /valve.*inspect/i], canonical: "Check and Adjust Valve Clearance", description: "Check and adjust valve clearances per manufacturer spec. Recommended every 7,500-16,000 miles depending on engine type.", priorityOverride: "high" },
                { key: "battery", patterns: [/battery.*maintain/i, /battery.*check/i, /battery.*inspect/i, /battery.*replace/i, /battery.*service/i], canonical: "Battery Inspection and Maintenance", description: "Check battery terminals, voltage, and electrolyte level. Clean connections and charge as needed." },
                { key: "fork_oil", patterns: [/fork.*oil/i, /fork.*seal/i, /front.*fork.*service/i, /fork.*service/i], canonical: "Replace Fork Oil", description: "Replace fork oil and inspect seals. Recommended every 10,000-15,000 miles or every 2 years.", priorityOverride: "medium" },
                { key: "fuel_system", patterns: [/fuel.*system/i, /fuel.*inject.*clean/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "suspension_generic", patterns: [/suspension.*inspect/i, /shock.*inspect/i, /rear.*shock/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "hardware", patterns: [/engine.*mount/i, /hardware.*check/i, /fastener/i, /bolt.*torque/i], canonical: "", description: "", remove: true },
                { key: "steering_bearing", patterns: [/steering.*head.*bearing/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "wheel_bearing", patterns: [/wheel.*bearing/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "general_inspection", patterns: [/general.*inspect/i, /safety.*inspect/i, /multi.*point/i], canonical: "", description: "", remove: true },
                { key: "winterization", patterns: [/winteriz/i], canonical: "", description: "", remove: true, removeCondition: () => vehicleCategory === "motorcycle" || vehicleCategory === "atv" || vehicleCategory === "utv" },
              ];

              // Step 1: Map each task to a family
              // EV: skip the battery family entirely so distinct traction/12V battery
              // tasks are neither collapsed nor renamed to lead-acid canonicals.
              const activeFamilies = isEvFuel ? families.filter(f => f.key !== "battery") : families;
              const matched = new Set<number>();
              const familyGroups = new Map<number, number[]>();

              for (let fi = 0; fi < activeFamilies.length; fi++) {
                const fam = activeFamilies[fi];
                for (let ti = 0; ti < validatedTasks.length; ti++) {
                  if (matched.has(ti)) continue;
                  if (fam.patterns.some(p => p.test(validatedTasks![ti].task))) {
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
                const fam = activeFamilies[fi];
                if (fam.remove) {
                  if (!fam.removeCondition || fam.removeCondition()) continue;
                }
                const keepIdx = taskIdxs[0];
                keepIndexes.add(keepIdx);
                const ov: Partial<ValidatedTask> = {};
                if (fam.canonical) ov.task = fam.canonical;
                // Loosen: keep the model-specific AI description; only fall back to the
                // generic family description when the AI provided none. Preserves model
                // differentiation (a Panigale no longer reads like a Gold Wing).
                if (fam.description && !(validatedTasks[keepIdx].description ?? '').trim()) ov.description = fam.description;
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

              // Loosen: keep unmatched tasks for ALL vehicles, including small motos.
              // Known junk is already stripped by the explicit remove families above
              // (hardware, general_inspection, steering/wheel bearing, etc.), so
              // surviving unmatched tasks are model-specific real services.
              for (let i = 0; i < validatedTasks.length; i++) {
                if (!matched.has(i)) keepIndexes.add(i);
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
                    const pa = validatedTasks![a].priority === "high" ? 3 : validatedTasks![a].priority === "medium" ? 2 : 1;
                    const pb = validatedTasks![b].priority === "high" ? 3 : validatedTasks![b].priority === "medium" ? 2 : 1;
                    return pa - pb;
                  });
                  let adjusted = 0;
                  for (const idx of sortedIdxs) {
                    if (adjusted >= idxs.length - 2) break;
                    if (PROTECTED_NAMES.includes(validatedTasks[idx].task) || /brake/i.test(validatedTasks[idx].task) || /timing.*belt/i.test(validatedTasks[idx].task)) continue;
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

            // ══════════════════════════════════════════════════════════════
            // UNIVERSAL CLEANUP: trim + name-dedup for ALL vehicles
            // (mileage vehicles already went through the full family pipeline
            //  above; hours vehicles only get these lightweight passes)
            // ══════════════════════════════════════════════════════════════
            if (validatedTasks) {
              // Trim to max 18 tasks (preserve high-priority first)
              if (validatedTasks.length > 18) {
                const scored = validatedTasks.map((t, i) => {
                  const priScore = t.priority === "high" ? 3 : t.priority === "medium" ? 2 : 1;
                  return { idx: i, score: priScore };
                });
                scored.sort((a, b) => a.score - b.score);
                const removeCount = validatedTasks.length - 18;
                const removeIdxs = new Set(scored.slice(0, removeCount).map((s: { idx: number; score: number }) => s.idx));
                validatedTasks = validatedTasks.filter((_: ValidatedTask, i: number) => !removeIdxs.has(i));
              }
              // Deduplicate by normalized name
              const seenNames = new Set<string>();
              validatedTasks = validatedTasks.filter((t: ValidatedTask) => {
                const k = t.task.toLowerCase().trim();
                if (seenNames.has(k)) return false;
                seenNames.add(k);
                return true;
              });
              if (isHoursOnlyMode && validatedTasks.length < 5) {
                console.warn(`[POST-PROCESS] Hours vehicle: only ${validatedTasks.length} tasks after cleanup`);
              }
            }

            if (validatedTasks.length >= 5) {
              await adminClient.from("ai_schedule_cache").upsert({ cache_key: cacheKey, vehicle_desc: vehicleDesc, vehicle_category: vehicleCategory, fuel_type: effectiveFuel, tasks_json: JSON.stringify(validatedTasks), task_count: validatedTasks.length }, { onConflict: "cache_key" });
            }
          }
        }
      }

      if (validatedTasks && validatedTasks.length >= 5) {
        const aiTasksToInsert = validatedTasks.map(t => ({
          user_id: authUserId, vehicle_id, template_id: null,
          name: t.task, description: t.description, category: t.category,
          interval_miles: t.interval_miles, interval_hours: t.interval_hours, interval_months: t.interval_months,
          last_completed_date: null, last_completed_miles: null, last_completed_hours: null,
          next_due_miles: (!isHoursOnlyMode && t.interval_miles !== null) ? Math.round(resolvedCurrentMileage) + t.interval_miles : null,
          next_due_hours: (isHoursCapableMode && t.interval_hours !== null) ? Math.round(resolvedCurrentHours) + t.interval_hours : null,
          next_due_date: t.interval_months !== null ? addMonths(today, t.interval_months).toISOString() : null,
          status: "upcoming", priority: t.priority, is_custom: false, source: "ai",
        }));
        const { error: aiInsertErr } = await adminClient.rpc("replace_vehicle_schedule", {
          p_vehicle_id: vehicle_id,
          p_user_id: authUserId,
          p_clear_non_custom: isForceRefresh,
          p_tasks: aiTasksToInsert,
        });
        if (!aiInsertErr) {
          const edgeFnSecret = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
          let estimatesCached = 0;
          let estimateWarning: string | undefined;
          if (!edgeFnSecret) {
            console.error("[ESTIMATES] EDGE_FUNCTION_SECRET is not set — skipping cost estimate generation. Set this secret in Supabase dashboard.");
            estimateWarning = "Cost estimates were not generated because EDGE_FUNCTION_SECRET is not configured.";
          } else {
            const estimateUrl = `${supabaseUrl}/functions/v1/estimate-repair-cost`;
            const estimateHeaders: Record<string, string> = { "Content-Type": "application/json", "x-edge-secret": supabaseServiceKey, "Authorization": `Bearer ${supabaseServiceKey}` };
            const estimateNames = aiTasksToInsert.map((t: any) => (t.name as string).toLowerCase().trim());
            const BATCH = 5;
            for (let i = 0; i < estimateNames.length; i += BATCH) {
              const batch = estimateNames.slice(i, i + BATCH);
              const results = await Promise.allSettled(batch.map(svc =>
                fetch(estimateUrl, {
                  method: "POST",
                  headers: estimateHeaders,
                  body: JSON.stringify({ year, make, model: vehicleModel, service_name: svc, vehicle_type: effectiveFuel }),
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
      if (aiBlockErr instanceof Error && aiBlockErr.name === "AbortError") {
        console.error("[AI BLOCK] AI call timed out, falling back to templates");
      } else {
        console.error("[AI BLOCK] Error, falling back to templates:", aiBlockErr instanceof Error ? aiBlockErr.message : aiBlockErr);
      }
    }

    // ── TEMPLATE FALLBACK ──────────────────────────────────────────────
    // NOTE: For hours-tracked assets, template fallback produces TIME-ONLY tasks
    // (interval_months + next_due_date). Hours intervals are only generated by
    // the AI path. This is intentional — mileage templates cannot be safely
    // reinterpreted as engine hours.
    if (isHoursOnlyMode) {
      console.warn(`[TEMPLATE FALLBACK] Hours-tracked asset ${vehicleCategory} falling back to time-only templates. AI generation failed or was unavailable.`);
    }


    // ── 5. Determine which vehicle_type values to query ────────────────────
    // Note: `maintenance_templates.vehicle_type` is used in this project for fuel-type-aware templates.
    // We add extra fuel-type template sets when a vehicle_type (category) requires them.
    // Time-only asset classes (trailer / dump trailer / dumpster) have their own
    // dedicated template sets and never inherit car/fuel/AWD templates (Packet B).
    const isTimeOnlyAssetClass = TIME_ONLY_TYPES.has(vehicleCategory);
    const typeSet = isTimeOnlyAssetClass
      ? new Set<string>(vehicleCategory === "dump_trailer" ? ["trailer", "dump_trailer"] : [vehicleCategory])
      : new Set<string>(["all", effectiveFuel]);
    if (!isTimeOnlyAssetClass && effectiveFuel === "hybrid") {
      // Hybrid schedules should behave like gas schedules, with a few targeted additions.
      typeSet.add("gas");
    }
    const typeArray = Array.from(typeSet);
    // AWD driveline templates are mechanical AWD items; EVs must not inherit them.
    if (!isTimeOnlyAssetClass && resolvedIsAwd && effectiveFuel !== "ev") typeArray.push("awd_4wd");

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
      console.error("[FALLBACK-EMPTY] no templates fetched", { vehicle_id, vehicleCategory, effectiveFuel, trackingMode, resolvedIsAwd, isForceRefresh });
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
      // OVERRIDE semantics: a match adjusts intervals; unmatched templates are KEPT as-is.
      { miles: 10000, months: 12, match: [/engine oil/i] },
      { miles: 15000, months: 12, match: [/fuel filter/i] },
      { miles: 5000, months: 6, match: [/\bdef\b/i, /diesel exhaust fluid/i] },
      { miles: 100000, months: null, match: [/diesel particulate filter/i, /\bdpf\b/i] },
      { miles: 60000, months: null, match: [/glow plug/i] },
      { miles: 60000, months: 48, match: [/coolant flush/i] },
      { miles: 10000, months: 12, match: [/tire rotation/i] },
      { miles: 30000, months: 36, match: [/transmission fluid/i] },
    ];

    const evRules: IntervalRule[] = [
      // OVERRIDE semantics: only rules that CHANGE template values; everything else
      // keeps template / make-override values.
      { miles: 25000, months: 24, match: [/brake fluid/i] },
      { miles: 15000, months: 12, match: [/cabin air filter/i] },
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

    // Trailer / dump-trailer / dumpster tasks now come from dedicated
    // maintenance_templates rows (vehicle_type = category); the old rule
    // whitelists were removed (Packet B).

    const isDumpTruck = vehicleCategory === "dump_truck" || vehicleCategory === "standard_dump" || vehicleCategory === "roll_off" || vehicleCategory === "hook_lift";
    const isRollOff = vehicleCategory === "roll_off";
    const isHookLift = vehicleCategory === "hook_lift";
    const isDiesel = effectiveFuel === "diesel";
    const isEv = effectiveFuel === "ev";
    const isHybrid = effectiveFuel === "hybrid";

    // OVERRIDE mode: rule match adjusts intervals; unmatched templates are KEPT.
    // Time-only asset classes take their intervals from their dedicated template
    // rows (Packet B); fuel-based overrides never apply to them.
    const overrideRules: IntervalRule[] | null = isTimeOnlyAssetClass
      ? null
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

    function findRule(rules: IntervalRule[], taskName: string): IntervalRule | null {
      for (const rule of rules) {
        if (rule.match.some(re => re.test(taskName))) return rule;
      }
      return null;
    }

    const shouldDedupByTaskName = isTimeOnlyAssetClass || overrideRules !== null || isHybrid;

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

    // Two-pass: templates SURVIVING make-exclusions, known before the insertion loop,
    // so hybrid superseded-pair suppression cannot orphan a service.
    const survivingNames = new Set<string>();
    for (const template of filteredTemplates) {
      const t0 = template as Record<string, unknown>;
      const o0 = overrideMap.get(t0.id as string);
      if (o0 && (o0.is_excluded as boolean) === true) continue;
      survivingNames.add(t0.task as string);
    }
    const HYBRID_SUPERSEDED = new Map<string, string>([
      ["Spark Plug Replacement", "Spark Plug Replacement (Hybrid)"],
      ["Transmission Fluid (Automatic)", "Transmission Fluid (Hybrid/CVT)"],
    ]);

    // Category safety clamps are FINAL for explicitly routed non-car categories.
    // Never applied to the car/truck default (gas-car fallback stays byte-identical).
    const clampFallbackCategory =
      vehicleCategory === "motorcycle" || vehicleCategory === "atv" || vehicleCategory === "utv" ||
      vehicleCategory === "snowmobile" || vehicleCategory === "boat" || vehicleCategory === "pwc" ||
      SMALL_EQUIPMENT_CATS.has(vehicleCategory) || HEAVY_EQUIPMENT_CATS.has(vehicleCategory);
    const fallbackClamps = getClampsForCategory(vehicleCategory);

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

      // EV: strip ICE-only tasks that would otherwise survive override mode.
      if (isEv && (isIceOnly(taskName) || taskName === "Engine Air Filter" || taskName === "Coolant Flush")) continue;

      // Hybrid: gas rows superseded by a SURVIVING hybrid variant are suppressed.
      if (isHybrid) {
        const replacementName = HYBRID_SUPERSEDED.get(taskName);
        if (replacementName && survivingNames.has(replacementName)) continue;
      }

      if (overrideRules) {
        const rule = findRule(overrideRules, taskName);
        if (rule) {
          resolvedMiles = rule.miles;
          resolvedMonths = rule.months;
        }
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

      // Category clamps applied AFTER all interval resolution - clamps are final authority.
      if (clampFallbackCategory) {
        const clamped = clampTask(
          {
            task: taskName,
            description: "",
            category: "",
            interval_miles: isHoursOnlyMode ? null : resolvedMiles,
            interval_hours: null,
            interval_months: resolvedMonths,
            priority: "",
          },
          fallbackClamps,
        );
        resolvedMiles = clamped.interval_miles;
        resolvedMonths = clamped.interval_months;
      }

      // Universal guard: never insert a task with no schedulable dimension.
      // (Fallback never emits hours; hours-only mode nulls miles at insert.)
      const finalGuardMiles = isHoursOnlyMode ? null : resolvedMiles;
      const hasMilesDim = finalGuardMiles !== null && finalGuardMiles > 0;
      const hasMonthsDim = resolvedMonths !== null && resolvedMonths > 0;
      if (!hasMilesDim && !hasMonthsDim) continue;

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
        interval_miles: isHoursOnlyMode ? null : resolvedMiles,
        interval_hours: null,  // Template fallback does not generate hours intervals — only AI path does
        interval_months: resolvedMonths,
        last_completed_date: null,
        last_completed_miles: null,
        last_completed_hours: null,
        next_due_miles: isHoursOnlyMode ? null : nextDueMiles,
        next_due_hours: null,  // Template fallback uses time-only intervals for hours assets
        next_due_date: nextDueDate,
        status: "upcoming",
        priority: t.priority as string,
        is_custom: false,
        source: "template",
      });
    }

    if (tasksToInsert.length === 0) {
      console.error("[FALLBACK-EMPTY] zero tasks after filtering", { vehicle_id, vehicleCategory, effectiveFuel, trackingMode, resolvedIsAwd, isForceRefresh });
      return json({ success: true, tasks_created: 0, vehicle_id }, 200);
    }

    // ── 10. Batch insert all tasks ─────────────────────────────────────────
    const { error: insertError } = await adminClient.rpc("replace_vehicle_schedule", {
      p_vehicle_id: vehicle_id,
      p_user_id: authUserId,
      p_clear_non_custom: isForceRefresh,
      p_tasks: tasksToInsert,
    });
    if (insertError) return json({ error: "Failed to generate schedule", detail: insertError.message }, 500);
    const tplEdgeFnSecret = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
    let tplEstimatesCached = 0;
    let tplEstimateWarning: string | undefined;
    if (!tplEdgeFnSecret) {
      console.error("[ESTIMATES] EDGE_FUNCTION_SECRET is not set — skipping cost estimate generation. Set this secret in Supabase dashboard.");
      tplEstimateWarning = "Cost estimates were not generated because EDGE_FUNCTION_SECRET is not configured.";
    } else {
      const tplEstimateUrl = `${supabaseUrl}/functions/v1/estimate-repair-cost`;
      const tplEstimateHeaders: Record<string, string> = { "Content-Type": "application/json", "x-edge-secret": supabaseServiceKey, "Authorization": `Bearer ${supabaseServiceKey}` };
      const tplEstimateNames = tasksToInsert.map((t: any) => (t.name as string).toLowerCase().trim());
      const TPL_BATCH = 5;
      for (let i = 0; i < tplEstimateNames.length; i += TPL_BATCH) {
        const batch = tplEstimateNames.slice(i, i + TPL_BATCH);
        const results = await Promise.allSettled(batch.map(svc =>
          fetch(tplEstimateUrl, {
            method: "POST",
            headers: tplEstimateHeaders,
            body: JSON.stringify({ year, make, model: vehicleModel, service_name: svc, vehicle_type: effectiveFuel }),
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
    if (err instanceof AuthError) {
      return json({ error: err.message }, err.status);
    }
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    if (err instanceof PremiumGateError) {
      return json({ error: err.message }, err.status);
    }
    console.error("Unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Failed to generate schedule", detail: message }, 500);
  } finally {
    if (releaseClaim) {
      try {
        await releaseClaim();
      } catch (relErr) {
        console.error("[CLAIM] release error:", relErr instanceof Error ? relErr.message : relErr);
      }
    }
  }
});

