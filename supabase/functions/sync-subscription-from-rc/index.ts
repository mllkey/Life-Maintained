import { createClient } from "npm:@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Tier = "personal" | "pro" | "business" | null;

type RcLookup =
  | { ok: true; body: unknown }
  | { ok: false; status: number };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function entitlementIdsToTier(entitlementIds: string[]): Tier {
  if (entitlementIds.includes("business_access")) return "business";
  if (entitlementIds.includes("pro_access")) return "pro";
  if (entitlementIds.includes("personal_access")) return "personal";
  return null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const rcApiKey = Deno.env.get("REVENUECAT_REST_API_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !rcApiKey) {
    console.error("[sync-rc] missing env vars");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userId = userData.user.id;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("user_id, trial_expires_at, revenuecat_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileErr || !profile) {
    console.error("[sync-rc] profile lookup failed:", profileErr);
    return jsonResponse({ error: "Profile not found" }, 404);
  }

  async function fetchRevenueCatSubscriber(appUserId: string): Promise<RcLookup> {
    const rcUrl = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;

    let rcResp: Response;
    try {
      rcResp = await fetch(rcUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${rcApiKey}`,
          "Content-Type": "application/json",
        },
      });
    } catch (e) {
      console.error("[sync-rc] RC fetch failed:", e);
      return { ok: false, status: 502 };
    }

    if (!rcResp.ok) {
      return { ok: false, status: rcResp.status };
    }

    try {
      return { ok: true, body: await rcResp.json() };
    } catch {
      return { ok: true, body: null };
    }
  }

  let rcLookup = await fetchRevenueCatSubscriber(userId);

  if (
    !rcLookup.ok &&
    rcLookup.status === 404 &&
    typeof profile.revenuecat_customer_id === "string" &&
    profile.revenuecat_customer_id.length > 0 &&
    profile.revenuecat_customer_id !== userId
  ) {
    rcLookup = await fetchRevenueCatSubscriber(profile.revenuecat_customer_id);
  }

  if (!rcLookup.ok && rcLookup.status !== 404) {
    console.error("[sync-rc] RC returned", rcLookup.status);
    return jsonResponse({ error: "RevenueCat lookup failed" }, 502);
  }

  const rcBody = rcLookup.ok ? rcLookup.body : null;
  const subscriber = objectRecord(objectRecord(rcBody).subscriber);
  const entitlements = objectRecord(subscriber.entitlements);

  const now = Date.now();
  const activeEntIds: string[] = [];
  let latestExpiresAt: string | null = null;

  for (const [entitlementId, rawEntitlement] of Object.entries(entitlements)) {
    const entitlement = objectRecord(rawEntitlement);
    const expiresIso = typeof entitlement.expires_date === "string" ? entitlement.expires_date : null;

    if (!expiresIso) {
      activeEntIds.push(entitlementId);
      continue;
    }

    const expiresMs = new Date(expiresIso).getTime();
    if (!Number.isNaN(expiresMs) && expiresMs > now) {
      activeEntIds.push(entitlementId);
      if (!latestExpiresAt || expiresMs > new Date(latestExpiresAt).getTime()) {
        latestExpiresAt = expiresIso;
      }
    }
  }

  const tier = entitlementIdsToTier(activeEntIds);

  const originalAppUserId = typeof subscriber.original_app_user_id === "string"
    ? subscriber.original_app_user_id
    : null;
  const rcCustomerId = originalAppUserId && originalAppUserId.length > 0 ? originalAppUserId : userId;

  if (tier === null) {
    const trialExpires = profile.trial_expires_at;
    const stillInTrial = typeof trialExpires === "string" && new Date(trialExpires).getTime() > now;

    if (stillInTrial) {
      return jsonResponse({ tier: null, expiresAt: null, action: "skipped_trial" });
    }

    const { error: downgradeErr } = await supabaseAdmin
      .from("profiles")
      .update({ subscription_tier: "free", subscription_expires_at: null })
      .eq("user_id", userId);

    if (downgradeErr) {
      console.error("[sync-rc] downgrade write failed:", downgradeErr);
      return jsonResponse({ error: "Update failed" }, 500);
    }

    return jsonResponse({ tier: "free", expiresAt: null, action: "downgraded" });
  }

  const { error: upgradeErr } = await supabaseAdmin
    .from("profiles")
    .update({
      subscription_tier: tier,
      subscription_expires_at: latestExpiresAt,
      revenuecat_customer_id: rcCustomerId,
    })
    .eq("user_id", userId);

  if (upgradeErr) {
    console.error("[sync-rc] upgrade write failed:", upgradeErr);
    return jsonResponse({ error: "Update failed" }, 500);
  }

  return jsonResponse({ tier, expiresAt: latestExpiresAt, action: "synced" });
});
