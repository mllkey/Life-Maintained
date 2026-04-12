import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

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

interface ExtractedItem {
  category: "vehicle" | "property" | "health";
  asset_id: string | null;
  asset_name: string;
  service_name: string;
  service_date: string;
  cost: number | null;
  mileage: number | null;
  provider_name: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return json({ error: "ANTHROPIC_API_KEY secret is not configured" }, 500);
  }

  // --- Authenticate JWT ---
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("[AUTH] Missing or invalid Authorization header");
    return json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const jwt = authHeader.replace("Bearer ", "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  // Use getUser() (no jwt arg) — the Authorization header in global.headers does the work.
  // This matches the pattern used in generate-maintenance-schedule.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("[AUTH] Auth failed — authError:", authError?.message, "user:", user?.id);
    return json({ error: "Unauthorized" }, 401);
  }
  const userId = user.id;

  // --- Parse request body ---
  let inputText: string;
  try {
    const body = await req.json();
    inputText = body.text;
    if (!inputText || typeof inputText !== "string") throw new Error("No text provided");
  } catch (err) {
    console.error("Bad request body:", err);
    return json({ error: "Invalid request body — expected { text: string }" }, 400);
  }

  // --- Fetch user's assets for context ---
  const [vehiclesRes, propertiesRes, familyRes] = await Promise.all([
    supabase.from("vehicles").select("id, year, make, model, nickname").eq("user_id", userId),
    supabase.from("properties").select("id, name, nickname, address").eq("user_id", userId),
    supabase.from("family_members").select("id, name").eq("user_id", userId),
  ]);

  const vehicles = vehiclesRes.data ?? [];
  const properties = propertiesRes.data ?? [];
  const familyMembers = familyRes.data ?? [];

  const vehiclesList = vehicles.length > 0
    ? vehicles.map((v: { id: string; year: number | null; make: string | null; model: string | null; nickname: string | null }) =>
        `- ${v.nickname ?? [v.year, v.make, v.model].filter(Boolean).join(" ")} (id: ${v.id})`
      ).join("\n")
    : "None";

  const propertiesList = properties.length > 0
    ? properties.map((p: { id: string; name: string | null; nickname: string | null; address: string | null }) =>
        `- ${p.nickname ?? p.name ?? p.address ?? "Unknown property"} (id: ${p.id})`
      ).join("\n")
    : "None";

  const familyList = familyMembers.length > 0
    ? familyMembers.map((f: { id: string; name: string | null }) =>
        `- ${f.name ?? "Unknown"} (id: ${f.id})`
      ).join("\n")
    : "None";

  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `Extract structured maintenance data from the user's text. Return ONLY valid JSON, no markdown.

The user owns these assets:

Vehicles:
${vehiclesList}

Properties:
${propertiesList}

Family Members:
${familyList}

Return an array of objects. Each object must have exactly these fields:
- category: "vehicle" | "property" | "health"
- asset_id: matched UUID from the asset list above, or null if no match
- asset_name: human-readable name of the matched asset (or best guess if unmatched)
- service_name: concise name of the service performed (e.g. "Oil Change", "HVAC Filter", "Annual Physical")
- service_date: date in YYYY-MM-DD format — default to today (${today}) if not mentioned
- cost: total cost as a number (no currency symbols), or null
- mileage: odometer reading as a number (vehicles only), or null
- provider_name: shop, clinic, or service provider name, or null
- notes: any extra relevant details, or null
- confidence: "high" if asset and service are clearly identified, "medium" if either is inferred, "low" if mostly guessed

Match assets generously — "my Ninja" matches a Kawasaki Ninja vehicle, "the house" matches a property, a person's name matches a family member.
Return the JSON array directly with no wrapper object, no explanation, no markdown code fences.`;

  const TIMEOUT_MS = 45_000;

  try {
    const requestBody = {
      model: Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: inputText,
        },
      ],
    };

    const aiController = new AbortController();
    const aiTimeoutId = setTimeout(() => aiController.abort(), TIMEOUT_MS);
    const aiStartedAt = Date.now();
    let anthropicRes: Response;
    console.log("Calling Anthropic API for text extraction...");
    try {
      anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: aiController.signal,
      });
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      console.log(`[extract-maintenance-data] AI call completed in ${elapsedMs}ms, status=${anthropicRes.status}`);
    } catch (fetchErr) {
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        console.error(`[extract-maintenance-data] AI call timed out after ${elapsedMs}ms (limit ${TIMEOUT_MS}ms)`);
        return json({ items: [], error: "AI service timed out. Please try again.", raw_text: inputText }, 504);
      }
      console.error(`[extract-maintenance-data] AI call threw after ${elapsedMs}ms:`, fetchErr);
      return json({ items: [], error: "Internal server error", raw_text: inputText }, 500);
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error(`Anthropic API error ${anthropicRes.status}:`, errText);
      return json(
        { items: [], error: `Anthropic API returned ${anthropicRes.status}: ${errText}`, raw_text: inputText },
        502,
      );
    }

    const anthropicData = await anthropicRes.json();
    console.log("Anthropic response received, stop_reason:", anthropicData.stop_reason);
    const rawContent: string = anthropicData.content?.[0]?.text ?? "";

    let items: ExtractedItem[];
    try {
      // Claude may wrap in a JSON array or object — try array first, then items property
      const arrayMatch = rawContent.match(/\[[\s\S]*\]/);
      if (!arrayMatch) throw new Error("No JSON array found in response: " + rawContent);
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) throw new Error("Parsed value is not an array");

      items = parsed.map((obj: Record<string, unknown>) => ({
        category: (["vehicle", "property", "health"].includes(obj.category as string)
          ? obj.category
          : "vehicle") as "vehicle" | "property" | "health",
        asset_id: typeof obj.asset_id === "string" && obj.asset_id !== "null" ? obj.asset_id : null,
        asset_name: typeof obj.asset_name === "string" ? obj.asset_name : "",
        service_name: typeof obj.service_name === "string" ? obj.service_name : "Unknown Service",
        service_date: typeof obj.service_date === "string" && obj.service_date !== "null" ? obj.service_date : today,
        cost: obj.cost != null && obj.cost !== "null" ? Number(obj.cost) : null,
        mileage: obj.mileage != null && obj.mileage !== "null" ? Number(obj.mileage) : null,
        provider_name: typeof obj.provider_name === "string" && obj.provider_name !== "null" ? obj.provider_name : null,
        notes: typeof obj.notes === "string" && obj.notes !== "null" ? obj.notes : null,
        confidence: (["high", "medium", "low"].includes(obj.confidence as string)
          ? obj.confidence
          : "medium") as "high" | "medium" | "low",
      }));
    } catch (parseErr) {
      console.error("Failed to parse Anthropic JSON response:", parseErr, "Raw:", rawContent);
      return json({ items: [], error: "Could not understand input", raw_text: inputText });
    }

    return json({ items, raw_text: inputText });
  } catch (err) {
    console.error("extract-maintenance-data unexpected error:", err);
    return json({ items: [], error: "Internal server error", raw_text: inputText }, 500);
  }
});
