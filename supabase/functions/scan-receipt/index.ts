import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReceiptData {
  date: string | null;
  cost: number | null;
  provider: string | null;
  serviceType: string | null;
  mileage: number | null;
  task: string | null;
  rawText: string;
  error?: string;
}

type ProfileRow = {
  subscription_tier: string;
  monthly_scan_count: number | null;
  scan_count_reset_at: string | null;
};

function detectMediaType(base64: string): string {
  const prefix = base64.substring(0, 16);
  const decoded = atob(prefix);
  const bytes = decoded.split("").map((c) => c.charCodeAt(0));

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return "image/webp";
  }
  return "image/jpeg";
}

function stripDataUrlPrefix(base64: string): string {
  const match = base64.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : base64;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const jwt = authHeader.replace("Bearer ", "").trim();
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: profileRaw } = await adminClient
    .from("profiles")
    .select("subscription_tier, monthly_scan_count, scan_count_reset_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profileRaw) {
    return new Response(JSON.stringify({ error: "Profile not found" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const profile = profileRaw as ProfileRow;

  const isPaid = profile.subscription_tier && profile.subscription_tier !== "free";
  if (!isPaid) {
    return new Response(JSON.stringify({ error: "Receipt scanning requires a paid subscription. Upgrade to unlock this feature." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Monthly scan limits by tier ────────────────────────────────────
  const TIER_SCAN_LIMITS: Record<string, number> = {
    personal: 15,
    pro: 30,
    business: 100,
    trial: 5,
  };
  const monthlyLimit = TIER_SCAN_LIMITS[profile.subscription_tier] ?? 5;
  const now = new Date();
  const resetAt = profile.scan_count_reset_at ? new Date(profile.scan_count_reset_at) : null;
  let currentCount = profile.monthly_scan_count ?? 0;

  if (!resetAt || resetAt.getMonth() !== now.getMonth() || resetAt.getFullYear() !== now.getFullYear()) {
    currentCount = 0;
    await adminClient.from("profiles").update({
      monthly_scan_count: 0,
      scan_count_reset_at: now.toISOString(),
    }).eq("user_id", user.id);
  }

  if (currentCount >= monthlyLimit) {
    return new Response(JSON.stringify({
      error: `You've used all ${monthlyLimit} scans this month. Upgrade your plan for more.`,
      scans_used: currentCount,
      scans_limit: monthlyLimit,
    }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Atomically increment BEFORE processing to prevent race conditions
  // Two simultaneous requests will both see the count go up immediately
  await adminClient.from("profiles").update({
    monthly_scan_count: currentCount + 1,
  }).eq("user_id", user.id);

  const refundScan = async () => {
    await adminClient.from("profiles").update({
      monthly_scan_count: Math.max(0, currentCount),
    }).eq("user_id", user.id).catch(() => {});
  };

  try {
    if (!ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY is not set");
      await refundScan();
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let rawImage: string;
    try {
      const body = await req.json();
      rawImage = body.image;
      if (!rawImage) throw new Error("No image provided");
    } catch (err) {
      console.error("Bad request body:", err);
      await refundScan();
      return new Response(JSON.stringify({ error: "Invalid request body — expected { image: base64string }" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base64 = stripDataUrlPrefix(rawImage);
    const mediaType = detectMediaType(base64);

    const prompt = `You are analyzing a service receipt or invoice image. Extract the following fields exactly as they appear:

1. date — The service or transaction date. Format as YYYY-MM-DD. Return null if not found.
2. cost — The total amount charged as a number (no currency symbol). Use the final total/amount due. Return null if not found.
3. provider — The business or service provider name (e.g. "Jiffy Lube", "AutoNation", "Dr. Smith's Clinic"). Return null if not found.
4. serviceType — A short description of the service performed (e.g. "Oil Change", "Tire Rotation", "Brake Inspection"). Return null if not found.
5. mileage — The vehicle mileage/odometer reading if shown on the receipt as a number. Return null if not found.

Respond ONLY with a valid JSON object in this exact format, no extra text:
{
  "date": "YYYY-MM-DD or null",
  "cost": number or null,
  "provider": "string or null",
  "serviceType": "string or null",
  "mileage": number or null,
  "rawText": "a brief summary of what you can read on the receipt"
}`;

    const requestBody = {
      model: "claude-3-5-haiku-20241022",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    };

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error(`Anthropic API error ${anthropicRes.status}:`, errText);
      await refundScan();
      return new Response(
        JSON.stringify({
          error: `Anthropic API returned ${anthropicRes.status}: ${errText}`,
          date: null, cost: null, provider: null, serviceType: null, rawText: "",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const anthropicData = await anthropicRes.json();
    const rawContent: string = anthropicData.content?.[0]?.text ?? "";

    let parsed: ReceiptData;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response: " + rawContent);
      const obj = JSON.parse(jsonMatch[0]);
      const serviceType = obj.serviceType && obj.serviceType !== "null" ? String(obj.serviceType) : null;
      parsed = {
        date: obj.date && obj.date !== "null" ? String(obj.date) : null,
        cost: obj.cost != null && obj.cost !== "null" ? Number(obj.cost) : null,
        provider: obj.provider && obj.provider !== "null" ? String(obj.provider) : null,
        serviceType,
        mileage: obj.mileage != null && obj.mileage !== "null" ? Number(obj.mileage) : null,
        task: serviceType,
        rawText: typeof obj.rawText === "string" ? obj.rawText : rawContent.slice(0, 300),
      };
    } catch (parseErr) {
      console.error("Failed to parse Anthropic JSON response:", parseErr, "Raw:", rawContent);
      parsed = {
        date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null,
        rawText: rawContent.slice(0, 300),
        error: "Could not parse receipt fields",
      };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("scan-receipt unexpected error:", err);
    await refundScan();
    return new Response(
      JSON.stringify({ error: "Internal server error", date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null, rawText: "" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
