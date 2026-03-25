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
  // Path 1: Internal edge-to-edge secret (never exposed to client)
  const edgeSecret = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
  const incomingSecret = req.headers.get("x-edge-secret") ?? "";
  if (edgeSecret && incomingSecret === edgeSecret) {
    return true;
  }

  // Path 2: User JWT verification
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const jwt = authHeader.replace("Bearer ", "").trim();
  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { error } = await authClient.auth.getUser();
    return !error;
  } catch {
    return false;
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

    const prompt = `You are an automotive repair cost estimator. Give me a cost estimate for the following service on the specified vehicle. Be specific to this exact vehicle, not generic.
Vehicle: ${vehicleDesc} (type: ${vehicle_type ?? "car"})
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
Base your estimates on current 2025-2026 market prices. Be accurate for this specific vehicle.`;
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

    return new Response(JSON.stringify({ data: estimate, source: "ai" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return jsonRes({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
