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
    // "automobile" is the legacy DB default for the car category. Normalised
    // here so every consumer — prompt, routing, cache key — sees one name.
    const rawVehicleCategory = typeof vehicle_category === "string" ? vehicle_category : "car";
    const vehicleCategory = rawVehicleCategory === "automobile" ? "car" : rawVehicleCategory;

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

    // effectiveFuel is the single source of truth for ALL downstream fuel-dependent logic.
    const DUMP_CATEGORIES = new Set(["dump_truck", "standard_dump", "roll_off", "hook_lift"]);
    // Battery-electric models sold under mixed-fuel makes. The app defaults fuel
    // to "gas" for these, and real Ioniq 5/6 owners were served an oil change
    // as a result. The deterministic list wins over user input. Scoped to road
    // cars/trucks so an equipment name like "Leaf Blower" can never match.
    const EV_MODELS: RegExp[] = [
      /ioniq\s*[56]/i, /\bev[69]\b/i, /kona\s*electric/i, /niro\s*ev/i, /\bbolt\s*(ev|euv)\b/i,
      /\bleaf\b/i, /\bariya\b/i, /mach-?e/i, /f-?150\s*lightning/i, /\bid\.?\s*(4|buzz)\b/i,
      /e-?tron/i, /\beq[abcesv]\b/i, /bz4x/i, /solterra/i, /polestar/i, /taycan/i, /cruise\s*origin/i,
      /silverado\s*ev/i, /blazer\s*ev/i, /equinox\s*ev/i, /hummer\s*ev/i, /lyriq/i, /prologue/i,
      /\bmodel\s*[3sxy]\b/i, /\b(500e|mini\s*electric|cooper\s*se)\b/i,
    ];
    // BMW i3/i4/iX only — the bare pattern would match too many other makes.
    const BMW_I_MODEL = /\bi[34x]\b(?!\d)/i;
    const isKnownEvModel = (vehicleCategory === "car" || vehicleCategory === "truck")
      && (EV_MODELS.some((re) => re.test(`${make} ${vehicleModel}`))
        || (/\bbmw\b/i.test(make) && BMW_I_MODEL.test(vehicleModel)));
    // Dump-truck categories default to diesel maintenance ONLY when the client
    // sent no fuel at all; an explicit "gas" (7.3L gas dump bodies exist) is respected.
    const clientSentFuel = typeof fuel_type === "string" || typeof vehicle_type === "string";
    const effectiveFuel = isKnownEvModel
      ? "ev"
      : (DUMP_CATEGORIES.has(vehicleCategory) && !clientSentFuel ? "diesel" : resolvedVehicleType);

    // ── Deterministic drivetrain facts (cars) ─────────────────────────────
    // Same contract as the motorcycle drive lists: a verified list outranks
    // the user's is_awd flag, which outranks the AI declaration, which fills
    // gaps only. Year-conditional entries need year < maxYear (year is a
    // validated integer above, so a "missing year" cannot arise). The `not`
    // guards keep AWD variants that share a name (GR Corolla, Corolla Cross,
    // Accord Crosstour) off the FWD-only list — a miss there would strip a real
    // differential service, so every guard fails safe toward "unknown".
    interface FwdOnlyEntry { re: RegExp; not?: RegExp; maxYear?: number }
    const FWD_ONLY_MODELS: FwdOnlyEntry[] = [
      { re: /odyssey/i }, { re: /\bcivic\b/i }, { re: /corolla/i, not: /\bgr\b|cross/i }, { re: /sonata/i }, { re: /elantra/i },
      { re: /\bmaxima\b/i }, { re: /\baccord\b/i, not: /crosstour/i }, { re: /\bfit\b/i }, { re: /\bversa\b/i }, { re: /\bsentra\b/i },
      { re: /\bcamry\b/i, maxYear: 2020 }, { re: /\baltima\b/i, maxYear: 2019 }, { re: /prius/i, maxYear: 2019 }, { re: /\bjetta\b/i, maxYear: 2018 },
    ];
    type CarDrivetrain = "fwd" | "rwd" | "awd" | "4wd" | "unknown";
    const CAR_CONFIG_CATEGORIES = new Set(["car", "truck", "rv", "semi_truck"]);
    const isCarConfigCategory = CAR_CONFIG_CATEGORIES.has(vehicleCategory);
    const isFwdOnlyModel = isCarConfigCategory && FWD_ONLY_MODELS.some((e) => {
      const mkmdl = `${make} ${vehicleModel}`;
      if (!e.re.test(mkmdl)) return false;
      if (e.not && e.not.test(mkmdl)) return false;
      if (e.maxYear !== undefined && !(year < e.maxYear)) return false;
      return true;
    });
    // Pre-AI resolution: list, then is_awd, else unknown. This — and ONLY
    // this — feeds the cache key, because the key is computed before
    // generation; the AI declaration can never reach it (resolveCarDrivetrain
    // below layers the declaration on top for the strips only).
    const preAiDrivetrain: CarDrivetrain = isFwdOnlyModel ? "fwd" : (resolvedIsAwd ? "awd" : "unknown");

    // Preload mode removed (closes PASS-B-004). Auth is mandatory below.

    // ── Category exclusion map ─────────────────────────────────────────────
    // Exact template names, plus regexes where a whole family is impossible for
    // the category. Consulted by the template fallback AND (since epoch 4) the
    // AI path — see AI_PATH_EXCLUSION_SKIP for the two entries that are template-
    // only because the AI legitimately emits them.
    const CATEGORY_EXCLUSIONS: Record<string, (string | RegExp)[]> = {
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
        /tire/i,
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
    // Entries the AI path must NOT enforce: boats have spark plugs (the boat
    // list was written to filter car template rows), and belt-cam Ducatis
    // really do have a timing belt service.
    const AI_PATH_EXCLUSION_SKIP: Record<string, string[]> = {
      boat: ["Spark Plug Replacement"],
      motorcycle: ["Timing Belt Replacement"],
    };
    function matchesExclusion(name: string, e: string | RegExp): boolean {
      return e instanceof RegExp ? e.test(name) : e.trim().toLowerCase() === name.trim().toLowerCase();
    }

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
    // Car-config categories append the PRE-AI drivetrain (deterministic list
    // + is_awd only — never the declared value, which does not exist yet), so
    // AWD and FWD variants of one model never share a row. Other categories'
    // keys are unchanged beyond the epoch.
    const cacheKeyBase = `v2|${year}|${make}|${vehicleModel}|${vehicleCategory}|${effectiveFuel}|${trackingMode}${isCarConfigCategory ? `|${preAiDrivetrain}` : ""}`.toLowerCase().trim();

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
      // A task whose name satisfies `exclude` never matches this entry, however
      // well `match` fits. Keeps the engine-oil entries off non-engine
      // lubricants and the chain entries off primary/cam/timing chains.
      exclude?: (name: string) => boolean;
      max_months?: number;
      min_months?: number;
      max_miles?: number;
      min_miles?: number;
      max_hours?: number;
      min_hours?: number;
    }
    interface RequiredTask {
      match: RegExp[];
      // See IntervalClamp.exclude. A task the entry excludes cannot satisfy the
      // entry either, so the real required service is still injected.
      exclude?: (name: string) => boolean;
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
      { match: [/brake.*fluid/i], max_months: 24, min_months: 12, max_miles: 15000 },
      // Coolant: most air-cooled bikes lack it; liquid-cooled mfrs say 2-3 years.
      { match: [/coolant/i], max_months: 24, min_months: 12, max_miles: 24000 },
      // Oil: Kawasaki ZX-10R/Yamaha R1 say every 3,750 mi or 6 mo. Cap at 6 mo (not 12) for safety.
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], exclude: (n) => isNonEngineLubricantName(n), max_months: 6, max_miles: 4000, min_miles: 2000 },
      // Chain lube: most chain manufacturers say every 300-400 mi; 500 mi is the absolute max.
      { match: [/chain.*clean/i, /chain.*lube/i, /chain.*lubrication/i, /chain maintenance/i], exclude: (n) => /timing|cam\b|primary/i.test(n), max_months: 1, max_miles: 500, min_miles: 200 },
      // Chain tension: Kawasaki says every 600 mi; 3,000 mi is a reasonable outer bound.
      { match: [/chain.*adjust/i, /chain.*tension/i], exclude: (n) => /timing|cam\b|primary/i.test(n), max_months: 6, max_miles: 3000, min_miles: 600 },
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
      { match: [/brake.*fluid/i], max_months: 24, min_months: 12, max_miles: 30000 },
      // Coolant: traditional green = 2 yr/30k mi; long-life OAT = 5 yr/150k. Cap at 3 yr/60k (conservative middle ground).
      { match: [/coolant/i], max_months: 36, min_months: 12, max_miles: 60000 },
      // Oil: conventional = 3,000-5,000 mi / 6 mo. Already tightened last pass.
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], exclude: (n) => isNonEngineLubricantName(n), max_months: 6, max_miles: 7500, min_miles: 3000 },
      // Transmission fluid: most mfrs recommend 30,000-45,000 mi for conventional ATF/MTF.
      { match: [/transmission.*fluid/i], max_months: 36, max_miles: 45000 },
      // Brake pad inspection: most mfrs say every 12,000-15,000 mi or annually. 20,000 mi cap is conservative.
      { match: [/brake.*pad/i, /brake.*inspection/i], max_months: 12, max_miles: 20000 },
      // Tire rotation: most mfrs say every 5,000-7,500 mi. Cap at 7,500 mi.
      { match: [/tire.*rotation/i], max_months: 6, max_miles: 7500, min_miles: 3000 },
      // Tire pressure/condition check: a safety item; never rarer than a rotation.
      { match: [/tire.*(pressure|inspect|check|condition)/i], max_months: 6, max_miles: 7500 },
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
    const BOAT_CLAMPS: IntervalClamp[] = [
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
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], exclude: (n) => isNonEngineLubricantName(n), task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter per manufacturer spec", category: "Engine", interval_miles: 4000, interval_hours: null, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid to maintain stopping performance", category: "Brakes", interval_miles: null, interval_hours: null, interval_months: 24, priority: "high" },
      { match: [/valve.*check/i, /valve.*clearance/i, /valve.*adjust/i, /valve.*inspection/i], task: "Valve Check / Adjustment", description: "Check and adjust valve clearances per manufacturer spec", category: "Engine", interval_miles: 15000, interval_hours: null, interval_months: 24, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads for wear and replace if needed", category: "Brakes", interval_miles: 7500, interval_hours: null, interval_months: 12, priority: "high" },
      { match: [/tire.*inspect/i, /tire.*check/i, /tire.*wear/i, /tire.*pressure/i], task: "Tire Inspection", description: "Inspect tires for wear, damage, and proper pressure", category: "Safety", interval_miles: 3000, interval_hours: null, interval_months: 3, priority: "high" },
    ];
    const CAR_TRUCK_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], exclude: (n) => isNonEngineLubricantName(n), task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: 5000, interval_hours: null, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid", category: "Brakes", interval_miles: null, interval_hours: null, interval_months: 24, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads and rotors for wear", category: "Brakes", interval_miles: 20000, interval_hours: null, interval_months: 12, priority: "high" },
      { match: [/tire.*rotation/i], task: "Tire Rotation", description: "Rotate tires for even wear", category: "Tires", interval_miles: 7500, interval_hours: null, interval_months: 6, priority: "medium" },
      // The /cabin/ requirement means an engine-filter task can never satisfy this entry.
      { match: [/cabin.*(air.*)?filter/i], task: "Cabin Air Filter Replacement", description: "Replace the cabin air filter. Typical interval 15,000 miles or annually; confirm against your owner's manual.", category: "General", interval_miles: 15000, interval_hours: null, interval_months: 12, priority: "medium" },
    ];
    const BOAT_REQUIRED: RequiredTask[] = [
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

    // ── Category-specific tables added in epoch 4 ─────────────────────────
    // Snowmobile: months-only requireds. 2-stroke vs 4-stroke is unknowable
    // here, so no oil-change/valve requireds and no stripping of AI oil/valve
    // tasks either; tires are impossible and are excluded by name above.
    const SNOWMOBILE_CLAMPS: IntervalClamp[] = [
      { match: [/chaincase/i], max_months: 24 },
      { match: [/drive\s*belt/i], max_months: 12 },
    ];
    const SNOWMOBILE_REQUIRED: RequiredTask[] = [
      { match: [/chaincase/i], task: "Chaincase Oil Change", description: "Drain and refill chaincase oil. Typically annually; confirm against your owner's manual.", category: "Drivetrain", interval_miles: null, interval_hours: null, interval_months: 12, priority: "medium" },
      { match: [/drive\s*belt/i], task: "Drive Belt Inspection", description: "Inspect the drive belt for cracks, glazing, and width loss; replace as needed.", category: "Drivetrain", interval_miles: null, interval_hours: null, interval_months: 12, priority: "medium" },
      { match: [/track.*tension/i, /hyfax/i, /slide/i], task: "Track Tension and Slide (Hyfax) Inspection", description: "Check track tension and alignment; inspect slides (hyfax) for wear.", category: "Drivetrain", interval_miles: null, interval_hours: null, interval_months: 12, priority: "medium" },
      { match: [/spark\s*plug/i], task: "Replace Spark Plugs", description: "Replace spark plugs per manufacturer interval.", category: "Engine", interval_miles: null, interval_hours: null, interval_months: 24, priority: "medium" },
    ];
    // PWC: a jet drive has no lower unit, so the boat gear-oil clamp and
    // required are dropped. Engine oil is left to the model (vintage 2-strokes).
    const PWC_CLAMPS: IntervalClamp[] = BOAT_CLAMPS.filter((c) => !c.match.some((re) => re.test("lower unit")));
    const PWC_REQUIRED: RequiredTask[] = [
      { match: [/jet\s*pump/i, /wear\s*ring/i], task: "Jet Pump and Wear Ring Inspection", description: "Inspect the jet pump, impeller, and wear ring for damage and clearance; check pump bearing oil where applicable.", category: "Drivetrain", interval_miles: null, interval_hours: 50, interval_months: 12, priority: "medium" },
      { match: [/spark\s*plug/i], task: "Replace Spark Plugs", description: "Replace spark plugs per manufacturer interval.", category: "Engine", interval_miles: null, interval_hours: 100, interval_months: 24, priority: "medium" },
    ];
    // Heavy road (semi trucks, dump trucks): manufacturer intervals run 10-50k
    // mi for oil and far beyond for fluids; air brakes mean no brake fluid,
    // and duals are not rotated on a car cadence.
    const HEAVY_ROAD_CLAMPS: IntervalClamp[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], exclude: (n) => isNonEngineLubricantName(n), max_months: 12, max_miles: 50000 },
      { match: [/coolant/i], max_months: 60, max_miles: 300000 },
      { match: [/transmission.*fluid/i], max_months: 60, max_miles: 300000 },
      { match: [/differential.*fluid/i, /axle.*fluid/i, /rear.*axle/i], max_months: 60, max_miles: 250000 },
    ];
    const HEAVY_ROAD_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], exclude: (n) => isNonEngineLubricantName(n), task: "Engine Oil and Filter Change", description: "Heavy-duty interval varies 10,000-50,000 mi by duty cycle; confirm against your maintenance schedule.", category: "Engine", interval_miles: 25000, interval_hours: null, interval_months: 12, priority: "high" },
    ];
    // RV: the car set minus tire rotation, plus the roof — the single most
    // common RV failure point.
    const RV_CLAMPS: IntervalClamp[] = CAR_TRUCK_CLAMPS.filter((c) => !c.match.some((re) => re.test("tire rotation")));
    const RV_REQUIRED: RequiredTask[] = [
      ...CAR_TRUCK_REQUIRED.filter((r) => r.task !== "Tire Rotation"),
      { match: [/roof/i], task: "Inspect Roof Seals and Seams", description: "Inspect all roof seams, vents, and sealant for cracks or separation; reseal as needed.", category: "Body", interval_miles: null, interval_hours: null, interval_months: 12, priority: "high" },
    ];
    // Diesel: no spark plugs or ignition coils exist; a fuel filter / water
    // separator service always does on road diesels.
    const DIESEL_STRIP: RegExp[] = [/spark\s*plug/i, /ignition\s*coil/i];
    const DIESEL_REQUIRED: RequiredTask[] = [
      { match: [/fuel.*filter/i, /water.*separator/i], task: "Fuel Filter / Water Separator Service", description: "Replace the fuel filter and drain the water separator. Typical interval 10,000-20,000 miles or annually; confirm against your maintenance schedule.", category: "Engine", interval_miles: 15000, interval_hours: null, interval_months: 12, priority: "high" },
    ];

    // ── Explicit routing — no fall-through ────────────────────────────────
    // Every category the app can send is named here. Anything unlisted gets
    // EMPTY clamps and EMPTY requireds; the old default to the car tables is
    // what put an engine oil change on a dump trailer.
    type RouteKey = "car" | "moto" | "snowmobile" | "boat" | "pwc" | "small" | "heavy" | "heavy_road" | "rv" | "none";
    const CATEGORY_ROUTING: Record<string, RouteKey> = {
      car: "car", truck: "car",
      motorcycle: "moto", atv: "moto", utv: "moto",
      snowmobile: "snowmobile",
      boat: "boat", pwc: "pwc",
      semi_truck: "heavy_road",
      rv: "rv",
      trailer: "none", dump_trailer: "none", dumpster: "none", other: "none",
    };
    for (const c of SMALL_EQUIPMENT_CATS) CATEGORY_ROUTING[c] = "small";
    for (const c of HEAVY_EQUIPMENT_CATS) CATEGORY_ROUTING[c] = "heavy";
    for (const c of DUMP_CATEGORIES) CATEGORY_ROUTING[c] = "heavy_road";
    const ROUTE_CLAMPS: Record<RouteKey, IntervalClamp[]> = {
      car: CAR_TRUCK_CLAMPS, moto: MOTORCYCLE_CLAMPS, snowmobile: SNOWMOBILE_CLAMPS, boat: BOAT_CLAMPS, pwc: PWC_CLAMPS,
      small: SMALL_EQUIPMENT_CLAMPS, heavy: HEAVY_EQUIPMENT_CLAMPS, heavy_road: HEAVY_ROAD_CLAMPS, rv: RV_CLAMPS, none: [],
    };
    const ROUTE_REQUIRED: Record<RouteKey, RequiredTask[]> = {
      car: CAR_TRUCK_REQUIRED, moto: MOTORCYCLE_REQUIRED, snowmobile: SNOWMOBILE_REQUIRED, boat: BOAT_REQUIRED, pwc: PWC_REQUIRED,
      small: SMALL_EQUIPMENT_REQUIRED, heavy: HEAVY_EQUIPMENT_REQUIRED, heavy_road: HEAVY_ROAD_REQUIRED, rv: RV_REQUIRED, none: [],
    };
    // Road diesels that get DIESEL_REQUIRED on top of their category set.
    const DIESEL_REQUIRED_ROUTES = new Set<RouteKey>(["car", "heavy_road", "rv"]);
    function routeFor(cat: string): RouteKey {
      return Object.prototype.hasOwnProperty.call(CATEGORY_ROUTING, cat) ? CATEGORY_ROUTING[cat] : "none";
    }
    function getClampsForCategory(cat: string): IntervalClamp[] {
      return ROUTE_CLAMPS[routeFor(cat)];
    }
    function getRequiredForCategory(cat: string): RequiredTask[] {
      const route = routeFor(cat);
      const base = ROUTE_REQUIRED[route];
      return effectiveFuel === "diesel" && DIESEL_REQUIRED_ROUTES.has(route) ? [...base, ...DIESEL_REQUIRED] : base;
    }
    function clampTask(t: ValidatedTask, clamps: IntervalClamp[]): ValidatedTask {
      for (const c of clamps) {
        if (c.exclude && c.exclude(t.task)) continue;
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
    // Equipment-only extension of the ICE guard: an electric mower or forklift
    // has no air filter, while an EV car keeps its cabin filter. Consulted only
    // for the small/heavy equipment routes, so ICE_ONLY itself is unchanged.
    const ICE_ONLY_EQUIPMENT_EXTRA: RegExp[] = [/\bair\s*filter\b/i];
    const isEquipmentRoute = (cat: string) => { const r = routeFor(cat); return r === "small" || r === "heavy"; };
    const isIceOnlyFor = (name: string, cat: string) => isIceOnly(name) || (isEquipmentRoute(cat) && ICE_ONLY_EQUIPMENT_EXTRA.some(re => re.test(name)));
    const isDieselStripName = (name: string) => effectiveFuel === "diesel" && DIESEL_STRIP.some(re => re.test(name));
    // Hoisted from the post-processing block so it participates in the rules
    // hash and has a single definition. Behaviour unchanged.
    const PROTECTED_NAMES = ["Engine Oil and Filter Change", "Clean, Lubricate, and Adjust Chain", "Inspect Brake Pads", "Check Tire Pressure and Condition", "Check and Adjust Valve Clearance"];

    // ── Motorcycle drivetrain correctness (deterministic) ─────────────────
    // A bike's final drive is chain, belt, or shaft, and the services differ
    // completely. The model is unreliable about drive type, so drive type is
    // decided here and enforced on every path that can produce a schedule:
    // the cache-hit path, the fresh-generation path (early AND late), and the
    // template fallback. Hoisted so all four share one definition, and folded
    // into the rules hash below so changing a list invalidates cached rows.
    // Function declarations, not consts: the clamp/required tables above are
    // initialised earlier in this block and reference the name classifiers.

    // Verified CHAIN-drive models whose names fall inside a belt/shaft/ambiguous
    // family. Checked FIRST so a family pattern can never mis-strip them.
    // NOTE: Buell 1125R/CR is factory BELT and stays covered by /\bbuell\b/i —
    // no 1125 exception. Honda Shadow Spirit/Phantom are SHAFT, so the Shadow
    // family stays in the ambiguous list rather than becoming an exception.
    const CHAIN_DRIVE_EXCEPTIONS: RegExp[] = [
      /pan\s*america/i, /\bra1250\b/i,
      /\bftr\b/i,
      /\bebr\b/i, /\b1190\s?(rx|sx|rs)\b/i,
      /\bx\s?350\b/i, /\bx\s?440\b/i,
      /vulcan\s*s\b/i,
      /\bvlx\b/i,
    ];

    // SHAFT final drive: gear oil service, never chain, never belt.
    const SHAFT_DRIVE_MODELS: RegExp[] = [
      /gold\s*wing/i, /\bgl1\d{3}\b/i, /\bvalkyrie\b/i, /\bst1\d{3}\b/i, /\bnt\d{3}\b/i, /deauville/i,
      /moto\s*guzzi/i, /\bural\b/i,
      /\bfjr\s?1300\b|\bfjr\b/i, /super\s*t[eé]n[eé]r[eé]|\bxt1200\b/i, /\bv-?max\b/i,
      /concours/i, /\bgtr\s?14\d{2}\b/i, /\b14\d{2}\s?gtr\b/i,
      /\bvfr\s?1200/i, /\bctx\s?1300\b/i, /pacific\s*coast/i,
      /rocket\s*(iii|3\b)/i, /tiger\s*explorer/i, /\btiger\s?1200\b/i,
      /\bcavalcade\b/i, /\bventure\b/i,
    ];

    // BELT final drive: belt inspection/tension, never chain, never gear oil.
    const BELT_DRIVE_MODELS: RegExp[] = [
      /harley|h-?d\b|sportster|softail|street\s*glide|road\s*glide|road\s*king|fat\s*boy|electra\s*glide|\bdyna\b|\bflh|\bfxd|\bxl\d/i,
      /\bindian\b|chieftain|roadmaster|\bscout\b|\bchief\b|springfield/i,
      /\bbuell\b/i, /\bvictory\b/i,
      /\bf\s?800\s?(gt|st)\b/i,
      /roadliner/i, /stratoliner/i, /\braider\b/i, /road\s*star/i, /\bstryker\b/i, /\beluder\b/i, /\bbolt\b/i,
    ];

    // Drive varies by year/variant within these families (e.g. Shadow Spirit is
    // shaft, Shadow Phantom is shaft, Vulcan S is chain). Strip final-drive
    // chain tasks — always wrong for the shaft/belt majority — but inject
    // nothing, because we cannot tell shaft from belt without the variant.
    const AMBIGUOUS_NON_CHAIN_MODELS: RegExp[] = [/\bvulcan\b/i, /boulevard/i, /\bshadow\b/i];

    const FINAL_DRIVE_TASKS: { shaft: ValidatedTask; belt: ValidatedTask } = {
      shaft: { task: "Change Final Drive Gear Oil", description: "Drain and refill the final drive (shaft) gear oil. Typical interval 12,000-16,000 miles or 2 years; confirm against your owner's manual.", category: "Drivetrain", interval_miles: 12000, interval_hours: null, interval_months: 24, priority: "medium" },
      belt: { task: "Inspect Final Drive Belt", description: "Inspect drive belt tension and condition for cracks, missing teeth, and wear; adjust tension per spec. Typical interval 5,000 miles or annually; confirm against your owner's manual.", category: "Drivetrain", interval_miles: 5000, interval_hours: null, interval_months: 12, priority: "medium" },
    };

    // BMW: R and K twins/fours are shaft; F/G singles and parallel twins and the
    // S1000 family are chain (the F800GT/ST are belt, handled by the belt list —
    // reachable only because the F exclusion keeps them out of shaft).
    function isBmwShaftDrive(mkmdl: string): boolean {
      return /\bbmw\b/i.test(mkmdl)
        && (/\br\s?\d{2,4}/i.test(mkmdl) || /\bk\s?\d{3,4}/i.test(mkmdl) || /\br\s?9\s?t\b/i.test(mkmdl) || /\br\s?nine\s?t\b/i.test(mkmdl))
        && !/\b[fg]\s?\d{2,4}/i.test(mkmdl)
        && !/\bs\s?1000/i.test(mkmdl);
    }

    // TIGHT. Confirmed final-drive lubricant services only — used for reciprocal
    // stripping and for the "is it already there?" injection check. A generic
    // "Gear Oil Change" or a gearbox/transmission oil task must NOT qualify.
    function isFinalDriveOilName(n: string): boolean {
      return /(final|rear|shaft)\s*drive/i.test(n) && /\boil\b|fluid|lube/i.test(n);
    }
    // TIGHT. Confirmed final-drive belt services only. A CVT/transmission belt
    // (e.g. a BMW C650 scooter) must NOT qualify.
    function isFinalDriveBeltName(n: string): boolean {
      return /\bbelt\b/i.test(n) && /(drive|final)/i.test(n) && !/serpentine|timing|accessory|transmission|cvt|variator|primary/i.test(n);
    }
    // BROAD. Any lubricant service that is NOT engine oil — the exclusion for the
    // engine-oil matchers only. A combined service that names engine oil
    // explicitly ("Engine Oil and Transmission Oil Change" on a shared sump)
    // stays eligible; a generic "Gear Oil Change" stays excluded.
    function isNonEngineLubricantName(n: string): boolean {
      return (/\bgear\b|gearbox|transmission|differential|(final|rear|shaft)\s*drive/i.test(n)) && !/engine\s*oil|motor\s*oil/i.test(n);
    }
    function hasChainWord(name: string): boolean {
      const n = name.toLowerCase();
      if (/timing chain|cam chain|primary chain/.test(n)) return false;
      return /\bchain\b/.test(n) || /sprocket/.test(n);
    }
    function isChainMaintenance(name: string): boolean {
      if (!hasChainWord(name)) return false;
      const n = name.toLowerCase();
      return /clean|lube|lubric|adjust|tension|maintenance|service|inspect/.test(n) && !/replace/.test(n);
    }

    type DriveType = "chain" | "shaft" | "belt" | "ambiguous" | "unknown";
    // Order is load-bearing. Exceptions win over every family; "Royal Star" is
    // shaft and must be settled before the belt-drive "Star Venture" (2018+),
    // which in turn must be settled before the shaft list's bare /venture/.
    function detectDriveType(mk: string, mdl: string): DriveType {
      const mkmdl = `${mk} ${mdl}`;
      if (CHAIN_DRIVE_EXCEPTIONS.some((re) => re.test(mkmdl))) return "chain";
      if (/royal\s*star/i.test(mkmdl)) return "shaft";
      if (/star\s*venture/i.test(mkmdl)) return "belt";
      if (SHAFT_DRIVE_MODELS.some((re) => re.test(mkmdl)) || isBmwShaftDrive(mkmdl)) return "shaft";
      if (BELT_DRIVE_MODELS.some((re) => re.test(mkmdl))) return "belt";
      if (AMBIGUOUS_NON_CHAIN_MODELS.some((re) => re.test(mkmdl))) return "ambiguous";
      return "unknown";
    }

    // ── AI-declared configuration facts (motorcycles) ─────────────────────
    // The drive-type lists close one instance of a wider error class: the model
    // emitting service for a component this bike does not have — coolant on an
    // air-cooled Harley, a carb sync on a fuel-injected bike, a throttle-body
    // service on a carbureted one. Verified lists cannot scale to every model,
    // so the model DECLARES the configuration alongside its tasks and the
    // strips below enforce it deterministically. "unknown" is inert: it never
    // implies a component is present OR absent, and strips nothing.
    interface DeclaredConfig {
      final_drive: "chain" | "belt" | "shaft" | "unknown";
      cooling: "liquid" | "air" | "air_oil" | "unknown";
      fuel_system: "carburetor" | "fuel_injection" | "unknown";
    }
    // Never throws. Any missing, non-string, or off-allowlist value — and any
    // malformed config object at all — degrades to "unknown", which strips
    // nothing, so a bad declaration can only cost us enforcement, never tasks.
    function normalizeDeclaredConfig(raw: unknown): DeclaredConfig {
      const out: DeclaredConfig = { final_drive: "unknown", cooling: "unknown", fuel_system: "unknown" };
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      const r = raw as Record<string, unknown>;
      const norm = (v: unknown): string => (typeof v === "string" ? v.toLowerCase().trim() : "");
      const fd = norm(r.final_drive);
      if (fd === "chain" || fd === "belt" || fd === "shaft") out.final_drive = fd;
      const cl = norm(r.cooling);
      if (cl === "liquid" || cl === "air" || cl === "air_oil") out.cooling = cl;
      const fs = norm(r.fuel_system);
      if (fs === "carburetor" || fs === "fuel_injection") out.fuel_system = fs;
      return out;
    }

    const COOLANT_TASK_PATTERNS: RegExp[] = [/coolant/i, /antifreeze/i];
    // Radiator is handled apart from the coolant patterns: an air-cooled or
    // air/oil-cooled bike carries no coolant radiator but very often carries an
    // OIL cooler, which manuals and the model alike title "oil radiator". That
    // is a real service on exactly the bikes this strip targets, so it is
    // excluded by name rather than lost to a bare /radiator/ match.
    const RADIATOR_PATTERN = /radiator/i;
    const OIL_COOLER_EXCLUSION = /oil\s*(cooler|radiator)|oil-?cooled/i;
    const CARB_TASK_PATTERNS: RegExp[] = [/carburet/i, /\bcarb\s*(sync|clean|adjust|rebuild|service)/i, /\bjetting\b/i];
    const EFI_TASK_PATTERNS: RegExp[] = [/fuel\s*inject/i, /\binjector/i, /throttle\s*bod(y|ies)/i];

    // Removals only. Never adds a task, so it can never re-create something the
    // EV guard or the drivetrain strip already removed, and never contradicts
    // them. Each axis is independent; "unknown" (and "liquid") strip nothing.
    function applyConfigStrip(tasks: ValidatedTask[], config: DeclaredConfig): ValidatedTask[] {
      let out = tasks;
      if (config.cooling === "air" || config.cooling === "air_oil") {
        out = out.filter((t) => !COOLANT_TASK_PATTERNS.some((re) => re.test(t.task)));
        out = out.filter((t) => !(RADIATOR_PATTERN.test(t.task) && !OIL_COOLER_EXCLUSION.test(t.task)));
      }
      if (config.fuel_system === "fuel_injection") {
        out = out.filter((t) => !CARB_TASK_PATTERNS.some((re) => re.test(t.task)));
      } else if (config.fuel_system === "carburetor") {
        out = out.filter((t) => !EFI_TASK_PATTERNS.some((re) => re.test(t.task)));
      }
      return out;
    }

    // The deterministic verified lists ALWAYS outrank the AI declaration: a
    // model on a list is settled, and a confident wrong declaration cannot
    // override it. The declaration only fills the gap the lists leave — the
    // "unknown" and "ambiguous" models, which is where the strip has been
    // doing nothing (unknown) or half the job (ambiguous: strip, never inject).
    function resolveDriveType(mk: string, mdl: string, config: DeclaredConfig): DriveType {
      const d = detectDriveType(mk, mdl);
      if (d === "chain" || d === "shaft" || d === "belt") return d;
      if (config.final_drive === "chain" || config.final_drive === "belt" || config.final_drive === "shaft") return config.final_drive;
      return d;
    }

    // ── AI-declared configuration facts (cars, ATV/UTV, trailers) ────────
    // Sibling shapes to DeclaredConfig with the same contract: allowlist,
    // lowercase/trim, never throw, "unknown" on anything else and "unknown"
    // strips nothing. The motorcycle block above is untouched.
    interface CarConfig {
      drivetrain: CarDrivetrain;
      transmission: "manual" | "automatic" | "cvt" | "dct" | "unknown";
      timing_drive: "belt" | "chain" | "unknown";
      powertrain: "ice" | "hybrid" | "phev" | "bev" | "unknown";
    }
    interface AtvConfig { final_drive: "chain" | "shaft" | "cvt_shaft" | "unknown" }
    interface TrailerConfig { brake_type: "electric_drum" | "electric_hydraulic" | "hydraulic_surge" | "none" | "unknown" }
    const UNKNOWN_CAR_CONFIG: CarConfig = { drivetrain: "unknown", transmission: "unknown", timing_drive: "unknown", powertrain: "unknown" };
    const UNKNOWN_ATV_CONFIG: AtvConfig = { final_drive: "unknown" };
    const UNKNOWN_TRAILER_CONFIG: TrailerConfig = { brake_type: "unknown" };
    const normField = (raw: Record<string, unknown>, key: string): string => {
      const v = raw[key];
      return typeof v === "string" ? v.toLowerCase().trim() : "";
    };
    function normalizeCarConfig(raw: unknown): CarConfig {
      const out: CarConfig = { ...UNKNOWN_CAR_CONFIG };
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      const r = raw as Record<string, unknown>;
      const dt = normField(r, "drivetrain");
      if (dt === "fwd" || dt === "rwd" || dt === "awd" || dt === "4wd") out.drivetrain = dt;
      const tr = normField(r, "transmission");
      if (tr === "manual" || tr === "automatic" || tr === "cvt" || tr === "dct") out.transmission = tr;
      const td = normField(r, "timing_drive");
      if (td === "belt" || td === "chain") out.timing_drive = td;
      const pt = normField(r, "powertrain");
      if (pt === "ice" || pt === "hybrid" || pt === "phev" || pt === "bev") out.powertrain = pt;
      return out;
    }
    function normalizeAtvConfig(raw: unknown): AtvConfig {
      const out: AtvConfig = { ...UNKNOWN_ATV_CONFIG };
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      const fd = normField(raw as Record<string, unknown>, "final_drive");
      if (fd === "chain" || fd === "shaft" || fd === "cvt_shaft") out.final_drive = fd;
      return out;
    }
    function normalizeTrailerConfig(raw: unknown): TrailerConfig {
      const out: TrailerConfig = { ...UNKNOWN_TRAILER_CONFIG };
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      const bt = normField(raw as Record<string, unknown>, "brake_type");
      if (bt === "electric_drum" || bt === "electric_hydraulic" || bt === "hydraulic_surge" || bt === "none") out.brake_type = bt;
      return out;
    }

    // ATV/UTV deterministic final-drive lists. Youth Sportsman/Grizzly are
    // chain, so they are guarded out of the shaft list; RZR 170 / Ranger 150 /
    // ACE 150 are chain UTVs; Pioneer / Talon / YXZ are geared or DCT with no
    // CVT belt. Lists win, the declaration fills gaps, and "cvt_shaft" is only
    // the UTV default when nothing else is known.
    const ATV_SHAFT_MODELS: RegExp[] = [/sportsman(?!\s*(90|110)\b)/i, /\bforeman\b/i, /grizzly(?!\s*(80|90|125)\b)/i, /king\s*quad/i, /\brubicon\b/i, /\brancher\b/i, /kodiak/i];
    const ATV_CHAIN_MODELS: RegExp[] = [/\braptor\b/i, /\byfz\b/i, /\btrx\s*[24]50r?\b/i, /\bbanshee\b/i, /\bltr\b/i, /\bltz\b/i, /\brzr\s*170\b/i, /\branger\s*150\b/i, /\bace\s*150\b/i];
    const UTV_SHAFT_NO_CVT_MODELS: RegExp[] = [/\bpioneer\b/i, /\btalon\b/i, /\byxz\b/i];
    const isAtvConfigCategory = vehicleCategory === "atv" || vehicleCategory === "utv";
    const isTrailerConfigCategory = vehicleCategory === "trailer" || vehicleCategory === "dump_trailer";
    function resolveAtvDrive(cfg: AtvConfig): AtvConfig["final_drive"] {
      const mkmdl = `${make} ${vehicleModel}`;
      if (ATV_CHAIN_MODELS.some((re) => re.test(mkmdl))) return "chain";
      if (UTV_SHAFT_NO_CVT_MODELS.some((re) => re.test(mkmdl))) return "shaft";
      if (ATV_SHAFT_MODELS.some((re) => re.test(mkmdl))) return "shaft";
      if (cfg.final_drive !== "unknown") return cfg.final_drive;
      return vehicleCategory === "utv" ? "cvt_shaft" : "unknown";
    }
    // List, then is_awd (both already folded into preAiDrivetrain), then the
    // declaration. The declaration can only fill "unknown".
    function resolveCarDrivetrain(cfg: CarConfig): CarDrivetrain {
      return preAiDrivetrain !== "unknown" ? preAiDrivetrain : cfg.drivetrain;
    }

    // Strip tables. Every strip is an additive removal; "unknown" is inert.
    const FWD_STRIP_PATTERNS: RegExp[] = [/rear\s*diff/i, /transfer\s*case/i];
    // Honda calls front halfshafts "driveshafts", so a bare /driveshaft/ would
    // strip a real FWD service; only a driveshaft task with no CV/axle/boot
    // wording is a propshaft that a FWD car cannot have.
    const FWD_DRIVESHAFT = /driveshaft/i;
    const FWD_DRIVESHAFT_KEEP = /boot|\bcv\b|axle|half\s*shaft/i;
    const TIMING_BELT_PATTERN = /timing\s*belt/i;
    const TRANSMISSION_WORD = /transmission|gearbox/i;
    const AUTO_TYPE_WORD = /\b(automatic|cvt|dct)\b/i;
    const MANUAL_TYPE_WORD = /\bmanual\b/i;
    const CLUTCH_FLUID_PATTERN = /clutch\s*fluid/i;
    const TRAILER_BRAKE_FLUID = /brake\s*fluid/i;
    const TRAILER_BRAKE_ANY = /brake/i;
    // Brake lights and their wiring exist on every trailer, braked or not.
    const TRAILER_BRAKE_KEEP = /light|lamp|wiring|connector/i;
    const CVT_BELT_PRESENT = /\bcvt\b|drive\s*belt/i;
    const CVT_BELT_TASK: ValidatedTask = { task: "Inspect CVT Drive Belt", description: "Inspect the CVT drive belt for cracks, glazing, and width loss; replace as needed. Typical interval 1,000 miles or annually; confirm against your owner's manual.", category: "Drivetrain", interval_miles: 1000, interval_hours: null, interval_months: 12, priority: "medium" };

    function applyCarConfigStrip(tasks: ValidatedTask[], cfg: CarConfig): ValidatedTask[] {
      if (!isCarConfigCategory) return tasks;
      let out = tasks;
      if (resolveCarDrivetrain(cfg) === "fwd") {
        out = out.filter((t) => !FWD_STRIP_PATTERNS.some((re) => re.test(t.task)) && !(FWD_DRIVESHAFT.test(t.task) && !FWD_DRIVESHAFT_KEEP.test(t.task)));
      }
      if (cfg.timing_drive === "chain") out = out.filter((t) => !TIMING_BELT_PATTERN.test(t.task));
      if (cfg.transmission === "manual") {
        out = out.filter((t) => !(TRANSMISSION_WORD.test(t.task) && AUTO_TYPE_WORD.test(t.task)));
      } else if (cfg.transmission === "automatic" || cfg.transmission === "cvt" || cfg.transmission === "dct") {
        out = out.filter((t) => !(CLUTCH_FLUID_PATTERN.test(t.task) || (TRANSMISSION_WORD.test(t.task) && MANUAL_TYPE_WORD.test(t.task))));
      }
      // Declared BEV: the same ICE strip the EV_MODELS list drives, as a
      // belt-and-suspenders behind that list. The required-task skips honour
      // the aiDeclaredBev flag set at parse time (and read back from the cache
      // row's fuel_type), so nothing removed here is re-injected.
      if (cfg.powertrain === "bev") out = out.filter((t) => !isIceOnly(t.task));
      return out;
    }
    function applyAtvConfigStrip(tasks: ValidatedTask[], cfg: AtvConfig): ValidatedTask[] {
      if (!isAtvConfigCategory) return tasks;
      const d = resolveAtvDrive(cfg);
      return d === "shaft" || d === "cvt_shaft" ? tasks.filter((t) => !hasChainWord(t.task)) : tasks;
    }
    // The one addition in this layer, kept apart from the strips so their
    // removal-only contract stays intact.
    function injectAtvBeltService(tasks: ValidatedTask[], cfg: AtvConfig): ValidatedTask[] {
      if (!isAtvConfigCategory || resolveAtvDrive(cfg) !== "cvt_shaft") return tasks;
      return tasks.some((t) => CVT_BELT_PRESENT.test(t.task)) ? tasks : [...tasks, { ...CVT_BELT_TASK }];
    }
    function applyTrailerConfigStrip(tasks: ValidatedTask[], cfg: TrailerConfig): ValidatedTask[] {
      if (!isTrailerConfigCategory) return tasks;
      if (cfg.brake_type === "electric_drum") return tasks.filter((t) => !TRAILER_BRAKE_FLUID.test(t.task));
      if (cfg.brake_type === "none") return tasks.filter((t) => !(TRAILER_BRAKE_ANY.test(t.task) && !TRAILER_BRAKE_KEEP.test(t.task)));
      return tasks;
    }

    // Removes drivetrain services that cannot exist on this bike, in both
    // directions, then collapses surviving final-drive chain MAINTENANCE tasks
    // into one canonical entry (the family matcher is word-order sensitive and
    // misses natural titles). Chain REPLACEMENT stays distinct; primary/cam/
    // timing chains are never touched, because hasChainWord already excludes
    // them. Motorcycles only — ATV/UTV/snowmobile and cars are untouched.
    function applyDrivetrainStrip(tasks: ValidatedTask[], mk: string, mdl: string, declaredConfig?: DeclaredConfig): ValidatedTask[] {
      if (vehicleCategory !== "motorcycle") return tasks;
      // No config passed (cache-hit path, template fallback): detectDriveType
      // only, exactly as before.
      const driveType = declaredConfig ? resolveDriveType(mk, mdl, declaredConfig) : detectDriveType(mk, mdl);
      if (driveType === "shaft") return tasks.filter((t) => !hasChainWord(t.task) && !isFinalDriveBeltName(t.task));
      if (driveType === "belt") return tasks.filter((t) => !hasChainWord(t.task) && !isFinalDriveOilName(t.task));
      if (driveType === "ambiguous") return tasks.filter((t) => !hasChainWord(t.task));

      let out = driveType === "chain"
        ? tasks.filter((t) => !isFinalDriveBeltName(t.task) && !isFinalDriveOilName(t.task))
        : tasks;

      const chainIdxs: number[] = [];
      out.forEach((t, i) => { if (isChainMaintenance(t.task)) chainIdxs.push(i); });
      if (chainIdxs.length >= 1) {
        let minMiles: number | null = null;
        for (const ci of chainIdxs) {
          const mi = out[ci].interval_miles;
          if (mi !== null && (minMiles === null || mi < minMiles)) minMiles = mi;
        }
        const keepIdx = chainIdxs[0];
        const existingDesc = (out[keepIdx].description ?? "").trim();
        const merged = out.slice();
        merged[keepIdx] = {
          ...merged[keepIdx],
          task: "Clean, Lubricate, and Adjust Chain",
          description: existingDesc !== "" ? existingDesc : "Clean and lubricate drive chain, check and adjust tension. Recommended every 300-600 miles depending on riding conditions.",
          interval_miles: minMiles !== null ? Math.max(minMiles, 300) : 500,
          priority: "high",
        };
        const drop = new Set<number>(chainIdxs.slice(1));
        out = merged.filter((_, i) => !drop.has(i));
      }
      return out;
    }

    // Adds the final-drive service the bike actually needs, when the schedule
    // does not already carry a real one. A seal service, an inspection, or a
    // generic "service" does not count as a gear-oil change; a replace-only
    // belt task does not count as a belt inspection.
    function injectFinalDriveService(tasks: ValidatedTask[], mk: string, mdl: string, declaredConfig?: DeclaredConfig): ValidatedTask[] {
      if (vehicleCategory !== "motorcycle") return tasks;
      // Injection for an AI-resolved shaft/belt bike is allowed: the existence
      // checks below are what prevent a duplicate, not the source of the type.
      const driveType = declaredConfig ? resolveDriveType(mk, mdl, declaredConfig) : detectDriveType(mk, mdl);
      if (driveType === "shaft") {
        const present = tasks.some((t) => isFinalDriveOilName(t.task) && /change|replace|drain|flush/i.test(t.task));
        return present ? tasks : [...tasks, { ...FINAL_DRIVE_TASKS.shaft }];
      }
      if (driveType === "belt") {
        const present = tasks.some((t) => isFinalDriveBeltName(t.task) && /inspect|tension|adjust|check/i.test(t.task));
        return present ? tasks : [...tasks, { ...FINAL_DRIVE_TASKS.belt }];
      }
      return tasks;
    }

    // -- Rules-versioned cache key -----------------------------------------
    // A cached schedule is only as current as the rules that shaped it. The
    // hash covers the rules DATA (required tables, clamps, exclusions,
    // ICE_ONLY, protected names, category sets); RULES_EPOCH covers rules
    // LOGIC - bump it whenever code in the generation/post-processing region
    // changes semantics without changing this data. Spurious invalidation
    // costs one model call; missing invalidation is the defect this fixes.
    const RULES_EPOCH = 5;
    const serializeRules = (v: unknown): unknown => {
      if (v instanceof RegExp) return String(v);
      if (v instanceof Set) return Array.from(v).sort();
      if (Array.isArray(v)) return v.map(serializeRules);
      if (v && typeof v === "object") {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort()) o[k] = serializeRules((v as Record<string, unknown>)[k]);
        return o;
      }
      return v;
    };
    const rulesBlob = JSON.stringify(serializeRules({
      epoch: RULES_EPOCH,
      required: ROUTE_REQUIRED,
      clamps: ROUTE_CLAMPS,
      routing: CATEGORY_ROUTING,
      fuel: { evModels: EV_MODELS, bmwIModel: BMW_I_MODEL, dieselStrip: DIESEL_STRIP, dieselRequired: DIESEL_REQUIRED, dieselRequiredRoutes: DIESEL_REQUIRED_ROUTES },
      exclusions: CATEGORY_EXCLUSIONS,
      aiPathExclusionSkip: AI_PATH_EXCLUSION_SKIP,
      iceOnly: ICE_ONLY,
      iceOnlyEquipmentExtra: ICE_ONLY_EQUIPMENT_EXTRA,
      protectedNames: PROTECTED_NAMES,
      carConfig: { fwdOnly: FWD_ONLY_MODELS, categories: CAR_CONFIG_CATEGORIES, strips: { fwd: FWD_STRIP_PATTERNS, driveshaft: FWD_DRIVESHAFT, driveshaftKeep: FWD_DRIVESHAFT_KEEP, timingBelt: TIMING_BELT_PATTERN, transmission: TRANSMISSION_WORD, autoType: AUTO_TYPE_WORD, manualType: MANUAL_TYPE_WORD, clutchFluid: CLUTCH_FLUID_PATTERN }, allow: ["fwd", "rwd", "awd", "4wd", "manual", "automatic", "cvt", "dct", "belt", "chain", "ice", "hybrid", "phev", "bev", "unknown"] },
      atvConfig: { shaft: ATV_SHAFT_MODELS, chain: ATV_CHAIN_MODELS, utvShaftNoCvt: UTV_SHAFT_NO_CVT_MODELS, cvtBeltPresent: CVT_BELT_PRESENT, cvtBeltTask: CVT_BELT_TASK, allow: ["chain", "shaft", "cvt_shaft", "unknown"] },
      trailerConfig: { brakeFluid: TRAILER_BRAKE_FLUID, brakeAny: TRAILER_BRAKE_ANY, brakeKeep: TRAILER_BRAKE_KEEP, allow: ["electric_drum", "electric_hydraulic", "hydraulic_surge", "none", "unknown"] },
      cats: { small: SMALL_EQUIPMENT_CATS, heavy: HEAVY_EQUIPMENT_CATS, dump: DUMP_CATEGORIES },
      drivetrain: { exceptions: CHAIN_DRIVE_EXCEPTIONS, shaft: SHAFT_DRIVE_MODELS, belt: BELT_DRIVE_MODELS, ambiguous: AMBIGUOUS_NON_CHAIN_MODELS, finalDrive: FINAL_DRIVE_TASKS, configStrip: { coolant: COOLANT_TASK_PATTERNS, radiator: RADIATOR_PATTERN, oilCoolerExclusion: OIL_COOLER_EXCLUSION, carb: CARB_TASK_PATTERNS, efi: EFI_TASK_PATTERNS, allow: ["chain", "belt", "shaft", "unknown", "liquid", "air", "air_oil", "carburetor", "fuel_injection"] } },
    }));
    let rulesHash = 0x811c9dc5;
    for (let i = 0; i < rulesBlob.length; i++) {
      rulesHash ^= rulesBlob.charCodeAt(i);
      rulesHash = Math.imul(rulesHash, 0x01000193) >>> 0;
    }
    const RULES_VERSION = rulesHash.toString(16).padStart(8, "0");
    function validateAndEnforce(tasks: ValidatedTask[], vCat: string): ValidatedTask[] {
      const clamps = getClampsForCategory(vCat);
      const required = getRequiredForCategory(vCat);
      let v = tasks.map(t => ({ ...clampTask(t, clamps), category: normalizeCategory(t.category), priority: normalizePriority(t.priority) }));
      v = v.filter(t => t.task.trim() !== "" && (t.interval_miles !== null || t.interval_hours !== null || t.interval_months !== null));
      // Category exclusions, enforced on the AI path too (epoch 4). Removes only
      // what the category's own list names, minus the template-only entries.
      const excludedForCat = CATEGORY_EXCLUSIONS[vCat] ?? [];
      const aiSkipForCat = AI_PATH_EXCLUSION_SKIP[vCat] ?? [];
      v = v.filter(t => !excludedForCat.some(e => !aiSkipForCat.some(sk => sk === e) && matchesExclusion(t.task, e)));
      if (isEvFuel || aiDeclaredBev) v = v.filter(t => !isIceOnlyFor(t.task, vCat));
      if (effectiveFuel === "diesel") v = v.filter(t => !isDieselStripName(t.task));
      for (const req of required) {
        if ((isEvFuel || aiDeclaredBev) && isIceOnlyFor(req.task, vCat)) continue;
        if (isDieselStripName(req.task)) continue;
        if (!v.some(t => !(req.exclude && req.exclude(t.task)) && req.match.some(re => re.test(t.task)))) {
          v.push({ task: req.task, description: req.description, category: normalizeCategory(req.category), interval_miles: req.interval_miles, interval_hours: req.interval_hours, interval_months: req.interval_months, priority: normalizePriority(req.priority) });
        }
      }
      const seen = new Set<string>();
      v = v.filter(t => { const k = t.task.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
      return v;
    }

    const cacheKey = `${cacheKeyBase}|r${RULES_VERSION}`;

    /**
     * Inject-if-missing + name dedupe, and NOTHING else. Deliberately not
     * validateAndEnforce: no clamps, no normalisation, no interval changes -
     * so deliberately-set fuel/make intervals survive (the diesel 10,000-mi
     * rotation would otherwise be clamped to the gas 7,500). Idempotent by
     * construction: it appends only when every match regex misses, and each
     * canonical task name satisfies its own regexes, so a rerun appends
     * nothing. Closure-captures isEvFuel/isIceOnly so the EV guard cannot
     * drift from validateAndEnforce's.
     */
    function ensureRequiredTasks(tasks: ValidatedTask[], vCat: string): ValidatedTask[] {
      const required = getRequiredForCategory(vCat);
      const out = tasks.slice();
      for (const req of required) {
        if ((isEvFuel || aiDeclaredBev) && isIceOnlyFor(req.task, vCat)) continue;
        if (isDieselStripName(req.task)) continue;
        if (!out.some(t => !(req.exclude && req.exclude(t.task)) && req.match.some(re => re.test(t.task)))) {
          out.push({ task: req.task, description: req.description, category: normalizeCategory(req.category), interval_miles: req.interval_miles, interval_hours: req.interval_hours, interval_months: req.interval_months, priority: normalizePriority(req.priority) });
        }
      }
      const seen = new Set<string>();
      return out.filter(t => { const k = t.task.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    // Gates on schedule size must reflect what generation PRODUCED, not what
    // injection added, or an EV whose model output was thin would newly pass
    // the 5-task gate and cache a sparse schedule instead of falling through
    // to the richer template path.
    let preInjectionTaskCount = 0;
    // Set when the model declares powertrain "bev" for a car the EV_MODELS
    // list missed (parse time), or when a cache row was stored under that
    // declaration (its fuel_type column reads "ev" while effectiveFuel does
    // not). Read by the EV strip and both required-task skips above.
    let aiDeclaredBev = false;

    let aiSuccess = false;
    try {
      const { data: cached } = await adminClient.from("ai_schedule_cache").select("tasks_json, fuel_type").eq("cache_key", cacheKey).maybeSingle();
      let validatedTasks: ValidatedTask[] | null = null;

      if (cached?.tasks_json) {
        try {
          const raw = JSON.parse(cached.tasks_json) as ValidatedTask[];
          validatedTasks = Array.isArray(raw)
            ? raw.map((t) => ({ ...t, interval_hours: t.interval_hours ?? null, interval_miles: t.interval_miles ?? null }))
            : null;
          if (validatedTasks) {
            // A cached row is only as current as the rules that shaped it;
            // the versioned key handles rule-data changes, and this repairs
            // any row that still slips through with a required task missing.
            preInjectionTaskCount = validatedTasks.length;
            aiDeclaredBev = !isEvFuel && cached.fuel_type === "ev";
            validatedTasks = ensureRequiredTasks(validatedTasks, vehicleCategory);
            // Same drivetrain guarantee the fresh path gets. A cached row can
            // predate these rules or have been shaped by a model that guessed
            // the drive type wrong, so it is corrected on the way out too.
            validatedTasks = applyDrivetrainStrip(validatedTasks, make, vehicleModel);
            validatedTasks = injectFinalDriveService(validatedTasks, make, vehicleModel);
            // Deterministic-only pass of the car/ATV layer (no declaration on
            // this path): the FWD list, is_awd, and the ATV/UTV lists.
            validatedTasks = applyCarConfigStrip(validatedTasks, UNKNOWN_CAR_CONFIG);
            validatedTasks = applyAtvConfigStrip(validatedTasks, UNKNOWN_ATV_CONFIG);
            validatedTasks = injectAtvBeltService(validatedTasks, UNKNOWN_ATV_CONFIG);
          }
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
        const currentUsageDesc = isTimeOnlyMode
          ? "Usage: not tracked (time-based asset)"
          : isHoursAsset
            ? `Current engine hours: ${resolvedCurrentHours}`
            : `Current mileage: ${resolvedCurrentMileage}`;
        // Time-only assets (trailers, dumpsters) have no usage meter at all.
        // Every fragment below is the empty string / the original text for
        // every other tracking mode, so those prompts are byte-for-byte unchanged.
        const timeOnlyContext = isTimeOnlyMode ? `
CRITICAL: This is a time-tracked asset (e.g., trailer, dumpster) with no usage meter.
- Use time-based intervals ONLY (interval_months); set interval_miles and interval_hours to null for every task
` : "";
        const intervalRule = isTimeOnlyMode
          ? "- Use time-based intervals ONLY (interval_months); set interval_miles and interval_hours to null"
          : `- Include BOTH ${usageWord}-based AND time-based intervals for every task (whichever comes first)`;
        const intervalExample = isTimeOnlyMode ? "6 months" : (isHoursAsset ? "50 hours" : "3000 miles");
        const intervalRequirement = isTimeOnlyMode ? "interval_months" : `at least one of ${intervalField} or interval_months`;

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

        // Motorcycle-only prompt additions. The prompt is shared by every
        // vehicle category, so both interpolations below are inert for the
        // others: motoConfigRules is the empty string and outputSpec is the
        // original bare-array specification, byte for byte.
        const isMotorcyclePrompt = vehicleCategory === "motorcycle";
        const motoConfigRules = isMotorcyclePrompt ? `
- The "config" block must state this exact model's real configuration. If you are not certain of a fact, use "unknown" — never guess. Do not include services for a system whose presence you marked "unknown".
- Air-cooled and air/oil-cooled motorcycles have no coolant service. Fuel-injected motorcycles have no carburetor service. Carbureted motorcycles have no fuel-injection or throttle-body service.` : "";
        // Category-gated config blocks (epoch 5), same mechanism: every
        // fragment is the empty string for categories without a config, so
        // their prompts — and the motorcycle prompt — are byte-for-byte unchanged.
        const categoryConfigRules = isCarConfigCategory ? `
- The "config" block must state this exact model's real configuration: drivetrain (fwd/rwd/awd/4wd), transmission type, timing drive (belt or chain), and powertrain. If you are not certain of a fact, use "unknown" — never guess. Do not include services for a system whose presence you marked "unknown".
- Front-wheel-drive cars have no rear differential, transfer case, or propshaft service. Timing-chain engines have no timing belt service. Manual transmissions have no automatic/CVT/DCT fluid service; automatics have no clutch fluid or manual gearbox oil service. Battery-electric vehicles have no engine oil, spark plug, fuel, or exhaust service.`
          : isAtvConfigCategory ? `
- The "config" block must state this exact model's real final drive: "chain" (sport ATVs, youth models), "shaft" (utility ATVs), or "cvt_shaft" (CVT belt to a shaft-driven axle, most side-by-sides). If you are not certain, use "unknown" — never guess. Shaft and CVT machines have no drive-chain service; CVT machines need drive-belt inspection.`
          : isTrailerConfigCategory ? `
- The "config" block must state this trailer's real brake type: "electric_drum" (no brake fluid), "electric_hydraulic" (has brake fluid), "hydraulic_surge" (has brake fluid), or "none". If you are not certain, use "unknown" — never guess. Electric-drum and unbraked trailers have no brake fluid service; unbraked trailers have no brake service at all, but every trailer has brake lights and wiring.`
          : "";
        const categoryConfigSpec = isCarConfigCategory ? `  "config": {
    "drivetrain": "fwd|rwd|awd|4wd|unknown",
    "transmission": "manual|automatic|cvt|dct|unknown",
    "timing_drive": "belt|chain|unknown",
    "powertrain": "ice|hybrid|phev|bev|unknown"
  },`
          : isAtvConfigCategory ? `  "config": {
    "final_drive": "chain|shaft|cvt_shaft|unknown"
  },`
          : isTrailerConfigCategory ? `  "config": {
    "brake_type": "electric_drum|electric_hydraulic|hydraulic_surge|none|unknown"
  },`
          : "";
        const taskItemSpec = `  {
    "task": "Task Name",
    "description": "Brief practical description including recommended interval range",
    "category": "Engine|Drivetrain|Brakes|Fluids|Electrical|Safety|Suspension|Body|Controls|Cooling|Tires|Seasonal|General",
    "interval_miles": <number or null>,
    "interval_hours": <number or null>,
    "interval_months": <number or null>,
    "priority": "high"|"medium"|"low"
  }`;
        const outputSpec = isMotorcyclePrompt
          ? `Respond ONLY with a valid JSON object, no markdown, no backticks, no explanation. Shape:
{
  "config": {
    "final_drive": "chain|belt|shaft|unknown",
    "cooling": "liquid|air|air_oil|unknown",
    "fuel_system": "carburetor|fuel_injection|unknown"
  },
  "tasks": [
${taskItemSpec}
  ]
}`
          : categoryConfigSpec !== ""
            ? `Respond ONLY with a valid JSON object, no markdown, no backticks, no explanation. Shape:
{
${categoryConfigSpec}
  "tasks": [
${taskItemSpec}
  ]
}`
            : `Respond ONLY with a valid JSON array, no markdown, no backticks, no explanation. Each item:
[
${taskItemSpec}
]`;

        const prompt = `You are an expert maintenance advisor for vehicles and assets. Generate a realistic, trustworthy maintenance schedule for this specific asset.

Asset: ${vehicleDesc}${categoryHint}${fuelHint}${awdHint}
${currentUsageDesc}
${hoursContext}${timeOnlyContext}
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
- For motorcycles: FIRST determine this exact model's final drive type (chain, belt, or shaft). Include only final-drive services matching that type: chain cleaning/lubrication/adjustment and condition-based chain replacement for chain drive; belt inspection/tension and condition-based belt replacement for belt drive; final drive gear oil changes for shaft drive. NEVER include chain service on a shaft- or belt-driven motorcycle, and NEVER include belt or shaft final-drive service on a chain-driven motorcycle. Primary, cam, and timing chain services are engine services, not final-drive services, and are unaffected by this rule.${motoConfigRules}${categoryConfigRules}
- For cars and trucks: oil change intervals should reflect oil type — 3,000-5,000 miles for conventional oil, 5,000-7,500 miles for synthetic blend or full synthetic. Default to conventional (3,000-5,000 miles) unless the vehicle is known to require or recommend synthetic (e.g., turbocharged engines, European vehicles, luxury brands)
- Each task description must include the recommended interval AND a realistic range
- Do NOT assign identical intervals to unrelated tasks unless they are genuinely part of the same service milestone
- Priorities: high = oil, critical fluids, safety-critical; medium = filters, secondary fluids, inspections; lower = condition-based replacements
- Output should feel like it was written by an experienced technician — practical, realistic, not artificially uniform
${intervalRule}
- Interval values are the INTERVAL (e.g., every ${intervalExample}), NOT the absolute ${usageWord}
- Be conservative on safety-critical items

${outputSpec}

Generate 12-16 tasks. Quality over quantity. Every task should be something a knowledgeable owner would actually schedule and track.
Every task MUST have ${intervalRequirement}.`;

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
          // Shape-agnostic for every category: motorcycles answer with
          // { config, tasks }, everything else still answers with a bare array.
          // This widens ACCEPTANCE only — the request each non-motorcycle
          // category sends is unchanged, and a bare array behaves exactly as it
          // did before, with an all-unknown config that strips nothing. The
          // bracket-extraction fallback now also matches a top-level object;
          // alternation is positional, so a bare array still wins when its "["
          // precedes the first "{".
          let aiParsed: unknown;
          try { aiParsed = JSON.parse(aiText); } catch {
            const m = aiText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
            if (m) aiParsed = JSON.parse(m[0]); else throw new Error("Could not parse AI JSON");
          }
          let aiTasks: any[] = [];
          let declaredConfig: DeclaredConfig = { final_drive: "unknown", cooling: "unknown", fuel_system: "unknown" };
          let declaredCar: CarConfig = { ...UNKNOWN_CAR_CONFIG };
          let declaredAtv: AtvConfig = { ...UNKNOWN_ATV_CONFIG };
          let declaredTrailer: TrailerConfig = { ...UNKNOWN_TRAILER_CONFIG };
          if (Array.isArray(aiParsed)) {
            aiTasks = aiParsed;
          } else if (aiParsed && typeof aiParsed === "object") {
            const wrapper = aiParsed as Record<string, unknown>;
            if (Array.isArray(wrapper.tasks)) {
              aiTasks = wrapper.tasks;
              declaredConfig = normalizeDeclaredConfig(wrapper.config);
              declaredCar = normalizeCarConfig(wrapper.config);
              declaredAtv = normalizeAtvConfig(wrapper.config);
              declaredTrailer = normalizeTrailerConfig(wrapper.config);
            }
          }
          aiDeclaredBev = isCarConfigCategory && !isEvFuel && declaredCar.powertrain === "bev";
          if (Array.isArray(aiTasks) && aiTasks.length >= 5) {
            const parsed: ValidatedTask[] = aiTasks.filter(t => typeof t.task === "string" && t.task.trim()).map(t => ({
              task: t.task.trim(),
              description: typeof t.description === "string" ? t.description : "",
              category: typeof t.category === "string" ? t.category : "General",
              interval_miles: (isHoursOnlyMode || isTimeOnlyMode) ? null : (typeof t.interval_miles === "number" && t.interval_miles > 0 ? t.interval_miles : null),
              interval_hours: (isHoursCapableMode && !isTimeOnlyMode) ? (typeof t.interval_hours === "number" && t.interval_hours > 0 ? t.interval_hours : null) : null,
              interval_months: typeof t.interval_months === "number" && t.interval_months > 0 ? t.interval_months : null,
              priority: typeof t.priority === "string" ? t.priority : "medium",
            }));
            validatedTasks = validateAndEnforce(parsed, vehicleCategory);

            // ══════════════════════════════════════════════════════════════
            // POST-PROCESSING: Task family dedup, merge, cleanup, trimming
            // ══════════════════════════════════════════════════════════════
            if (validatedTasks && !isHoursOnlyMode) {
              const isSmallMoto = (vehicleCategory === "motorcycle" || vehicleCategory === "atv" || vehicleCategory === "utv" || vehicleCategory === "snowmobile");

              // ── Motorcycle drivetrain correctness (deterministic) ───────────
              // Early pass, at the position the inline guard used to hold: get
              // the wrong-drivetrain services out before the family pipeline can
              // rename them into canonical ones. Repeated after the pipeline,
              // where the correct final-drive service is also injected.
              if (validatedTasks) {
                validatedTasks = applyDrivetrainStrip(validatedTasks, make, vehicleModel, declaredConfig);
                // Same reasoning as the drivetrain strip: get services for
                // components this bike does not have out before the family
                // pipeline can rename one into a canonical task.
                if (vehicleCategory === "motorcycle") {
                  validatedTasks = applyConfigStrip(validatedTasks, declaredConfig);
                }
                // Car / ATV-UTV / trailer layer, same early position and reasoning.
                validatedTasks = applyCarConfigStrip(validatedTasks, declaredCar);
                validatedTasks = applyAtvConfigStrip(validatedTasks, declaredAtv);
                validatedTasks = applyTrailerConfigStrip(validatedTasks, declaredTrailer);
              }

              interface TaskFamily {
                key: string;
                patterns: RegExp[];
                // See IntervalClamp.exclude — a task the family excludes never
                // maps into it, so it is never renamed to the canonical name.
                exclude?: (name: string) => boolean;
                canonical: string;
                description: string;
                priorityOverride?: string;
                remove?: boolean;
                removeCondition?: () => boolean;
                mergeIntervals?: boolean;
                conditionBased?: boolean;
                // The canonical is a replacement: keep the member that IS the
                // replacement (else the longest interval), so an inspection's
                // cadence is never inherited by "Replace X".
                replacementPreferring?: boolean;
              }

              const families: TaskFamily[] = [
                // Snowmobile chaincase oil is a gearcase lubricant, not engine oil:
                // without this scope the family would rename the required
                // "Chaincase Oil Change" into an engine oil change on a 2-stroke.
                { key: "engine_oil", patterns: [/oil.*change/i, /oil.*filter/i, /engine.*oil/i], exclude: (n) => isNonEngineLubricantName(n) || (vehicleCategory === "snowmobile" && /chain\s*case/i.test(n)), canonical: "Engine Oil and Filter Change", description: "Change engine oil and replace oil filter. Recommended every 2,500-3,500 miles or 6 months for small-displacement engines, 5,000-7,500 miles for larger engines.", priorityOverride: "high" },
                { key: "chain_maintenance", patterns: [/chain.*clean/i, /chain.*lube/i, /chain.*adjust/i, /chain.*tension/i, /chain.*maintenance/i], exclude: (n) => /timing|cam\b|primary/i.test(n), canonical: "Clean, Lubricate, and Adjust Chain", description: "Clean and lubricate drive chain, check and adjust tension. Recommended every 300-600 miles depending on riding conditions.", priorityOverride: "high", mergeIntervals: true },
                { key: "chain_replacement", patterns: [/chain.*replace/i, /drive.*chain.*replace/i], exclude: (n) => /timing|cam\b|primary/i.test(n), canonical: "Replace Chain", description: "Inspect regularly and replace as needed based on wear.", conditionBased: true },
                { key: "tire_inspection", patterns: [/tire.*pressure/i, /tire.*check/i, /tire.*condition/i, /tire.*inspect/i], canonical: "Check Tire Pressure and Condition", description: "Check tire pressure and inspect tread depth, sidewalls, and overall condition. Recommended every 1,000-3,000 miles or monthly.", priorityOverride: "high" },
                { key: "tire_replacement", patterns: [/tire.*replace/i], canonical: "Replace Tires", description: "Inspect regularly and replace as needed based on wear.", conditionBased: true },
                { key: "brake_fluid", patterns: [/brake.*fluid/i], canonical: "Replace Brake Fluid", description: "Replace brake fluid to maintain stopping performance. Recommended every 1-2 years regardless of mileage.", replacementPreferring: true },
                { key: "brake_pads", patterns: [/brake.*pad/i], canonical: "Inspect Brake Pads", description: "Inspect brake pads regularly and replace as needed based on wear.", priorityOverride: "high", conditionBased: true },
                { key: "brake_inspection", patterns: [/brake(?!.*pad)(?!.*fluid).*inspect/i, /brake.*system.*inspect/i], canonical: "", description: "", remove: true, removeCondition: () => isSmallMoto },
                { key: "coolant", patterns: [/coolant.*replace/i, /coolant.*service/i, /coolant.*flush/i, /coolant.*system/i, /coolant.*inspect/i], canonical: "Replace Coolant", description: "Replace engine coolant to maintain proper cooling and prevent corrosion. Recommended every 2 years or per manufacturer spec.", replacementPreferring: true },
                { key: "spark_plugs", patterns: [/spark.*plug/i], canonical: "Replace Spark Plugs", description: "Replace spark plugs per manufacturer interval. Recommended every 3,000-7,500 miles for sport motorcycles, 7,500-16,000 miles for standard/touring bikes, 4,000-8,000 miles for small engines, longer for larger car engines.", replacementPreferring: true },
                // Engine and cabin filters are distinct services and never merge.
                // Motorcycles keep their canonical; every other category gets car naming.
                { key: "engine_air_filter", patterns: [/engine.*air.*filter/i, /air.*filter/i], exclude: (n) => /cabin/i.test(n), canonical: vehicleCategory === "motorcycle" ? "Air Filter Cleaning and Replacement" : "Engine Air Filter Replacement", description: vehicleCategory === "motorcycle" ? "Clean or replace the air filter. Recommended every 3,000-6,000 miles depending on riding conditions." : "Replace the engine air filter. Recommended every 15,000-30,000 miles or every 1-2 years.", replacementPreferring: true },
                { key: "cabin_air_filter", patterns: [/cabin.*(air.*)?filter/i], canonical: "Cabin Air Filter Replacement", description: "Replace the cabin air filter. Recommended every 15,000 miles or annually.", replacementPreferring: true },
                { key: "cable_lube", patterns: [/cable.*lube/i, /cable.*lubric/i, /throttle.*cable/i, /clutch.*cable/i], canonical: "Lubricate Control Cables", description: "Lubricate throttle, clutch, and other control cables. Recommended every 3,000-6,000 miles or annually depending on conditions." },
                { key: "valve_clearance", patterns: [/valve.*clear/i, /valve.*check/i, /valve.*adjust/i, /valve.*inspect/i], canonical: "Check and Adjust Valve Clearance", description: "Check and adjust valve clearances per manufacturer spec. Recommended every 7,500-16,000 miles depending on engine type.", priorityOverride: "high" },
                { key: "battery", patterns: [/battery.*maintain/i, /battery.*check/i, /battery.*inspect/i, /battery.*replace/i, /battery.*service/i], canonical: "Battery Inspection and Maintenance", description: "Check battery terminals, voltage, and electrolyte level. Clean connections and charge as needed." },
                { key: "fork_oil", patterns: [/fork.*oil/i, /fork.*seal/i, /front.*fork.*service/i, /fork.*service/i], canonical: "Replace Fork Oil", description: "Replace fork oil and inspect seals. Recommended every 10,000-15,000 miles or every 2 years.", priorityOverride: "medium", replacementPreferring: true },
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
                  const tName = validatedTasks[ti].task;
                  if (fam.exclude && fam.exclude(tName)) continue;
                  if (fam.patterns.some(p => p.test(tName))) {
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
                const REPLACEMENT_WORD = /replace|flush|change|exchange/i;
                const tasksNow: ValidatedTask[] = validatedTasks;
                const pickKeep = (idxs: number[]): number => {
                  const rep = idxs.find((i) => REPLACEMENT_WORD.test(tasksNow[i].task));
                  if (rep !== undefined) return rep;
                  let best = idxs[0];
                  for (const i of idxs) {
                    const a = tasksNow[i], b = tasksNow[best];
                    const ai = a.interval_miles ?? -1, bi = b.interval_miles ?? -1;
                    if (ai > bi || (ai === bi && (a.interval_months ?? -1) > (b.interval_months ?? -1))) best = i;
                  }
                  return best;
                };
                const keepIdx = fam.replacementPreferring ? pickKeep(taskIdxs) : taskIdxs[0];
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

              // Step 6: Interval diversity — at most 2 unrelated tasks per
              // interval_miles. Every move is re-clamped against the category's
              // clamps and lands only on a value that still has room (stepping
              // x1.2, x1.44, ... so a move can never create a new cluster), counts
              // are recomputed after each move, required/protected/brake/timing-
              // belt names never move, and total moves are capped at the original
              // excess. A task the clamp ceiling pins in place simply stays.
              {
                const vt: ValidatedTask[] = validatedTasks;
                const catClamps = getClampsForCategory(vehicleCategory);
                const immovable = new Set<string>([...PROTECTED_NAMES, ...getRequiredForCategory(vehicleCategory).map((r) => r.task)]);
                const isImmovable = (t: ValidatedTask) => immovable.has(t.task) || /brake/i.test(t.task) || /timing.*belt/i.test(t.task);
                const countAt = (mi: number) => vt.filter((t) => t.interval_miles === mi).length;
                const pri = (t: ValidatedTask) => t.priority === "high" ? 3 : t.priority === "medium" ? 2 : 1;
                const clusters = new Map<number, number[]>();
                vt.forEach((t, i) => { if (t.interval_miles !== null) clusters.set(t.interval_miles, [...(clusters.get(t.interval_miles) ?? []), i]); });
                let budget = 0;
                for (const idxs of clusters.values()) if (idxs.length > 2) budget += idxs.length - 2;
                for (const [miles, idxs] of [...clusters.entries()].sort((a, b) => a[0] - b[0])) {
                  if (budget <= 0) break;
                  const candidates = idxs.filter((i) => !isImmovable(vt[i])).sort((a, b) => pri(vt[a]) - pri(vt[b]));
                  for (const idx of candidates) {
                    if (budget <= 0 || countAt(miles) <= 2) break;
                    for (let step = 1; step <= 4; step++) {
                      const moved = clampTask({ ...vt[idx], interval_miles: Math.round(miles * Math.pow(1.2, step)) }, catClamps);
                      const landed = moved.interval_miles;
                      if (landed === null || landed === miles || countAt(landed) >= 2) continue;
                      vt[idx] = moved;
                      budget--;
                      break;
                    }
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
              // Required-task injection runs LAST - after both trims - so no
              // downstream pass can remove what it adds. Neither trim protects
              // "Tire Rotation" (medium priority, absent from PROTECTED_NAMES),
              // so injecting any earlier lets the cap delete it again. The cap
              // therefore becomes soft: at most 18 + the category's required
              // count. Gates below use the pre-injection count.
              preInjectionTaskCount = validatedTasks.length;
              validatedTasks = ensureRequiredTasks(validatedTasks, vehicleCategory);
              // Drivetrain, late pass. The family pipeline can rename or merge a
              // stripped task back into existence, so strip once more; then
              // inject the correct final-drive service HERE, beyond every
              // rename, the interval-diversity stretch, and both 18-task trims,
              // so what we inject cannot be renamed, stretched, or trimmed away.
              // Runs before the cache upsert below, so the cached row is correct.
              validatedTasks = applyDrivetrainStrip(validatedTasks, make, vehicleModel, declaredConfig);
              if (vehicleCategory === "motorcycle") {
                validatedTasks = applyConfigStrip(validatedTasks, declaredConfig);
              }
              validatedTasks = injectFinalDriveService(validatedTasks, make, vehicleModel, declaredConfig);
              // Car / ATV-UTV / trailer layer, late pass: beyond every rename,
              // the diversity step, both trims and the required injection, so
              // nothing stripped here can come back; the CVT belt is added last.
              validatedTasks = applyCarConfigStrip(validatedTasks, declaredCar);
              validatedTasks = applyAtvConfigStrip(validatedTasks, declaredAtv);
              validatedTasks = applyTrailerConfigStrip(validatedTasks, declaredTrailer);
              validatedTasks = injectAtvBeltService(validatedTasks, declaredAtv);
            }

            if (preInjectionTaskCount >= 5) {
              // fuel_type doubles as the declared-BEV marker for cache hits (see aiDeclaredBev).
              await adminClient.from("ai_schedule_cache").upsert({ cache_key: cacheKey, vehicle_desc: vehicleDesc, vehicle_category: vehicleCategory, fuel_type: aiDeclaredBev ? "ev" : effectiveFuel, tasks_json: JSON.stringify(validatedTasks), task_count: validatedTasks.length }, { onConflict: "cache_key" });
            }
          }
        }
      }

      if (validatedTasks && preInjectionTaskCount >= 5) {
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
            const estimateHeaders: Record<string, string> = { "Content-Type": "application/json", "x-edge-secret": edgeFnSecret, "Authorization": `Bearer ${supabaseServiceKey}` };
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
      ? templates.filter((t: Record<string, unknown>) => !excluded.some((e) => matchesExclusion(t.task as string, e)))
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

    // Required-task guarantee for the template path - the same guarantee the
    // AI path now carries. Add-only: existing rows are never modified, a
    // required task whose regexes already match anything present is skipped,
    // and next-due anchors to current usage exactly as fresh rows do. Runs
    // BEFORE the empty check so a fully-filtered set still yields required
    // coverage rather than an empty schedule.
    {
      const requiredForTemplate = getRequiredForCategory(vehicleCategory);
      for (const req of requiredForTemplate) {
        if (isEvFuel && isIceOnlyFor(req.task, vehicleCategory)) continue;
        if (isDieselStripName(req.task)) continue;
        if (tasksToInsert.some(row => req.match.some(re => re.test(row.name as string)))) continue;
        const reqMiles = isHoursOnlyMode ? null : req.interval_miles;
        const reqMonths = req.interval_months;
        if ((reqMiles === null || reqMiles <= 0) && (reqMonths === null || reqMonths <= 0)) continue;
        tasksToInsert.push({
          user_id: authUserId,
          vehicle_id,
          template_id: null,
          name: req.task,
          description: req.description,
          category: req.category,
          interval_miles: reqMiles,
          interval_hours: null,
          interval_months: reqMonths,
          last_completed_date: null,
          last_completed_miles: null,
          last_completed_hours: null,
          next_due_miles: reqMiles !== null && reqMiles > 0 ? Math.round(resolvedCurrentMileage) + reqMiles : null,
          next_due_hours: null,
          next_due_date: reqMonths !== null && reqMonths > 0 ? addMonths(today, reqMonths).toISOString() : null,
          status: "upcoming",
          priority: req.priority,
          is_custom: false,
          source: "template",
        });
      }
    }

    // Motorcycle drivetrain correctness for the template path — the same
    // guarantee the AI paths carry. Templates are drive-type agnostic, so
    // without this a shaft bike is handed chain service and no final-drive
    // service at all. Runs after the required-task guarantee so injected rows
    // are filtered too, and before the insert. Intervals and due-date maths for
    // every other row are untouched.
    if (vehicleCategory === "motorcycle") {
      const fallbackDrive = detectDriveType(make, vehicleModel);
      if (fallbackDrive !== "unknown") {
        const keepRow = (name: string): boolean => {
          if (fallbackDrive === "shaft") return !hasChainWord(name) && !isFinalDriveBeltName(name);
          if (fallbackDrive === "belt") return !hasChainWord(name) && !isFinalDriveOilName(name);
          if (fallbackDrive === "ambiguous") return !hasChainWord(name);
          return !isFinalDriveBeltName(name) && !isFinalDriveOilName(name);
        };
        const keptRows = tasksToInsert.filter((row) => keepRow(row.name as string));
        tasksToInsert.length = 0;
        for (const row of keptRows) tasksToInsert.push(row);

        if (fallbackDrive === "shaft" || fallbackDrive === "belt") {
          const fd = fallbackDrive === "shaft" ? FINAL_DRIVE_TASKS.shaft : FINAL_DRIVE_TASKS.belt;
          const alreadyPresent = fallbackDrive === "shaft"
            ? tasksToInsert.some((row) => isFinalDriveOilName(row.name as string) && /change|replace|drain|flush/i.test(row.name as string))
            : tasksToInsert.some((row) => isFinalDriveBeltName(row.name as string) && /inspect|tension|adjust|check/i.test(row.name as string));
          const fdMiles = isHoursOnlyMode ? null : fd.interval_miles;
          const fdMonths = fd.interval_months;
          if (!alreadyPresent) {
            tasksToInsert.push({
              user_id: authUserId,
              vehicle_id,
              template_id: null,
              name: fd.task,
              description: fd.description,
              category: fd.category,
              interval_miles: fdMiles,
              interval_hours: null,
              interval_months: fdMonths,
              last_completed_date: null,
              last_completed_miles: null,
              last_completed_hours: null,
              next_due_miles: fdMiles !== null && fdMiles > 0 ? Math.round(resolvedCurrentMileage) + fdMiles : null,
              next_due_hours: null,
              next_due_date: fdMonths !== null && fdMonths > 0 ? addMonths(today, fdMonths).toISOString() : null,
              status: "upcoming",
              priority: fd.priority,
              is_custom: false,
              source: "template",
            });
          }
        }
      }
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
      const tplEstimateHeaders: Record<string, string> = { "Content-Type": "application/json", "x-edge-secret": tplEdgeFnSecret, "Authorization": `Bearer ${supabaseServiceKey}` };
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

