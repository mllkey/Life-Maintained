let rcConfigureResolve: (() => void) | null = null;
export const rcReady = new Promise<void>((resolve) => { rcConfigureResolve = resolve; });
export function signalRcReady() { rcConfigureResolve?.(); }

export type RcTier = "personal" | "pro" | "business" | null;

export function extractTierHintFromCustomerInfo(
  customerInfo: { entitlements?: { active?: Record<string, unknown> } } | null | undefined
): RcTier {
  const active = customerInfo?.entitlements?.active ?? {};
  if ("business_access" in active) return "business";
  if ("pro_access" in active) return "pro";
  if ("personal_access" in active) return "personal";
  return null;
}

export type SyncSuccessAction = "synced" | "downgraded" | "skipped_trial";
export type SyncSuccessTier = "personal" | "pro" | "business" | "free" | null;

export type SyncResult =
  | { ok: true; tier: SyncSuccessTier; expiresAt: string | null; action: SyncSuccessAction }
  | { ok: false; error: string };

function isSyncSuccessTier(value: unknown): value is SyncSuccessTier {
  return value === "personal" || value === "pro" || value === "business" || value === "free" || value === null;
}

function isSyncSuccessAction(value: unknown): value is SyncSuccessAction {
  return value === "synced" || value === "downgraded" || value === "skipped_trial";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSyncResponse(data: unknown): SyncResult {
  if (!isRecord(data)) {
    return { ok: false, error: "Invalid response" };
  }

  const tier = data.tier;
  const expiresAt = data.expiresAt;
  const action = data.action;

  if (!isSyncSuccessTier(tier)) return { ok: false, error: "Invalid response" };
  if (!(typeof expiresAt === "string" || expiresAt === null)) return { ok: false, error: "Invalid response" };
  if (!isSyncSuccessAction(action)) return { ok: false, error: "Invalid response" };

  return { ok: true, tier, expiresAt, action };
}

export async function syncSubscriptionFromRc(): Promise<SyncResult> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.functions.invoke("sync-subscription-from-rc", {
    method: "POST",
  });

  if (error) {
    console.error("[revenuecat] sync failed:", error);
    return { ok: false, error: error.message ?? "Sync failed" };
  }

  return parseSyncResponse(data);
}
