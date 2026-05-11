import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/json.ts";
import { requireUser, AuthError } from "../_shared/auth.ts";
import { enforceAiRateLimit, RateLimitError } from "../_shared/rateLimit.ts";
import { requirePaidTier, PremiumGateError } from "../_shared/tierGate.ts";

function addMonthsUTC(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

interface HealthTask {
  appointment_type: string;
  interval_months: number;
  priority: "high" | "medium" | "low";
}

// ── Template fallback ────────────────────────────────────────────────
function getTemplateTasks(memberType: string, age: number, sexAtBirth: string, petType: string): HealthTask[] {
  if (memberType === "pet") {
    const pt = petType.toLowerCase();
    if (pt === "dog") {
      return [
        { appointment_type: "Annual Vet Visit", interval_months: 12, priority: "high" },
        { appointment_type: "Vaccinations", interval_months: 12, priority: "high" },
        { appointment_type: "Dental Cleaning", interval_months: 12, priority: "medium" },
        { appointment_type: "Heartworm Test", interval_months: 12, priority: "medium" },
        { appointment_type: "Flea/Tick Prevention", interval_months: 1, priority: "medium" },
      ];
    }
    if (pt === "cat") {
      return [
        { appointment_type: "Annual Vet Visit", interval_months: 12, priority: "high" },
        { appointment_type: "Vaccinations", interval_months: 12, priority: "high" },
        { appointment_type: "Dental Cleaning", interval_months: 12, priority: "medium" },
        { appointment_type: "Flea Prevention", interval_months: 1, priority: "medium" },
      ];
    }
    return [
      { appointment_type: "Annual Vet Visit", interval_months: 12, priority: "high" },
      { appointment_type: "Vaccinations", interval_months: 12, priority: "high" },
    ];
  }

  // Person
  if (age < 18) {
    return [
      { appointment_type: "Annual Physical", interval_months: 12, priority: "high" },
      { appointment_type: "Dental Cleaning", interval_months: 6, priority: "medium" },
      { appointment_type: "Eye Exam", interval_months: 24, priority: "medium" },
    ];
  }

  const isFemale = sexAtBirth === "female";
  const base: HealthTask[] = [
    { appointment_type: "Annual Physical", interval_months: 12, priority: "high" },
    { appointment_type: "Dental Cleaning", interval_months: 6, priority: "medium" },
    { appointment_type: "Eye Exam", interval_months: 24, priority: "medium" },
    { appointment_type: "Skin Check", interval_months: 12, priority: "medium" },
  ];
  const obgyn: HealthTask = { appointment_type: "OB-GYN Visit", interval_months: 12, priority: "medium" };
  const mammogram: HealthTask = { appointment_type: "Mammogram", interval_months: 12, priority: "high" };
  const colonoscopy: HealthTask = { appointment_type: "Colonoscopy", interval_months: 120, priority: "high" };
  const prostate: HealthTask = { appointment_type: "Prostate Screening", interval_months: 12, priority: "medium" };

  if (age <= 39) return isFemale ? [...base, obgyn] : [...base];
  if (age <= 49) return isFemale ? [...base, obgyn, mammogram] : [...base];
  return isFemale
    ? [...base, obgyn, mammogram, colonoscopy]
    : [...base, colonoscopy, prostate];
}

function clampInterval(appointmentType: string, intervalMonths: number, memberType: string): number {
  const mo = Math.round(intervalMonths);
  if (memberType === "person") {
    if (appointmentType === "Annual Physical") return 12;
    if (appointmentType === "Dental Cleaning") return Math.max(6, Math.min(12, mo));
    if (appointmentType === "Eye Exam") return Math.max(12, Math.min(24, mo));
    if (appointmentType === "Colonoscopy") return Math.max(12, Math.min(120, mo));
    if (appointmentType === "Mammogram") return Math.max(12, Math.min(24, mo));
    return Math.max(3, Math.min(120, mo));
  }
  if (appointmentType === "Annual Vet Visit") return Math.max(6, Math.min(12, mo));
  if (appointmentType === "Dental Cleaning") return Math.max(6, Math.min(24, mo));
  if (appointmentType === "Vaccinations") return Math.max(12, Math.min(36, mo));
  return Math.max(1, Math.min(60, mo));
}

function normalizePriority(p: unknown): "high" | "medium" | "low" {
  if (p === "high" || p === "medium" || p === "low") return p;
  return "medium";
}

function normalizeAndValidate(raw: unknown[], memberType: string): HealthTask[] {
  const result: HealthTask[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (typeof t.appointment_type !== "string" || !t.appointment_type.trim()) continue;
    if (typeof t.interval_months !== "number" || !isFinite(t.interval_months) || t.interval_months <= 0) continue;
    result.push({
      appointment_type: t.appointment_type.trim(),
      interval_months: clampInterval(t.appointment_type.trim(), t.interval_months, memberType),
      priority: normalizePriority(t.priority),
    });
  }
  return result;
}

function injectRequired(tasks: HealthTask[], memberType: string, petType: string): HealthTask[] {
  const result = [...tasks];
  const hasType = (type: string) => result.some(t => t.appointment_type === type);
  if (memberType === "person") {
    if (!hasType("Annual Physical")) result.push({ appointment_type: "Annual Physical", interval_months: 12, priority: "high" });
    if (!hasType("Dental Cleaning")) result.push({ appointment_type: "Dental Cleaning", interval_months: 6, priority: "medium" });
  } else {
    if (!hasType("Annual Vet Visit")) result.push({ appointment_type: "Annual Vet Visit", interval_months: 12, priority: "high" });
    if (!hasType("Vaccinations")) result.push({ appointment_type: "Vaccinations", interval_months: 12, priority: "high" });
    if (petType.toLowerCase() === "dog" && !hasType("Dental Cleaning")) {
      result.push({ appointment_type: "Dental Cleaning", interval_months: 12, priority: "medium" });
    }
  }
  return result;
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function deduplicateTasks(tasks: HealthTask[]): HealthTask[] {
  const map = new Map<string, HealthTask>();
  for (const task of tasks) {
    const existing = map.get(task.appointment_type);
    if (!existing) {
      map.set(task.appointment_type, task);
    } else {
      const newRank = PRIORITY_RANK[task.priority] ?? 2;
      const existRank = PRIORITY_RANK[existing.priority] ?? 2;
      if (newRank > existRank || (newRank === existRank && task.interval_months < existing.interval_months)) {
        map.set(task.appointment_type, task);
      }
    }
  }
  return Array.from(map.values());
}

function isValidCachedTask(t: unknown): t is HealthTask {
  if (!t || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;
  return (
    typeof obj.appointment_type === "string" &&
    typeof obj.interval_months === "number" &&
    (obj.priority === "high" || obj.priority === "medium" || obj.priority === "low")
  );
}

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    // ── Auth: verify JWT, derive user_id ───────────────────────────
    const { userId } = await requireUser(req);

    // ── Body: family_member_id only. user_id no longer trusted from body. ──
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
    const { family_member_id } = body;
    if (!family_member_id || typeof family_member_id !== "string") {
      return jsonResponse({ error: "Missing or invalid required field: family_member_id" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Premium gate ────────────────────────────────────────────────
    await requirePaidTier(adminClient, userId);
    // ── Rate limit (per user, per fn) ───────────────────────────────
    await enforceAiRateLimit(adminClient, userId, "generate-health-schedule");

    // 1. Ownership check against verified user
    const { data: member } = await adminClient
      .from("family_members")
      .select("id, user_id, member_type, date_of_birth, sex_at_birth, pet_type, pet_breed")
      .eq("id", family_member_id)
      .maybeSingle();

    if (!member) return jsonResponse({ error: "Family member not found" }, 404);
    if (member.user_id !== userId) {
      return jsonResponse({ error: "Forbidden: family member does not belong to this user" }, 403);
    }

    if (!member.date_of_birth) {
      return jsonResponse({ error: "date_of_birth is required to generate a health schedule" }, 400);
    }

    const memberType: string = member.member_type === "pet" ? "pet" : "person";
    const dob = new Date(member.date_of_birth);
    const now = new Date();
    const ageMs = now.getTime() - dob.getTime();
    const age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
    const sexAtBirth: string = member.sex_at_birth ?? "unknown";
    const petType: string = memberType === "pet" ? (member.pet_type ?? "unknown") : "unknown";
    const petBreed: string | null = member.pet_breed ?? null;

    const cacheKey = `health|${memberType}|${age}|${sexAtBirth}|${petType}`.toLowerCase();

    const { data: cached } = await adminClient
      .from("ai_schedule_cache")
      .select("tasks_json")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    let finalTasks: HealthTask[] | null = null;
    let source: "cache" | "ai" | "template" = "template";

    if (cached?.tasks_json) {
      try {
        const parsed = JSON.parse(cached.tasks_json);
        if (Array.isArray(parsed) && parsed.every(isValidCachedTask)) {
          finalTasks = parsed as HealthTask[];
          source = "cache";
          console.log(`[CACHE HIT] ${cacheKey}`);
        }
      } catch {
        console.warn("[CACHE] Parse failed");
      }
    }

    if (!finalTasks) {
      const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (anthropicKey) {
        const claudeModel = Deno.env.get("CLAUDE_SONNET_MODEL") ?? "claude-sonnet-4-5";
        let userPrompt: string;
        if (memberType === "person") {
          userPrompt = `Generate a preventive health schedule for a ${age}-year-old person, sex at birth: ${sexAtBirth}. Include 7-12 preventive screenings and checkups. Each item must have: appointment_type (string), interval_months (number), priority ("high" | "medium" | "low").`;
        } else {
          const breedPart = petBreed ? `, breed: ${petBreed}` : "";
          userPrompt = `Generate a preventive health schedule for a ${age}-year-old ${petType}${breedPart}. Include 5-8 veterinary appointments. Each item must have: appointment_type (string), interval_months (number), priority ("high" | "medium" | "low").`;
        }

        try {
          const TIMEOUT_MS = 90_000;
          const aiController = new AbortController();
          const aiTimeoutId = setTimeout(() => aiController.abort(), TIMEOUT_MS);
          const aiStartedAt = Date.now();
          const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: claudeModel,
              max_tokens: 2000,
              system: "You are a preventive health scheduling assistant. Return ONLY a JSON array. No markdown. No explanation.",
              messages: [{ role: "user", content: userPrompt }],
            }),
            signal: aiController.signal,
          });
          clearTimeout(aiTimeoutId);
          const aiElapsedMs = Date.now() - aiStartedAt;
          console.log(`[generate-health-schedule] AI call completed in ${aiElapsedMs}ms, status=${aiResponse.status}`);

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const aiText = aiData.content?.[0]?.text ?? "";
            let aiTasks: unknown[];
            try {
              aiTasks = JSON.parse(aiText);
            } catch {
              const m = aiText.match(/\[[\s\S]*\]/);
              if (m) aiTasks = JSON.parse(m[0]); else throw new Error("Could not parse AI response");
            }

            if (Array.isArray(aiTasks)) {
              const normalized = normalizeAndValidate(aiTasks, memberType);
              const withRequired = injectRequired(normalized, memberType, petType);
              const deduped = deduplicateTasks(withRequired);
              if (deduped.length >= 2) {
                finalTasks = deduped;
                source = "ai";
              }
            }
          } else {
            const errText = await aiResponse.text();
            console.error("[AI] Claude API error:", aiResponse.status, errText.slice(0, 200));
          }
        } catch (aiErr) {
          if (aiErr instanceof Error && aiErr.name === "AbortError") {
            console.error("[AI] AI call timed out, falling back to templates");
          } else {
            console.error("[AI] Error, falling back to templates:", aiErr instanceof Error ? aiErr.message : aiErr);
          }
        }
      }
    }

    if (!finalTasks) {
      console.warn("[FALLBACK] Using template tasks");
      const raw = getTemplateTasks(memberType, age, sexAtBirth, petType);
      const normalized = normalizeAndValidate(raw as unknown[], memberType);
      const withRequired = injectRequired(normalized, memberType, petType);
      finalTasks = deduplicateTasks(withRequired);
      source = "template";
    }

    if (source === "cache") {
      const reclamped = normalizeAndValidate(finalTasks as unknown[], memberType);
      const withRequired = injectRequired(reclamped, memberType, petType);
      finalTasks = deduplicateTasks(withRequired);
    }

    if (source !== "cache") {
      await adminClient.from("ai_schedule_cache").upsert({
        cache_key: cacheKey,
        tasks_json: JSON.stringify(finalTasks),
        task_count: finalTasks.length,
        vehicle_category: null,
        vehicle_desc: null,
        fuel_type: null,
      }, { onConflict: "cache_key" });
    }

    const { data: existingAppointments } = await adminClient
      .from("health_appointments")
      .select("appointment_type")
      .eq("user_id", userId)
      .eq("family_member_id", family_member_id);

    const existingTypes = new Set<string>(
      (existingAppointments ?? []).map((a: { appointment_type: string }) => a.appointment_type)
    );

    const today = new Date();
    const toInsert = finalTasks.filter(t => !existingTypes.has(t.appointment_type));
    const skipped = finalTasks.length - toInsert.length;

    if (toInsert.length > 0) {
      const rows = toInsert.map(t => ({
        user_id: userId,
        family_member_id,
        appointment_type: t.appointment_type,
        interval_months: t.interval_months,
        interval_type: "recurring",
        is_completed: false,
        appointment_date: null,
        last_completed_at: null,
        next_due_date: addMonthsUTC(today, t.interval_months).toISOString().split("T")[0],
        provider_name: null,
        estimated_cost: null,
        notes: null,
      }));

      const { error: insertError } = await adminClient.from("health_appointments").insert(rows);
      if (insertError) {
        return jsonResponse({ error: "Failed to insert appointments", detail: insertError.message }, 500);
      }
    }

    console.log(`[SUCCESS] ${toInsert.length} appointments created for family_member_id=${family_member_id} (source: ${source})`);

    return jsonResponse({
      success: true,
      appointments_created: toInsert.length,
      appointments_skipped_existing: skipped,
      family_member_id,
      source,
    });

  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ error: err.message }, err.status);
    }
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    if (err instanceof PremiumGateError) {
      return jsonResponse({ error: err.message }, err.status);
    }
    console.error("[ERROR]", err);
    return jsonResponse({ error: "Failed to generate health schedule", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});
