import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GOOGLE_PLACES_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  if (!GOOGLE_PLACES_API_KEY) {
    console.error("[places-details] GOOGLE_PLACES_API_KEY secret is NOT set");
    return new Response(JSON.stringify({ addressComponents: null, error: "GOOGLE_PLACES_API_KEY secret is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let placeId: string;
  try {
    const body = await req.json();
    placeId = body.placeId;
    if (!placeId || typeof placeId !== "string") throw new Error("Missing placeId");
  } catch {
    return new Response(JSON.stringify({ addressComponents: null, error: "Invalid request body — expected { placeId: string }" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.log("[places-details] Fetching details for placeId:", placeId);

    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "addressComponents",
      },
    });

    const json = await res.json();
    console.log("[places-details] API HTTP status:", res.status);

    if (!res.ok) {
      const errMsg = json.error?.message ?? JSON.stringify(json);
      console.error("[places-details] Places API (New) error:", res.status, errMsg);
      return new Response(JSON.stringify({ addressComponents: null, error: `Places API error ${res.status}: ${errMsg}` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Places API (New) uses longText/shortText instead of long_name/short_name
    // Normalize to the shape the client expects: { types, long_name, short_name }
    const raw: Array<{ longText: string; shortText: string; types: string[] }> = json.addressComponents ?? [];
    const addressComponents = raw.map((c) => ({
      types: c.types,
      long_name: c.longText,
      short_name: c.shortText,
    }));

    console.log("[places-details] Returning", addressComponents.length, "components");

    return new Response(JSON.stringify({ addressComponents }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[places-details] Unexpected error:", err);
    return new Response(JSON.stringify({ addressComponents: null, error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
