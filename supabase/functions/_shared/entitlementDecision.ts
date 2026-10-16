// Pure decision for reconciling a profile's subscription with RevenueCat.
// Shared by sync-subscription-from-rc (pull) and revenuecat-webhook (push) so
// both apply one rule: RevenueCat may upgrade or refresh a profile, but it may
// never downgrade an entitlement that was granted locally (promo code, manual
// grant, lifetime) and is still valid.
//
// Rule:
//   1. RC reports an ACTIVE entitlement            -> write RC's tier + expiry.
//   2. RC reports none/expired:
//      a. the profile's trial is still running      -> untouched ("trial").
//      b. local subscription_expires_at is in the
//         FUTURE                                    -> untouched ("local_grant_active").
//      c. local expiry is NULL on a paid tier       -> untouched ("lifetime_grant"),
//         unless the grant demonstrably came from RC: revenuecat_customer_id is
//         set AND RC itself reports a now-expired entitlement for that customer
//         -> downgrade ("rc_expired").
//      d. otherwise (expiry in the past, or no paid
//         tier)                                     -> downgrade ("local_expired").
//
// Granting a lifetime/manual tier to a FORMER RevenueCat subscriber: clear
// revenuecat_customer_id or set an explicit future expiry, otherwise rule 2c
// treats RC's lapsed entitlement as proof the grant came from RC.
//
// No Deno or Supabase imports: pure, so it can be exercised by a plain Deno
// or Node harness with a fixed clock.

export type PaidTier = "personal" | "pro" | "business";

export const PAID_TIERS: readonly PaidTier[] = ["personal", "pro", "business"];

export function isPaidTier(tier: string | null | undefined): tier is PaidTier {
  return PAID_TIERS.includes(tier as PaidTier);
}

export interface LocalEntitlement {
  subscription_tier: string | null;
  subscription_expires_at: string | null;
  revenuecat_customer_id: string | null;
  trial_expires_at: string | null;
}

export interface RcEntitlement {
  /** Tier mapped from RC's ACTIVE entitlements; null when RC reports none or only expired ones. */
  tier: PaidTier | null;
  /** Latest expiry among RC's active entitlements; null for non-expiring ones. */
  expiresAt: string | null;
  /** True when RC lists at least one entitlement whose expires_date is in the past. */
  expiredEntitlement: boolean;
}

export type EntitlementDecision =
  | { action: "write_rc"; tier: PaidTier; expiresAt: string | null }
  | { action: "untouched"; reason: "trial" | "local_grant_active" | "lifetime_grant" }
  | { action: "downgrade"; reason: "rc_expired" | "local_expired" };

function futureMs(iso: string | null | undefined, nowMs: number): boolean {
  if (typeof iso !== "string" || iso.length === 0) return false;
  const ms = new Date(iso).getTime();
  return !Number.isNaN(ms) && ms > nowMs;
}

export function decideEntitlement(
  local: LocalEntitlement,
  rc: RcEntitlement,
  nowMs: number = Date.now(),
): EntitlementDecision {
  if (rc.tier !== null) {
    return { action: "write_rc", tier: rc.tier, expiresAt: rc.expiresAt };
  }

  if (futureMs(local.trial_expires_at, nowMs)) {
    return { action: "untouched", reason: "trial" };
  }

  if (futureMs(local.subscription_expires_at, nowMs)) {
    return { action: "untouched", reason: "local_grant_active" };
  }

  const expiryIsNull = local.subscription_expires_at == null || local.subscription_expires_at === "";
  if (expiryIsNull && isPaidTier(local.subscription_tier)) {
    const hasRcId = typeof local.revenuecat_customer_id === "string" && local.revenuecat_customer_id.length > 0;
    if (hasRcId && rc.expiredEntitlement) {
      return { action: "downgrade", reason: "rc_expired" };
    }
    return { action: "untouched", reason: "lifetime_grant" };
  }

  return { action: "downgrade", reason: "local_expired" };
}
