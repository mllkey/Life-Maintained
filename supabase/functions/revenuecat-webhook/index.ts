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

    if (["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE"].includes(eventType)) {
      const expiresAt = event.expiration_at_ms
        ? new Date(Number(event.expiration_at_ms)).toISOString()
        : null;

      const { data: byRcId } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("revenuecat_customer_id", appUserId)
        .maybeSingle();

      const filter = byRcId?.user_id
        ? { column: "user_id", value: byRcId.user_id }
        : { column: "user_id", value: appUserId };

      await supabase
        .from("profiles")
        .update({
          subscription_tier: "premium",
          subscription_expires_at: expiresAt,
        })
        .eq(filter.column, filter.value);

    } else if (["EXPIRATION", "CANCELLATION"].includes(eventType)) {
      const { data: byRcId } = await supabase
        .from("profiles")
        .select("user_id, trial_expires_at")
        .eq("revenuecat_customer_id", appUserId)
        .maybeSingle();

      let profileUserId = byRcId?.user_id ?? appUserId;
      let trialExpiry = byRcId?.trial_expires_at ?? null;

      if (!byRcId) {
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
