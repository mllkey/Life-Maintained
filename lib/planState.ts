/**
 * lib/planState.ts
 *
 * Single source of truth for plan/trial COPY (badges, banners, paywall
 * subtitles). Pure: no React, no Supabase, so it can be exercised by a plain
 * TypeScript harness.
 *
 * Precedence (owner-confirmed):
 *   (a) subscription_tier is a paid tier AND subscription_expires_at is NULL or
 *       in the future            -> "paid"  (never trial copy)
 *   (b) else trial_expires_at is in the future -> "trial"
 *   (c) else                                   -> "free"
 *
 * Feature gating (hasActivePremium & friends in lib/subscription.ts) is NOT
 * derived from this; this module only decides what the user is told.
 */

export type PaidTier = "personal" | "pro" | "business";
export type PlanKind = "paid" | "trial" | "free";

export interface PlanCopyProfile {
  subscription_tier?: string | null;
  subscription_expires_at?: string | null;
  trial_expires_at?: string | null;
}

export interface PlanState {
  kind: PlanKind;
  /** Paid tier for "paid"; the paid tier a trial is attached to (if any) for "trial"; null for "free". */
  tier: PaidTier | null;
  /** "paid": subscription expiry (null = none on file). "trial": trial expiry. "free": null. */
  expiresAt: Date | null;
  /** Whole days until expiresAt (>= 0), or null when there is no expiry. */
  daysRemaining: number | null;
}

const PAID_TIERS: readonly PaidTier[] = ["personal", "pro", "business"];

export function isPaidTier(tier: string | null | undefined): tier is PaidTier {
  return PAID_TIERS.includes(tier as PaidTier);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysUntil(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 86400000));
}

export function planState(profile: PlanCopyProfile | null | undefined, now: Date = new Date()): PlanState {
  const tier = profile?.subscription_tier ?? null;
  const subExpiry = parseDate(profile?.subscription_expires_at);
  const trialExpiry = parseDate(profile?.trial_expires_at);

  if (isPaidTier(tier) && (subExpiry == null || subExpiry > now)) {
    return { kind: "paid", tier, expiresAt: subExpiry, daysRemaining: subExpiry ? daysUntil(subExpiry, now) : null };
  }
  if (trialExpiry && trialExpiry > now) {
    return { kind: "trial", tier: isPaidTier(tier) ? tier : null, expiresAt: trialExpiry, daysRemaining: daysUntil(trialExpiry, now) };
  }
  return { kind: "free", tier: null, expiresAt: null, daysRemaining: null };
}

export function paidTierLabel(tier: PaidTier): string {
  return tier === "personal" ? "Personal" : tier === "pro" ? "Pro" : "Business";
}
