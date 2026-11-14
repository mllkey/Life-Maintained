import { createClient } from "npm:@supabase/supabase-js@2.98.0";

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

const VALID_TIERS = ["personal", "pro", "business"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  let code: string;
  try {
    const body = await req.json();
    code = (body.code ?? "").toUpperCase().trim();
    if (!code) throw new Error("No code");
  } catch {
    return json({ error: "Invalid request — expected { code: string }" }, 400);
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  // Independent grant-model write for one legitimate redemption (Revision 7, Stage 2B.8).
  // It never throws and never changes the legacy outcome: the profile row stays authoritative
  // until the separately authorized cutover. "pending" means the redemption is recorded but its
  // grant is not yet; issue_promo_grant is idempotent per redemption, so re-submitting the same
  // code re-drives it (see the already-used branch below).
  async function issuePromoGrant(redemptionId: string): Promise<"issued" | "pending"> {
    try {
      const { error: grantErr } = await admin.rpc("issue_promo_grant", { p_redemption_id: redemptionId });
      if (grantErr) {
        console.error(`[apply-promo] grant not issued for redemption ${redemptionId}: ${grantErr.code} ${grantErr.message}`);
        return "pending";
      }
      return "issued";
    } catch (e) {
      console.error(`[apply-promo] grant not issued for redemption ${redemptionId}:`, e);
      return "pending";
    }
  }

  // The expired and usage-limit answers below are returned before the already-used check, so a
  // retry of an expired or exhausted code would never reach the re-drive there. If THIS caller
  // already holds a redemption of this code, make sure its grant exists. Never changes a response.
  async function redriveGrantIfRedeemed(promoCodeId: string, userId: string): Promise<void> {
    try {
      const { data: prior } = await admin
        .from("promo_redemptions")
        .select("id")
        .eq("promo_code_id", promoCodeId)
        .eq("user_id", userId)
        .maybeSingle();
      if (prior) await issuePromoGrant(prior.id);
    } catch (e) {
      console.error("[apply-promo] grant re-drive lookup failed:", e);
    }
  }

  // Validate the code exists before requiring auth — allows callers to check
  // code validity without a session (e.g. unauthenticated curl tests).
  const { data: promoData, error: readErr } = await admin
    .from("promo_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (readErr || !promoData) return json({ error: "Invalid promo code" }, 404);

  // Code exists — now require a valid authenticated user to actually apply it.
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const jwt = authHeader.replace("Bearer ", "").trim();

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  if (promoData.expires_at && new Date(promoData.expires_at) < new Date()) {
    await redriveGrantIfRedeemed(promoData.id, user.id);
    return json({ error: "This code has expired" }, 410);
  }

  const currentUses = promoData.current_uses ?? 0;
  if (promoData.max_uses != null && currentUses >= promoData.max_uses) {
    await redriveGrantIfRedeemed(promoData.id, user.id);
    return json({ error: "This code has reached its usage limit" }, 410);
  }

  const promoTier = (promoData.tier ?? "").toLowerCase();
  if (!VALID_TIERS.includes(promoTier)) {
    return json({ error: "Invalid promo code configuration" }, 500);
  }

  const promoDays = promoData.duration_days;
  if (!promoDays || typeof promoDays !== "number" || promoDays <= 0) {
    return json({ error: "Invalid promo code configuration" }, 500);
  }

  const { data: existingRedemption } = await admin
    .from("promo_redemptions")
    .select("id")
    .eq("promo_code_id", promoData.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingRedemption) {
    // Retry path for a partial failure: this caller's redemption exists, so make sure its grant
    // does too. Idempotent; the response to the client is unchanged.
    await issuePromoGrant(existingRedemption.id);
    return json({ error: "You've already used this code" }, 409);
  }

  const { data: profile, error: profileReadErr } = await admin
    .from("profiles")
    .select("subscription_tier, subscription_expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileReadErr || !profile) {
    return json({ error: "Could not read your profile. Try again." }, 500);
  }

  const TIER_RANK: Record<string, number> = { free: 0, trial: 0, personal: 1, pro: 2, business: 3 };
  const currentTier = (profile.subscription_tier ?? "free").toLowerCase();
  const currentRank = TIER_RANK[currentTier] ?? 0;
  const promoRank = TIER_RANK[promoTier] ?? 0;

  if (promoRank < currentRank) {
    return json({ error: `You already have ${currentTier.charAt(0).toUpperCase() + currentTier.slice(1)} access, which is higher than this code provides.` }, 409);
  }

  const now = new Date();
  const existingExpiry = profile.subscription_expires_at ? new Date(profile.subscription_expires_at) : now;
  const baseDate = existingExpiry > now ? existingExpiry : now;
  const newExpiry = new Date(baseDate.getTime() + promoDays * 86400000).toISOString();

  const { data: updated, error: incErr } = await admin
    .from("promo_codes")
    .update({ current_uses: currentUses + 1 })
    .eq("id", promoData.id)
    .lt("current_uses", promoData.max_uses ?? 999999)
    .select("id")
    .maybeSingle();

  if (incErr || !updated) {
    return json({ error: "This code has reached its usage limit" }, 410);
  }

  const { data: redemption, error: redemptionErr } = await admin
    .from("promo_redemptions")
    .insert({
      promo_code_id: promoData.id,
      user_id: user.id,
      redeemed_at: now.toISOString(),
    })
    .select("id")
    .single();

  if (redemptionErr || !redemption) {
    // Best-effort compensation. The query builder resolves with an error field instead of
    // rejecting, so it is awaited directly (it has no promise-style catch method).
    const { error: undoUsesErr } = await admin.from("promo_codes").update({ current_uses: currentUses }).eq("id", promoData.id);
    if (undoUsesErr) console.error("[apply-promo] could not restore current_uses:", undoUsesErr.message);
    return json({ error: "Could not apply code. Try again." }, 500);
  }

  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      subscription_tier: promoTier,
      subscription_expires_at: newExpiry,
    })
    .eq("user_id", user.id);

  if (profileErr) {
    const { error: undoRedemptionErr } = await admin.from("promo_redemptions").delete().eq("promo_code_id", promoData.id).eq("user_id", user.id);
    if (undoRedemptionErr) console.error("[apply-promo] could not remove the redemption:", undoRedemptionErr.message);
    const { error: undoUsesErr } = await admin.from("promo_codes").update({ current_uses: currentUses }).eq("id", promoData.id);
    if (undoUsesErr) console.error("[apply-promo] could not restore current_uses:", undoUsesErr.message);
    return json({ error: "Code validated but profile update failed. Contact support@lifemaintained.com." }, 500);
  }

  // The legacy redemption is complete. Add the independent grant for it; a failure here is
  // logged and reported as "pending", never as a failed redemption.
  const grant = await issuePromoGrant(redemption.id);

  const tierLabel = promoTier.charAt(0).toUpperCase() + promoTier.slice(1);
  return json({
    success: true,
    tier: promoTier,
    duration_days: promoDays,
    message: `${tierLabel} access for ${promoDays} days`,
    grant,
  });
});
