import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RENTCAST_API_KEY = Deno.env.get("RENTCAST_API_KEY");

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

  if (!RENTCAST_API_KEY) {
    console.error("[property-lookup] RENTCAST_API_KEY secret is NOT set");
    return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let address: string, city: string, state: string, zip: string;
  try {
    const body = await req.json();
    address = body.address ?? "";
    city = body.city ?? "";
    state = body.state ?? "";
    zip = body.zip ?? "";
    if (!address) throw new Error("Missing address");
  } catch {
    return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const parts = [address, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean);
    const fullAddress = parts.join(", ");
    console.log("[property-lookup] Looking up:", fullAddress);

    const url = new URL("https://api.rentcast.io/v1/properties");
    url.searchParams.set("address", fullAddress);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "X-Api-Key": RENTCAST_API_KEY,
        "Accept": "application/json",
      },
    });

    if (res.status === 429) {
      console.warn("[property-lookup] Rentcast rate limit hit");
      return new Response(JSON.stringify({ rateLimited: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!res.ok) {
      console.error("[property-lookup] Rentcast API error:", res.status);
      return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const property = Array.isArray(json) ? json[0] : null;

    if (!property) {
      console.log("[property-lookup] No results found for address");
      return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const yearBuilt: number | null = property.yearBuilt ?? null;
    const squareFootage: number | null = property.squareFeet ?? null;
    console.log("[property-lookup] Found — yearBuilt:", yearBuilt, "squareFeet:", squareFootage);

    return new Response(JSON.stringify({ yearBuilt, squareFootage }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[property-lookup] Unexpected error:", err);
    return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
