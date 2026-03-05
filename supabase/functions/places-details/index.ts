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
    return new Response(JSON.stringify({ error: "GOOGLE_PLACES_API_KEY secret is not configured" }), {
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
    return new Response(JSON.stringify({ error: "Invalid request body — expected { placeId: string }" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("fields", "address_components");
    url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

    const res = await fetch(url.toString());
    const json = await res.json();

    if (json.status !== "OK") {
      return new Response(JSON.stringify({ addressComponents: null, error: json.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ addressComponents: json.result?.address_components ?? [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("places-details error:", err);
    return new Response(JSON.stringify({ addressComponents: null, error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
