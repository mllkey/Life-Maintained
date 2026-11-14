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

// ---------------------------------------------------------------------------------------------
// Entitlement grants bridge (Revision 7, Stage 2B.5).
//
// The ONE shared RevenueCat -> grants reconciliation, used by sync-subscription-from-rc (pull)
// and revenuecat-webhook (push). It writes the new grant model only. It never reads or writes
// the legacy profile columns, and its result is OBSERVED, not authoritative: decideEntitlement
// above and the legacy profile writers keep deciding what build 180 and the server gates see
// until the separately authorized cutover.
//
// Contract (Stage 0 F.4, Stage 1 SQL):
//   1. take the snapshot watermark (next_snapshot_seq) BEFORE the RevenueCat request starts;
//   2. fetch the complete current v1 subscriber for a VERIFIED app user id;
//   3. hand the whole entitlement set to apply_rc_snapshot, which serializes per user, ignores
//      stale watermarks, refuses unknown entitlement ids without revoking anything, and writes
//      its audit events in the same transaction.
// Anything short of a complete, authenticated snapshot fails closed: no grant is created,
// changed or revoked, and the caller gets a failure it can retry.
//
// Identity: rcAppUserId is the app user id the snapshot is fetched under. Both writers pass the
// Supabase user id, because the app logs in to RevenueCat with it. profiles.revenuecat_customer_id
// is never used as proof of ownership here.
//
// Still no Deno or Supabase imports: the database RPC and the subscriber fetch are injected.
// ---------------------------------------------------------------------------------------------

export type RcSubscriberLookup =
  | { ok: true; body: unknown }
  | { ok: false; status: number };

export interface RcHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type RcHttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<RcHttpResponse>;

export interface EntitlementRpcError {
  message: string;
  code?: string;
}

export type EntitlementRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: EntitlementRpcError | null }>;

export interface GrantReconcileDeps {
  rpc: EntitlementRpc;
  fetchSubscriber: (appUserId: string) => Promise<RcSubscriberLookup>;
}

/** The computed entitlement returned by the grant RPCs (entitlement.state), reduced to what is logged. */
export interface ShadowEntitlement {
  kind: "paid" | "trial" | "free";
  tier: PaidTier | null;
  source: string | null;
  expiresAt: string | null;
}

export type GrantReconcileFailure =
  | "seq_unavailable"
  | "rc_unavailable"
  | "rc_incomplete"
  | "apply_rejected";

export type GrantReconcileResult =
  | { status: "applied"; seq: number; shadow: ShadowEntitlement }
  | { status: "failed"; code: GrantReconcileFailure; detail: string };

export interface RcSnapshotEntry {
  expires_date: string | null;
  purchase_date: string | null;
}

export interface RcSnapshot {
  requestDateMs: number;
  entitlements: Record<string, RcSnapshotEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

/** null or absent -> null; a parseable date string -> canonical ISO; anything else -> undefined. */
function canonicalDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length === 0) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function failed(code: GrantReconcileFailure, detail: string): GrantReconcileResult {
  return { status: "failed", code, detail };
}

function rpcErrorText(error: EntitlementRpcError): string {
  return `${error.code ?? "no-code"} ${error.message}`;
}

function thrownText(e: unknown): string {
  return e instanceof Error ? e.message : "unexpected exception";
}

/**
 * Accept a v1 GET /subscribers response only if it is a complete snapshot: request_date_ms, a
 * subscriber object, and an entitlements object whose every entry carries an explicit
 * expires_date (null = non-expiring) that parses. Returns null otherwise. Active and expired
 * entries are both kept: the database decides validity against its own clock.
 */
export function parseRcSnapshot(body: unknown): RcSnapshot | null {
  if (!isRecord(body)) return null;
  const requestDateMs = body.request_date_ms;
  if (typeof requestDateMs !== "number" || !Number.isFinite(requestDateMs)) return null;
  const subscriber = body.subscriber;
  if (!isRecord(subscriber)) return null;
  const rawEntitlements = subscriber.entitlements;
  if (!isRecord(rawEntitlements)) return null;

  const entries: Array<[string, RcSnapshotEntry]> = [];
  for (const [id, entry] of Object.entries(rawEntitlements)) {
    if (id.length === 0 || !isRecord(entry)) return null;
    // A missing expires_date is an incomplete entry, never a lifetime grant.
    if (!("expires_date" in entry)) return null;
    const expires = canonicalDate(entry.expires_date);
    const purchased = canonicalDate(entry.purchase_date);
    if (expires === undefined || purchased === undefined) return null;
    entries.push([id, { expires_date: expires, purchase_date: purchased }]);
  }
  return { requestDateMs: Math.trunc(requestDateMs), entitlements: Object.fromEntries(entries) };
}

function parseShadowState(data: unknown): ShadowEntitlement | null {
  if (!isRecord(data)) return null;
  const kind = data.kind;
  if (kind !== "paid" && kind !== "trial" && kind !== "free") return null;
  const tier = data.effective_tier;
  return {
    kind,
    tier: typeof tier === "string" && isPaidTier(tier) ? tier : null,
    source: typeof data.source === "string" ? data.source : null,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
  };
}

async function takeSnapshotSeq(rpc: EntitlementRpc): Promise<{ seq: number } | { failure: string }> {
  try {
    const { data, error } = await rpc("next_snapshot_seq", {});
    if (error) return { failure: rpcErrorText(error) };
    if (typeof data !== "number" || !Number.isSafeInteger(data) || data <= 0) {
      return { failure: "unexpected watermark value" };
    }
    return { seq: data };
  } catch (e) {
    return { failure: thrownText(e) };
  }
}

/** GET the v1 subscriber with the trusted REST key. Never throws; non-2xx and network errors are reported. */
export async function fetchRcSubscriber(
  httpFetch: RcHttpFetch,
  apiKey: string,
  appUserId: string,
): Promise<RcSubscriberLookup> {
  const rcUrl = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
  let resp: RcHttpResponse;
  try {
    resp = await httpFetch(rcUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
  } catch (_e) {
    return { ok: false, status: 502 };
  }
  if (!resp.ok) return { ok: false, status: resp.status };
  try {
    return { ok: true, body: await resp.json() };
  } catch (_e) {
    return { ok: true, body: null };
  }
}

/**
 * Reconcile one verified customer. The subscriber lookup is returned as well so a caller that
 * also maintains the legacy profile can reuse the same RevenueCat response.
 */
export async function reconcileRcGrants(
  deps: GrantReconcileDeps,
  input: { userId: string; rcAppUserId: string; actor: string },
): Promise<{ lookup: RcSubscriberLookup; result: GrantReconcileResult }> {
  // Watermark first: a request that started earlier can never overwrite a later one.
  const mark = await takeSnapshotSeq(deps.rpc);
  const lookup = await deps.fetchSubscriber(input.rcAppUserId);

  if ("failure" in mark) return { lookup, result: failed("seq_unavailable", mark.failure) };
  if (!lookup.ok) return { lookup, result: failed("rc_unavailable", `RevenueCat HTTP ${lookup.status}`) };
  const snapshot = parseRcSnapshot(lookup.body);
  if (snapshot === null) {
    return { lookup, result: failed("rc_incomplete", "subscriber response is not a complete snapshot") };
  }

  try {
    const { data, error } = await deps.rpc("apply_rc_snapshot", {
      p_user_id: input.userId,
      p_rc_app_user_id: input.rcAppUserId,
      p_request_date_ms: snapshot.requestDateMs,
      p_seq: mark.seq,
      p_entitlements: snapshot.entitlements,
      p_actor: input.actor,
    });
    if (error) return { lookup, result: failed("apply_rejected", rpcErrorText(error)) };
    const shadow = parseShadowState(data);
    if (shadow === null) {
      return { lookup, result: failed("apply_rejected", "unexpected apply_rc_snapshot response") };
    }
    return { lookup, result: { status: "applied", seq: mark.seq, shadow } };
  } catch (e) {
    return { lookup, result: failed("apply_rejected", thrownText(e)) };
  }
}

/**
 * Reconcile a RevenueCat TRANSFER between two verified users in one transaction (transfer_rc):
 * the losing side's RevenueCat grants are replaced and the gaining side's are projected together
 * or not at all. Both watermarks are taken before either fetch. If either snapshot is missing or
 * incomplete nothing is written, so the losing owner is never revoked on a half-complete transfer.
 */
export async function reconcileRcTransfer(
  deps: GrantReconcileDeps,
  input: { fromUserId: string; toUserId: string; eventRef: string; actor: string },
): Promise<GrantReconcileResult> {
  const fromMark = await takeSnapshotSeq(deps.rpc);
  if ("failure" in fromMark) return failed("seq_unavailable", fromMark.failure);
  const toMark = await takeSnapshotSeq(deps.rpc);
  if ("failure" in toMark) return failed("seq_unavailable", toMark.failure);

  const fromLookup = await deps.fetchSubscriber(input.fromUserId);
  if (!fromLookup.ok) return failed("rc_unavailable", `RevenueCat HTTP ${fromLookup.status} (losing side)`);
  const toLookup = await deps.fetchSubscriber(input.toUserId);
  if (!toLookup.ok) return failed("rc_unavailable", `RevenueCat HTTP ${toLookup.status} (gaining side)`);

  const fromSnapshot = parseRcSnapshot(fromLookup.body);
  const toSnapshot = parseRcSnapshot(toLookup.body);
  if (fromSnapshot === null || toSnapshot === null) {
    return failed("rc_incomplete", "a transfer snapshot is not complete");
  }

  try {
    const { data, error } = await deps.rpc("transfer_rc", {
      p_from_user: input.fromUserId,
      p_to_user: input.toUserId,
      p_event_ref: input.eventRef,
      p_from_snapshot: fromSnapshot.entitlements,
      p_to_snapshot: toSnapshot.entitlements,
      p_seq_from: fromMark.seq,
      p_seq_to: toMark.seq,
      p_actor: input.actor,
    });
    if (error) return failed("apply_rejected", rpcErrorText(error));
    const shadow = parseShadowState(data);
    if (shadow === null) return failed("apply_rejected", "unexpected transfer_rc response");
    return { status: "applied", seq: toMark.seq, shadow };
  } catch (e) {
    return failed("apply_rejected", thrownText(e));
  }
}

/** One-line, secret-free description for logs and the webhook audit row. */
export function describeGrantReconcile(result: GrantReconcileResult): string {
  if (result.status === "applied") {
    return `applied seq=${result.seq} shadow=${result.shadow.kind}/${result.shadow.tier ?? "-"}/${result.shadow.source ?? "-"}`;
  }
  return `failed ${result.code}: ${result.detail}`;
}
