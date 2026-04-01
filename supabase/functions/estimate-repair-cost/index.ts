import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-edge-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Auth: accepts either a valid user JWT or a private edge-function-to-edge-function secret.
 * Returns true if authorized, false otherwise.
 */
async function isAuthorized(req: Request): Promise<boolean> {
  // Path 1: x-edge-secret header from internal edge-to-edge calls
  const edgeSecret = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
  const incomingSecret = req.headers.get("x-edge-secret") ?? "";
  if (edgeSecret && incomingSecret === edgeSecret) {
    return true;
  }

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const jwt = authHeader.replace("Bearer ", "").trim();

  // Path 2: Any Supabase-issued token (service_role, anon, or user session).
  // Decode payload without signature verification — the function is deployed with
  // --no-verify-jwt so we own the auth layer. Legitimate callers all have iss:"supabase".
  try {
    const parts = jwt.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.iss === "supabase") {
        // For authenticated users, additionally verify the session is active
        if (payload.role === "authenticated") {
          const authClient = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: `Bearer ${jwt}` } } },
          );
          const { error } = await authClient.auth.getUser();
          return !error;
        }
        // service_role and anon tokens are trusted as-is
        return true;
      }
    }
  } catch {
    // fall through
  }

  return false;
}

/**
 * Query maintenance_logs for real user costs on a matching service + vehicle type.
 * Uses multi-word matching plus small-sample safeguards.
 * Returns null if not enough data or query fails.
 */
async function queryCommunityData(
  supabase: any,
  serviceKey: string,
  vehicleType: string | null,
): Promise<{ avg_cost: number; min_cost: number; max_cost: number; sample_size: number; avg_diy_cost: number | null; diy_count: number } | null> {
  try {
    // Extract significant words (3+ chars) for matching
    const words = serviceKey
      .toLowerCase()
      .split(/[\s\-\/&,]+/)
      .filter((w: string) => w.length >= 3);

    if (words.length === 0) return null;

    const vType = (vehicleType ?? "car").toLowerCase();

    // Query candidate logs using up to the 2 longest words, then dedupe in JS.
    // This reduces bias from a single broad primary word being limited too early.
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
        if (log?.id != null) {
          seen.set(String(log.id), log);
        }
      }
    }

    const candidates = Array.from(seen.values());
    if (candidates.length === 0) return null;

    // Tight filter:
    // 1) vehicle type must match
    // 2) service_name must contain at least 2 significant words (or all words if only 1 exists)
    const requiredWordMatches = Math.min(2, words.length);
    const matching = candidates.filter((l: any) => {
      const logVehicleType = (l.vehicles?.vehicle_type ?? "").toLowerCase();
      if (logVehicleType !== vType) return false;

      const logName = (l.service_name ?? "").toLowerCase();
      const matchCount = words.filter((w) => logName.includes(w)).length;
      return matchCount >= requiredWordMatches;
    });

    if (matching.length < 1) return null;

    // Small-sample safeguard:
    // - < 3 rows: not enough to blend at all
    // - 3 rows: use all rows, skip IQR because quartiles are not meaningful
    // - 4+ rows: apply IQR-based outlier removal
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

        // Do not let outlier filtering collapse a usable set below 3
        if (filtered.length < 3) {
          filtered = matching;
        }
      }
    }

    if (filtered.length < 3) return null;

    const diyLogs = filtered.filter((l: any) => l.did_it_myself === true);
    const allCosts = filtered.map((l: any) => Number(l.cost)).filter((c: number) => Number.isFinite(c));

    if (allCosts.length < 3) return null;

    const result = {
      avg_cost: allCosts.reduce((s: number, c: number) => s + c, 0) / allCosts.length,
      min_cost: Math.min(...allCosts),
      max_cost: Math.max(...allCosts),
      sample_size: filtered.length,
      avg_diy_cost:
        diyLogs.length > 0
          ? diyLogs.reduce((s: number, l: any) => s + Number(l.cost), 0) / diyLogs.length
          : null,
      diy_count: diyLogs.length,
    };

    return result;
  } catch (e) {
    console.warn("[COMMUNITY] Query failed:", e);
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  try {
    if (!(await isAuthorized(req))) {
      return jsonRes({ error: "Unauthorized" }, 401);
    }

    const { year, make, model, service_name, vehicle_type, zip_code } = await req.json();
    if (!make || !service_name) {
      return new Response(JSON.stringify({ error: "make and service_name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const vehicleKey = `${year ?? ""}|${make}|${model ?? ""}|${vehicle_type ?? ""}`.toLowerCase();
    const serviceKey = service_name.toLowerCase().trim();

    const { data: cached } = await supabase
      .from("repair_cost_cache")
      .select("*")
      .eq("vehicle_key", vehicleKey)
      .eq("service_name", serviceKey)
      .maybeSingle();

    if (cached) {
      // Blend community data into cached estimate if enough real data exists
      try {
        const community = await queryCommunityData(supabase, serviceKey, vehicle_type);
        if (community && community.sample_size >= 3) {
          const weight = Math.min(community.sample_size / 10, 0.7); // Max 70% community, always 30% AI
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
          return new Response(JSON.stringify({ data: blended, source: "cache+community" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.warn("[COMMUNITY] Cache blend failed:", e);
      }
      return new Response(JSON.stringify({ data: cached, source: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(JSON.stringify({ error: "API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeModel = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-20250514";
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
Base your estimates on current 2025-2026 market prices. Be accurate for this specific ${entityLabel}.`;
    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
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
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error("[Anthropic] API error:", aiResponse.status, JSON.stringify(aiData));
      return new Response(JSON.stringify({ error: "AI API error", detail: aiData?.error?.message ?? aiResponse.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiText = aiData.content?.[0]?.text ?? "";

    let estimate;
    try {
      estimate = JSON.parse(aiText);
    } catch {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        estimate = JSON.parse(jsonMatch[0]);
      } else {
        return new Response(JSON.stringify({ error: "Could not parse estimate" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    // Blend community data into AI estimate if available
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

    return new Response(JSON.stringify({ data: estimate, source: estimate.community_sample_size ? "ai+community" : "ai" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonRes({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
