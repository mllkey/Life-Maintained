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

  let input: string;
  try {
    const body = await req.json();
    input = body.input;
    if (!input || typeof input !== "string") throw new Error("Missing input");
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body — expected { input: string }" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", input);
    url.searchParams.set("types", "address");
    url.searchParams.set("components", "country:us");
    url.searchParams.set("key", GOOGLE_PLACES_API_KEY);

    const res = await fetch(url.toString());
    const json = await res.json();

    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
      return new Response(JSON.stringify({ suggestions: [], error: json.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const suggestions = (json.predictions ?? []).slice(0, 5).map((p: {
      place_id: string;
      description: string;
      structured_formatting?: { main_text: string; secondary_text: string };
    }) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));

    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("places-autocomplete error:", err);
    return new Response(JSON.stringify({ suggestions: [], error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
