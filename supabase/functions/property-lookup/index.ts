import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { corsHeaders as sharedCorsHeaders, handlePreflight } from "../_shared/cors.ts";
import { requireUser, AuthError } from "../_shared/auth.ts";
import { enforceAiRateLimit, RateLimitError } from "../_shared/rateLimit.ts";

const RENTCAST_API_KEY = Deno.env.get("RENTCAST_API_KEY");

const corsHeaders = sharedCorsHeaders;

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { userId } = await requireUser(req);
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    await enforceAiRateLimit(adminClient, userId, "property-lookup", 10, 60);
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null, error: err.message }), {
        status: err.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null, rateLimited: true }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    console.error("[property-lookup] auth/rate error:", err);
    return new Response(JSON.stringify({ yearBuilt: null, squareFootage: null, error: "Internal server error" }), {
      status: 500,
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
    const squareFootage: number | null = property.squareFootage ?? null;
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
