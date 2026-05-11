// Premium gate for AI edge functions. Mirrors lib/subscription.ts hasActivePremium
// truth table on the server. Throws PremiumGateError (status 403) if the caller
// is not on an active paid tier and not in an unexpired trial.
//
// NOTE: A null subscription_expires_at on a paid tier is treated as NOT premium.
// This matches lib/subscription.ts hasActivePremium and the reserve_receipt_scan
// RPC. There is no lifetime tier in this product — every paid tier carries an
// expiration that the RevenueCat webhook keeps current.
//
// Must be called with the admin (service-role) supabase client so RLS does
// not block the profiles read.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";

export class PremiumGateError extends Error {
  status = 403;
  constructor(message = "This feature requires a paid subscription.") {
    super(message);
    this.name = "PremiumGateError";
  }
}

const PAID_TIERS = ["personal", "pro", "business"];

export async function requirePaidTier(
  adminClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data, error } = await adminClient
    .from("profiles")
    .select("subscription_tier, trial_expires_at, subscription_expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    console.error("[premium-check] profile lookup failed:", error?.message ?? "no row");
    throw new PremiumGateError("Could not verify your subscription. Please try again.");
  }

  const now = Date.now();
  const tier = (data.subscription_tier ?? "").toString();
  const trialMs = data.trial_expires_at
    ? new Date(data.trial_expires_at as string).getTime()
    : 0;
  const subMs = data.subscription_expires_at
    ? new Date(data.subscription_expires_at as string).getTime()
    : 0;

  if (tier === "trial" && trialMs > now) return;
  if (PAID_TIERS.includes(tier) && subMs > now) return;

  throw new PremiumGateError();
}
