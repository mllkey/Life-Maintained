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

    const { vehicle_id, make, model, year, current_mileage, vehicle_type, fuel_type, is_awd, vehicle_category } = body;

    if (!vehicle_id || typeof vehicle_id !== "string") {
      return json({ error: "Missing or invalid required field: vehicle_id (string)" }, 400);
    }
    if (!make || typeof make !== "string") {
      return json({ error: "Missing or invalid required field: make (string)" }, 400);
    }
    if (year === undefined || year === null || typeof year !== "number" || !Number.isInteger(year)) {
      return json({ error: "Missing or invalid required field: year (integer)" }, 400);
    }
    if (current_mileage === undefined || current_mileage === null || typeof current_mileage !== "number") {
      return json({ error: "Missing or invalid required field: current_mileage (number)" }, 400);
    }

    // `vehicle_type` historically carries the fuel type in this project; `fuel_type` is supported as well.
    const resolvedVehicleType = typeof fuel_type === "string"
      ? fuel_type
      : (typeof vehicle_type === "string" ? vehicle_type : "gas");
    const resolvedIsAwd = typeof is_awd === "boolean" ? is_awd : false;
    const vehicleModel = typeof model === "string" ? model : "";
    const vehicleCategory = typeof vehicle_category === "string" ? vehicle_category : "car";

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

    // ── 2. Authenticate user from JWT ──────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    console.log("[AUTH] Authorization header present:", !!authHeader);
    console.log("[AUTH] Token prefix:", authHeader?.substring(0, 20));

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("[AUTH] Missing or invalid Authorization header");
      return json({ error: "Missing or invalid Authorization header" }, 401);
    }
    const jwt = authHeader.replace("Bearer ", "").trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    console.log("[AUTH] SUPABASE_URL set:", !!supabaseUrl);
    console.log("[AUTH] SUPABASE_ANON_KEY set:", !!supabaseAnonKey);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    console.log("[AUTH] getUser result:", user?.id, "error:", authError?.message);

    if (authError || !user) {
      console.error("[AUTH] Auth failed — authError:", authError?.message, "user:", user?.id);
      return json({ error: "Unauthorized: invalid or expired token" }, 401);
    }
    const authUserId = user.id;

    // ── 3. Verify vehicle ownership ────────────────────────────────────────
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

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

    // ── 4. Check for existing tasks (prevent duplicate schedules) ──────────
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

    // ═══════════════════════════════════════════════════════════════════════
    // AI-POWERED SCHEDULE GENERATION (with cache + hard validation)
    // Falls through to template fallback below if anything fails.
    // ═══════════════════════════════════════════════════════════════════════

    const today = new Date();
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const vehicleDesc = `${year} ${make} ${vehicleModel}`.trim();
    const cacheKey = `${year}|${make}|${vehicleModel}|${vehicleCategory}|${resolvedVehicleType}`.toLowerCase().trim();

    interface ValidatedTask {
      task: string;
      description: string;
      category: string;
      interval_miles: number | null;
      interval_months: number | null;
      priority: string;
    }
    interface IntervalClamp {
      match: RegExp[];
      max_months?: number;
      min_months?: number;
      max_miles?: number;
      min_miles?: number;
    }
    interface RequiredTask {
      match: RegExp[];
      task: string;
      description: string;
      category: string;
      interval_miles: number | null;
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
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], max_months: 12 },
      { match: [/impeller/i], max_months: 24 },
      { match: [/anode/i, /zinc/i], max_months: 12 },
      { match: [/lower unit/i, /gear.*oil/i, /gear.*lube/i], max_months: 12 },
      { match: [/winteriz/i], max_months: 12 },
      { match: [/spark plug/i], max_months: 12 },
      { match: [/fuel.*filter/i, /fuel.*water.*separator/i], max_months: 12 },
    ];

    const MOTORCYCLE_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter per manufacturer spec", category: "Engine", interval_miles: 4000, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid to maintain stopping performance", category: "Brakes", interval_miles: null, interval_months: 24, priority: "high" },
      { match: [/chain.*clean/i, /chain.*lube/i, /chain.*lubrication/i, /chain maintenance/i], task: "Chain Clean & Lube", description: "Clean and lubricate the drive chain", category: "Drivetrain", interval_miles: 400, interval_months: 1, priority: "high" },
      { match: [/chain.*adjust/i, /chain.*tension/i], task: "Chain Adjustment", description: "Check and adjust chain tension and alignment", category: "Drivetrain", interval_miles: 3000, interval_months: 6, priority: "medium" },
      { match: [/valve.*check/i, /valve.*clearance/i, /valve.*adjust/i, /valve.*inspection/i], task: "Valve Check / Adjustment", description: "Check and adjust valve clearances per manufacturer spec", category: "Engine", interval_miles: 7500, interval_months: 12, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads for wear and replace if needed", category: "Brakes", interval_miles: 7500, interval_months: 12, priority: "high" },
      { match: [/tire.*inspect/i, /tire.*check/i, /tire.*wear/i, /tire.*pressure/i], task: "Tire Inspection", description: "Inspect tires for wear, damage, and proper pressure", category: "Safety", interval_miles: 3000, interval_months: 3, priority: "high" },
    ];
    const CAR_TRUCK_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: 5000, interval_months: 6, priority: "high" },
      { match: [/brake.*fluid/i], task: "Brake Fluid Flush", description: "Replace brake fluid", category: "Brakes", interval_miles: null, interval_months: 30, priority: "high" },
      { match: [/brake.*pad/i, /brake.*inspection/i], task: "Brake Pad Inspection", description: "Inspect brake pads and rotors for wear", category: "Brakes", interval_miles: 20000, interval_months: 12, priority: "high" },
      { match: [/tire.*rotation/i], task: "Tire Rotation", description: "Rotate tires for even wear", category: "Tires", interval_miles: 7500, interval_months: 6, priority: "medium" },
    ];
    const BOAT_PWC_REQUIRED: RequiredTask[] = [
      { match: [/oil.*change/i, /oil.*filter/i, /engine oil/i], task: "Engine Oil & Filter Change", description: "Change engine oil and replace oil filter", category: "Engine", interval_miles: null, interval_months: 12, priority: "high" },
      { match: [/impeller/i], task: "Impeller Inspection / Replacement", description: "Inspect and replace water pump impeller", category: "Cooling", interval_miles: null, interval_months: 12, priority: "high" },
      { match: [/lower unit/i, /gear.*oil/i, /gear.*lube/i], task: "Lower Unit Gear Oil Change", description: "Change lower unit gear oil and check for water intrusion", category: "Drivetrain", interval_miles: null, interval_months: 12, priority: "high" },
      { match: [/winteriz/i], task: "Winterization", description: "Full winterization including fuel stabilizer, fog engine, drain water systems", category: "Seasonal", interval_miles: null, interval_months: 12, priority: "high" },
    ];

    function getClampsForCategory(cat: string): IntervalClamp[] {
      if (cat === "motorcycle" || cat === "atv" || cat === "utv" || cat === "snowmobile") return MOTORCYCLE_CLAMPS;
      if (cat === "boat" || cat === "pwc") return BOAT_PWC_CLAMPS;
      return CAR_TRUCK_CLAMPS;
    }
    function getRequiredForCategory(cat: string): RequiredTask[] {
      if (cat === "motorcycle" || cat === "atv" || cat === "utv" || cat === "snowmobile") return MOTORCYCLE_REQUIRED;
      if (cat === "boat" || cat === "pwc") return BOAT_PWC_REQUIRED;
      return CAR_TRUCK_REQUIRED;
    }
    function clampTask(t: ValidatedTask, clamps: IntervalClamp[]): ValidatedTask {
      for (const c of clamps) {
        if (c.match.some(re => re.test(t.task))) {
          let mi = t.interval_miles;
          let mo = t.interval_months;
          if (mi !== null) {
            if (c.max_miles !== undefined && mi > c.max_miles) mi = c.max_miles;
            if (c.min_miles !== undefined && mi < c.min_miles) mi = c.min_miles;
          }
          if (mo !== null) {
            if (c.max_months !== undefined && mo > c.max_months) mo = c.max_months;
            if (c.min_months !== undefined && mo < c.min_months) mo = c.min_months;
          }
          return { ...t, interval_miles: mi, interval_months: mo };
        }
      }
      return t;
    }
    function validateAndEnforce(tasks: ValidatedTask[], vCat: string): ValidatedTask[] {
      const clamps = getClampsForCategory(vCat);
      const required = getRequiredForCategory(vCat);
      let v = tasks.map(t => ({ ...clampTask(t, clamps), category: normalizeCategory(t.category), priority: normalizePriority(t.priority) }));
      v = v.filter(t => t.task.trim() !== "" && (t.interval_miles !== null || t.interval_months !== null));
      for (const req of required) {
        if (!v.some(t => req.match.some(re => re.test(t.task)))) {
          v.push({ task: req.task, description: req.description, category: normalizeCategory(req.category), interval_miles: req.interval_miles, interval_months: req.interval_months, priority: normalizePriority(req.priority) });
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
        try { validatedTasks = JSON.parse(cached.tasks_json); console.log(`[CACHE HIT] ${cacheKey}`); } catch { console.warn("[CACHE] Parse failed"); }
      }

      if (!validatedTasks && anthropicKey) {
        const claudeModel = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-20250514";
        const categoryHint = vehicleCategory !== "car" ? ` (category: ${vehicleCategory})` : "";
        const fuelHint = resolvedVehicleType !== "gas" ? ` (fuel type: ${resolvedVehicleType})` : "";
        const awdHint = resolvedIsAwd ? " (AWD/4WD)" : "";

        const prompt = `You are an expert vehicle maintenance advisor with deep knowledge of manufacturer service manuals. Generate a comprehensive maintenance schedule for this SPECIFIC vehicle based on its manufacturer's owner's manual recommendations and real-world best practices.

Vehicle: ${vehicleDesc}${categoryHint}${fuelHint}${awdHint}

CRITICAL RULES:
- Be SPECIFIC to this exact year/make/model — use the actual manufacturer recommended intervals from the owner's manual for this vehicle
- Include BOTH mileage AND time-based intervals for every task (whichever comes first triggers the service)
- Time-based intervals are critical — fluids degrade with time regardless of miles driven
- For motorcycles: you MUST include chain clean/lube (every 300-600 miles), chain adjustment, valve check/adjustment, cable lubrication, fork oil service, tire inspection
- For boats/PWC: you MUST include winterization, impeller service, anode inspection, lower unit service
- For any vehicle: include ALL tasks a thorough owner would track
- Be conservative on safety-critical items (brakes, tires, fluids, steering)
- Interval values are the INTERVAL (e.g., every 7500 miles), NOT the absolute mileage
- Do NOT include tasks that don't apply to this vehicle

Respond ONLY with a valid JSON array, no markdown, no backticks, no explanation. Each item:
[
  {
    "task": "Task Name",
    "description": "Brief description",
    "category": "Engine|Drivetrain|Brakes|Fluids|Electrical|Safety|Suspension|Body|Controls|Cooling|Tires|Seasonal",
    "interval_miles": <number or null if time-only>,
    "interval_months": <number or null if mileage-only>,
    "priority": "high"|"medium"|"low"
  }
]

Generate 12-25 tasks. Every task MUST have at least one of interval_miles or interval_months.`;

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
              interval_miles: typeof t.interval_miles === "number" && t.interval_miles > 0 ? t.interval_miles : null,
              interval_months: typeof t.interval_months === "number" && t.interval_months > 0 ? t.interval_months : null,
              priority: typeof t.priority === "string" ? t.priority : "medium",
            }));
            validatedTasks = validateAndEnforce(parsed, vehicleCategory);
            if (validatedTasks.length >= 5) {
              await adminClient.from("ai_schedule_cache").upsert({ cache_key: cacheKey, vehicle_desc: vehicleDesc, vehicle_category: vehicleCategory, fuel_type: resolvedVehicleType, tasks_json: JSON.stringify(validatedTasks), task_count: validatedTasks.length }, { onConflict: "cache_key" });
            }
          }
        }
      }

      if (validatedTasks && validatedTasks.length >= 5) {
        const aiTasksToInsert = validatedTasks.map(t => ({
          user_id: authUserId, vehicle_id, template_id: null,
          name: t.task, description: t.description, category: t.category,
          interval_miles: t.interval_miles, interval_months: t.interval_months,
          last_completed_date: null, last_completed_miles: null,
          next_due_miles: t.interval_miles !== null ? Math.round(current_mileage as number) + t.interval_miles : null,
          next_due_date: t.interval_months !== null ? addMonths(today, t.interval_months).toISOString() : null,
          status: "upcoming", priority: t.priority, is_custom: false, source: "ai",
        }));
        const { error: aiInsertErr } = await adminClient.from("user_vehicle_maintenance_tasks").insert(aiTasksToInsert);
        if (!aiInsertErr) {
          console.log(`[AI SUCCESS] ${aiTasksToInsert.length} tasks for ${vehicleDesc}`);
          return json({ success: true, tasks_created: aiTasksToInsert.length, vehicle_id, source: "ai" });
        }
        console.error("[AI] Insert failed:", aiInsertErr.message);
      }
    } catch (aiBlockErr) {
      console.error("[AI BLOCK] Error, falling back to templates:", aiBlockErr instanceof Error ? aiBlockErr.message : aiBlockErr);
    }

    // ── EXISTING TEMPLATE FALLBACK CONTINUES BELOW (UNTOUCHED) ──────────

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
          ? Math.round(current_mileage) + resolvedMiles
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
        interval_miles: resolvedMiles,
        interval_months: resolvedMonths,
        last_completed_date: null,
        last_completed_miles: null,
        next_due_miles: nextDueMiles,
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
    const { error: insertError } = await adminClient
      .from("user_vehicle_maintenance_tasks")
      .insert(tasksToInsert);

    if (insertError) {
      console.error("Insert error:", insertError);
      return json({ error: "Failed to generate schedule", detail: insertError.message }, 500);
    }

    // ── 11. Return success ─────────────────────────────────────────────────
    return json({ success: true, tasks_created: tasksToInsert.length, vehicle_id });

  } catch (err) {
    console.error("Unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "Failed to generate schedule", detail: message }, 500);
  }
});
