import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? "";
    const signature = req.headers.get("X-RevenueCat-Signature") ?? "";

    if (secret && signature !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }

    processWebhook(req.clone()).catch(() => {});
    return new Response("OK", { status: 200 });
  } catch {
    return new Response("OK", { status: 200 });
  }
});

function entitlementToTier(entitlements: Record<string, unknown>): string | null {
  if (entitlements["business_access"] != null) return "business";
  if (entitlements["pro_access"] != null) return "pro";
  if (entitlements["personal_access"] != null) return "personal";
  return null;
}

function expiryFromEntitlement(entitlements: Record<string, any>, tier: string): string | null {
  const key =
    tier === "business" ? "business_access" :
    tier === "pro" ? "pro_access" :
    "personal_access";
  const exp = entitlements[key]?.expiration_at_ms ?? null;
  return exp ? new Date(Number(exp)).toISOString() : null;
}

async function processWebhook(req: Request): Promise<void> {
  try {
    const body = await req.json();
    const event = body.event;
    if (!event) return;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const appUserId: string = event.app_user_id ?? event.original_app_user_id ?? "";
    if (!appUserId) return;

    const eventType: string = event.type ?? "";

    const { data: byRcId } = await supabase
      .from("profiles")
      .select("user_id, trial_expires_at")
      .eq("revenuecat_customer_id", appUserId)
      .maybeSingle();

    let profileUserId = byRcId?.user_id ?? null;
    let trialExpiry: string | null = byRcId?.trial_expires_at ?? null;

    if (!profileUserId) {
      const { data: byUserId } = await supabase
        .from("profiles")
        .select("user_id, trial_expires_at")
        .eq("user_id", appUserId)
        .maybeSingle();
      if (byUserId) {
        profileUserId = byUserId.user_id;
        trialExpiry = byUserId.trial_expires_at;
      }
    }

    if (!profileUserId) return;

    if (["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE"].includes(eventType)) {
      const entitlements: Record<string, any> = event.subscriber?.entitlements ?? {};
      const tier = entitlementToTier(entitlements);

      if (tier) {
        const expiresAt = expiryFromEntitlement(entitlements, tier) ??
          (event.expiration_at_ms ? new Date(Number(event.expiration_at_ms)).toISOString() : null);

        await supabase
          .from("profiles")
          .update({
            subscription_tier: tier,
            subscription_expires_at: expiresAt,
            revenuecat_customer_id: appUserId,
          })
          .eq("user_id", profileUserId);
      }
    } else if (["EXPIRATION", "CANCELLATION"].includes(eventType)) {
      const stillInTrial = trialExpiry && new Date(trialExpiry) > new Date();
      if (!stillInTrial) {
        await supabase
          .from("profiles")
          .update({
            subscription_tier: "free",
            subscription_expires_at: null,
          })
          .eq("user_id", profileUserId);
      }
    }
  } catch {}
}
