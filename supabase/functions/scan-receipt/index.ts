import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
  rawText: string;
  error?: string;
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

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let image: string;
  try {
    const body = await req.json();
    image = body.image;
    if (!image) throw new Error("No image provided");
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid request body — expected { image: base64string }" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const prompt = `You are analyzing a service receipt or invoice image. Extract the following fields exactly as they appear:

1. date — The service or transaction date. Format as YYYY-MM-DD. Return null if not found.
2. cost — The total amount charged as a number (no currency symbol). Use the final total/amount due. Return null if not found.
3. provider — The business or service provider name (e.g. "Jiffy Lube", "AutoNation", "Dr. Smith's Clinic"). Return null if not found.
4. serviceType — A short description of the service performed (e.g. "Oil Change", "Tire Rotation", "Brake Inspection"). Return null if not found.

Respond ONLY with a valid JSON object in this exact format, no extra text:
{
  "date": "YYYY-MM-DD or null",
  "cost": number or null,
  "provider": "string or null",
  "serviceType": "string or null",
  "rawText": "a brief summary of what you can read on the receipt"
}`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
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
                  media_type: "image/jpeg",
                  data: image,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Anthropic API returned ${anthropicRes.status}`, date: null, cost: null, provider: null, serviceType: null, rawText: "" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicData = await anthropicRes.json();
    const rawContent: string = anthropicData.content?.[0]?.text ?? "";

    let parsed: ReceiptData;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      const obj = JSON.parse(jsonMatch[0]);
      parsed = {
        date: typeof obj.date === "string" && obj.date !== "null" ? obj.date : null,
        cost: obj.cost != null && obj.cost !== "null" ? Number(obj.cost) : null,
        provider: typeof obj.provider === "string" && obj.provider !== "null" ? obj.provider : null,
        serviceType: typeof obj.serviceType === "string" && obj.serviceType !== "null" ? obj.serviceType : null,
        rawText: typeof obj.rawText === "string" ? obj.rawText : rawContent.slice(0, 300),
      };
    } catch {
      parsed = {
        date: null,
        cost: null,
        provider: null,
        serviceType: null,
        rawText: rawContent.slice(0, 300),
        error: "Could not parse receipt fields",
      };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("scan-receipt error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", date: null, cost: null, provider: null, serviceType: null, rawText: "" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
