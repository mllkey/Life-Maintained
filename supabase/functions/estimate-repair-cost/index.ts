import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/json.ts";
import { requireUser, hasEdgeSecret, AuthError } from "../_shared/auth.ts";
import { enforceAiRateLimit, RateLimitError } from "../_shared/rateLimit.ts";
import { requirePaidTier, PremiumGateError } from "../_shared/tierGate.ts";

/**
 * Query maintenance_logs for real user costs on a matching service + vehicle type.
 */
async function queryCommunityData(
  supabase: any,
  serviceKey: string,
  vehicleType: string | null,
): Promise<{ avg_cost: number; min_cost: number; max_cost: number; sample_size: number; avg_diy_cost: number | null; diy_count: number } | null> {
  try {
    const words = serviceKey
      .toLowerCase()
      .split(/[\s\-\/&,]+/)
      .filter((w: string) => w.length >= 3);

    if (words.length === 0) return null;

    const vType = (vehicleType ?? "car").toLowerCase();
    const seedWords = [...words].sort((a, b) => b.length - a.length).slice(0, Math.min(2, words.length));
    const seen = new Map<string, any>();

    for (const seedWord of seedWords) {
      const { data: logs } = await supabase
        .from("maintenance_logs")
        .select("id, service_name, cost, did_it_myself, vehicles!inner(vehicle_type)")
        .ilike("service_name", `%${seedWord}%`)
        .not("cost", "is", null)
        .gt("cost", 0)
        .limit(120);

      for (const log of logs ?? []) {
        if (log?.id != null) seen.set(String(log.id), log);
      }
    }

    const candidates = Array.from(seen.values());
    if (candidates.length === 0) return null;

    const requiredWordMatches = Math.min(2, words.length);
    const matching = candidates.filter((l: any) => {
      const logVehicleType = (l.vehicles?.vehicle_type ?? "").toLowerCase();
      if (logVehicleType !== vType) return false;
      const logName = (l.service_name ?? "").toLowerCase();
      const matchCount = words.filter((w) => logName.includes(w)).length;
      return matchCount >= requiredWordMatches;
    });

    if (matching.length < 3) return null;

    let filtered = matching;
    if (matching.length >= 4) {
      const costs = matching
        .map((l: any) => Number(l.cost))
        .filter((c: number) => Number.isFinite(c))
        .sort((a: number, b: number) => a - b);

      if (costs.length >= 4) {
        const q1 = costs[Math.floor((costs.length - 1) * 0.25)];
        const q3 = costs[Math.floor((costs.length - 1) * 0.75)];
        const iqr = q3 - q1;
        const lowerBound = q1 - 2 * iqr;
        const upperBound = q3 + 2 * iqr;
        filtered = matching.filter((l: any) => {
          const cost = Number(l.cost);
          return Number.isFinite(cost) && cost >= lowerBound && cost <= upperBound;
        });
        if (filtered.length < 3) filtered = matching;
      }
    }
    if (filtered.length < 3) return null;

    const diyLogs = filtered.filter((l: any) => l.did_it_myself === true);
    const allCosts = filtered.map((l: any) => Number(l.cost)).filter((c: number) => Number.isFinite(c));
    if (allCosts.length < 3) return null;

    return {
      avg_cost: allCosts.reduce((s: number, c: number) => s + c, 0) / allCosts.length,
      min_cost: Math.min(...allCosts),
      max_cost: Math.max(...allCosts),
      sample_size: filtered.length,
      avg_diy_cost: diyLogs.length > 0
        ? diyLogs.reduce((s: number, l: any) => s + Number(l.cost), 0) / diyLogs.length
        : null,
      diy_count: diyLogs.length,
    };
  } catch (e) {
    console.warn("[COMMUNITY] Query failed:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    // ── Auth: edge-secret OR verified user JWT (no anon trust) ──────
    const isInternal = hasEdgeSecret(req);
    let userIdForRateLimit: string | null = null;
    if (!isInternal) {
      const { userId } = await requireUser(req);
      userIdForRateLimit = userId;
    }

    const { year, make, model, service_name, vehicle_type, zip_code } = await req.json();
    if (!make || !service_name) {
      return jsonResponse({ error: "make and service_name required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ── Premium gate + rate limit only on user path. Internal preheats skip. ────
    if (userIdForRateLimit) {
      await requirePaidTier(supabase, userIdForRateLimit);
      await enforceAiRateLimit(supabase, userIdForRateLimit, "estimate-repair-cost");
    }

    const vehicleKey = `${year ?? ""}|${make}|${model ?? ""}|${vehicle_type ?? ""}`.toLowerCase();
    const serviceKey = service_name.toLowerCase().trim();

    const { data: cached } = await supabase
      .from("repair_cost_cache")
      .select("*")
      .eq("vehicle_key", vehicleKey)
      .eq("service_name", serviceKey)
      .maybeSingle();

    if (cached) {
      try {
        const community = await queryCommunityData(supabase, serviceKey, vehicle_type);
        if (community && community.sample_size >= 3) {
          const weight = Math.min(community.sample_size / 10, 0.7);
          const blended = {
            ...cached,
            shop_low: Math.round(cached.shop_low * (1 - weight) + community.min_cost * weight),
            shop_high: Math.round(cached.shop_high * (1 - weight) + community.max_cost * weight),
            ...(community.avg_diy_cost != null && community.diy_count >= 2 ? {
              diy_low: Math.round(cached.diy_low * (1 - weight) + community.avg_diy_cost * 0.8 * weight),
              diy_high: Math.round(cached.diy_high * (1 - weight) + community.avg_diy_cost * 1.2 * weight),
            } : {}),
            community_sample_size: community.sample_size,
          };
          return jsonResponse({ data: blended, source: "cache+community" });
        }
      } catch (e) {
        console.warn("[COMMUNITY] Cache blend failed:", e);
      }
      return jsonResponse({ data: cached, source: "cache" });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResponse({ error: "API key not configured" }, 500);
    }

    const claudeModel = Deno.env.get("CLAUDE_SONNET_MODEL") ?? "claude-sonnet-4-5";
    const vehicleDesc = `${year ?? ""} ${make} ${model ?? ""}`.trim();
    const locationHint = zip_code ? ` in zip code ${zip_code}` : "";

    const isPropertyEstimate = (vehicle_type ?? "").toString().startsWith("property_");
    const estimatorType = isPropertyEstimate ? "home maintenance" : "automotive repair";
    const entityLabel = isPropertyEstimate ? "property" : "vehicle";
    const entityDesc = isPropertyEstimate
      ? `${String(vehicle_type ?? "").replace("property_", "")} property built in ${year ?? "unknown year"}`
      : vehicleDesc;

    const prompt = `You are a ${estimatorType} cost estimator. Give me a cost estimate for the following service on the specified ${entityLabel}. Be specific to this exact ${entityLabel}, not generic.
${entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)}: ${entityDesc}${isPropertyEstimate ? "" : ` (type: ${vehicle_type ?? "car"})`}
Service: ${service_name}
Location: United States${locationHint}
Respond ONLY with valid JSON, no other text. Use this exact format:
{
"shop_low": <number, lowest reasonable shop price in USD>,
"shop_high": <number, highest reasonable shop price in USD>,
"diy_low": <number, lowest parts-only cost for DIY in USD>,
"diy_high": <number, highest parts-only cost for DIY in USD>,
"difficulty": <1-3, where 1=easy DIY, 2=moderate skill needed, 3=professional recommended>,
"estimated_hours": <number, estimated labor hours>,
"parts_list": "<comma-separated list of parts needed with approximate individual costs>"
}
Base your estimates on current ${new Date().getFullYear()} market prices. Be accurate for this specific ${entityLabel}.`;
    const TIMEOUT_MS = 45_000;
    const aiController = new AbortController();
    const aiTimeoutId = setTimeout(() => aiController.abort(), TIMEOUT_MS);
    const aiStartedAt = Date.now();
    let aiResponse: Response;
    try {
      aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: aiController.signal,
      });
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      console.log(`[estimate-repair-cost] AI call completed in ${elapsedMs}ms, status=${aiResponse.status}`);
    } catch (fetchErr) {
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        console.error(`[estimate-repair-cost] AI call timed out after ${elapsedMs}ms (limit ${TIMEOUT_MS}ms)`);
        return jsonResponse({ error: "Estimate service timed out. Please try again." }, 504);
      }
      console.error(`[estimate-repair-cost] AI call threw after ${elapsedMs}ms:`, fetchErr);
      return jsonResponse({ error: "Internal server error" }, 500);
    }

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error("[Anthropic] API error:", aiResponse.status, JSON.stringify(aiData));
      return jsonResponse({ error: "AI API error", detail: aiData?.error?.message ?? aiResponse.status }, 502);
    }
    const aiText = aiData.content?.[0]?.text ?? "";

    let estimate;
    try {
      estimate = JSON.parse(aiText);
    } catch {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) estimate = JSON.parse(jsonMatch[0]);
      else return jsonResponse({ error: "Could not parse estimate" }, 500);
    }

    await supabase.from("repair_cost_cache").upsert({
      vehicle_key: vehicleKey,
      service_name: serviceKey,
      shop_low: estimate.shop_low,
      shop_high: estimate.shop_high,
      diy_low: estimate.diy_low,
      diy_high: estimate.diy_high,
      difficulty: estimate.difficulty,
      parts_list: estimate.parts_list,
      estimated_hours: estimate.estimated_hours,
    }, { onConflict: "vehicle_key,service_name" });

    try {
      const community = await queryCommunityData(supabase, serviceKey, vehicle_type);
      if (community && community.sample_size >= 3) {
        const weight = Math.min(community.sample_size / 10, 0.7);
        estimate.shop_low = Math.round(estimate.shop_low * (1 - weight) + community.min_cost * weight);
        estimate.shop_high = Math.round(estimate.shop_high * (1 - weight) + community.max_cost * weight);
        if (community.avg_diy_cost != null && community.diy_count >= 2) {
          estimate.diy_low = Math.round(estimate.diy_low * (1 - weight) + community.avg_diy_cost * 0.8 * weight);
          estimate.diy_high = Math.round(estimate.diy_high * (1 - weight) + community.avg_diy_cost * 1.2 * weight);
        }
        estimate.community_sample_size = community.sample_size;
      }
    } catch (e) {
      console.warn("[COMMUNITY] AI blend failed:", e);
    }

    return jsonResponse({ data: estimate, source: estimate.community_sample_size ? "ai+community" : "ai" });
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
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
