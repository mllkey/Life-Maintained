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

    const { vehicle_id, make, year, current_mileage, vehicle_type, fuel_type, is_awd, vehicle_category } = body;

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
    const today = new Date();
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
