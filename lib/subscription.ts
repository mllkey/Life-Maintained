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
    if (
      profile.subscription_tier === "business" &&
      profile.subscription_expires_at &&
      new Date(profile.subscription_expires_at) > new Date()
    ) return true;
    return false;
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

export function trialDaysRemaining(profile: Profile | null | undefined): number {
  if (!profile || !isInTrial(profile) || !profile.trial_expires_at) return 0;
  try {
    const ms = new Date(profile.trial_expires_at).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
}

export function scansRemaining(profile: Profile | null | undefined): number {
  return Math.max(0, scanLimit(profile) - ((profile?.monthly_scan_count) ?? 0));
}

export async function incrementScanCount(userId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("monthly_scan_count")
      .eq("user_id", userId)
      .single();
    const current = (data as any)?.monthly_scan_count ?? 0;
    await supabase
      .from("profiles")
      .update({ monthly_scan_count: current + 1 })
      .eq("user_id", userId);
  } catch {}
}

export async function checkAndResetScanCount(userId: string, profile: Profile): Promise<void> {
  try {
    if (!profile.scan_count_reset_at) return;
    const resetDate = new Date(profile.scan_count_reset_at);
    const now = new Date();
    const sameMonth =
      resetDate.getFullYear() === now.getFullYear() &&
      resetDate.getMonth() === now.getMonth();
    if (!sameMonth) {
      await supabase
        .from("profiles")
        .update({
          monthly_scan_count: 0,
          scan_count_reset_at: now.toISOString(),
        })
        .eq("user_id", userId);
    }
  } catch {}
}
