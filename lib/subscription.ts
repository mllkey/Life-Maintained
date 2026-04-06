import { supabase } from "./supabase";

export type Profile = {
  user_id?: string;
  subscription_tier: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  subscription_expires_at: string | null;
  revenuecat_customer_id: string | null;
  push_token: string | null;
  monthly_scan_count: number;
  scan_count_reset_at: string | null;
  onboarding_completed: boolean | null;
};

const PAID_TIERS = ["personal", "pro", "business"];

export function hasActivePremium(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  try {
    if (
      profile.subscription_tier === "trial" &&
      profile.trial_expires_at &&
      new Date(profile.trial_expires_at) > new Date()
    ) return true;

    if (
      PAID_TIERS.includes(profile.subscription_tier ?? "") &&
      profile.subscription_expires_at &&
      new Date(profile.subscription_expires_at) > new Date()
    ) return true;

    return false;
  } catch {
    return false;
  }
}

export function hasPersonalOrAbove(profile: Profile | null | undefined): boolean {
  return hasActivePremium(profile);
}

export function hasProOrAbove(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  try {
    if (
      profile.subscription_tier === "trial" &&
      profile.trial_expires_at &&
      new Date(profile.trial_expires_at) > new Date()
    ) return true;
    if (
      ["pro", "business"].includes(profile.subscription_tier ?? "") &&
      profile.subscription_expires_at &&
      new Date(profile.subscription_expires_at) > new Date()
    ) return true;
    return false;
  } catch {
    return false;
  }
}

export function hasBusiness(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  try {
    return (
      profile.subscription_tier === "business" &&
      !!profile.subscription_expires_at &&
      new Date(profile.subscription_expires_at) > new Date()
    );
  } catch {
    return false;
  }
}

export function vehicleLimit(profile: Profile | null | undefined): number {
  if (hasBusiness(profile)) return Infinity;
  if (hasProOrAbove(profile)) return 6;
  if (hasPersonalOrAbove(profile)) return 3;
  return 1;
}

export function propertyLimit(profile: Profile | null | undefined): number {
  if (hasBusiness(profile)) return Infinity;
  if (hasProOrAbove(profile)) return 5;
  if (hasPersonalOrAbove(profile)) return 2;
  return 1;
}

export function personLimit(profile: Profile | null | undefined): number {
  if (hasBusiness(profile)) return Infinity;
  if (hasProOrAbove(profile)) return 5;
  if (hasPersonalOrAbove(profile)) return 1;
  return 1;
}

export function petLimit(profile: Profile | null | undefined): number {
  if (hasBusiness(profile)) return Infinity;
  if (hasProOrAbove(profile)) return 3;
  if (hasPersonalOrAbove(profile)) return 1;
  return 0;
}

export function scanLimit(profile: Profile | null | undefined): number {
  if (hasBusiness(profile)) return 100;
  if (hasProOrAbove(profile)) return 30;
  if (hasPersonalOrAbove(profile)) return 15;
  return 0;
}

export function isInTrial(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  try {
    return (
      profile.subscription_tier === "trial" &&
      !!profile.trial_expires_at &&
      new Date(profile.trial_expires_at) > new Date()
    );
  } catch {
    return false;
  }
}

export function isFreeTier(profile: Profile | null | undefined): boolean {
  return !hasActivePremium(profile);
}

/**
 * Legacy UI helper only.
 * Receipt scan enforcement no longer relies on profile.monthly_scan_count.
 */
export function scansRemaining(profile: Profile | null | undefined): number {
  return Math.max(0, scanLimit(profile) - ((profile?.monthly_scan_count) ?? 0));
}

export function trialDaysRemaining(profile: Profile | null | undefined): number {
  if (!profile || !isInTrial(profile) || !profile.trial_expires_at) return 0;
  try {
    const ms = new Date(profile.trial_expires_at).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
}

/**
 * Legacy no-op. Receipt scan quota is now enforced by receipt_scans rows.
 */
export async function incrementScanCount(_userId: string): Promise<void> {
  return;
}

/**
 * Legacy no-op. Do not mutate profile scan counters anymore.
 */
export async function checkAndResetScanCount(_userId: string, _profile: Profile): Promise<void> {
  return;
}

/**
 * New source-of-truth helper for any future UI that wants live quota from backend.
 */
export async function getLiveScanQuota(): Promise<{
  tier: string | null;
  scans_used: number;
  scans_limit: number;
  scans_remaining: number;
} | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;

    const { data, error } = await supabase.rpc("get_scan_quota", {
      p_user_id: session.user.id,
    });

    if (error || !data) return null;

    return {
      tier: data.tier ?? null,
      scans_used: Number(data.scans_used ?? 0),
      scans_limit: Number(data.scans_limit ?? 0),
      scans_remaining: Number(data.scans_remaining ?? 0),
    };
  } catch {
    return null;
  }
}
