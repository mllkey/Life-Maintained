import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.98.0";
import {
  decideEntitlement,
  describeGrantReconcile,
  fetchRcSubscriber,
  reconcileRcGrants,
  reconcileRcTransfer,
  type GrantReconcileDeps,
} from "../_shared/entitlementDecision.ts";


const UPGRADE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
  "UNCANCELLATION",
]);
const DOWNGRADE_EVENTS = new Set(["EXPIRATION"]);
const EXTEND_EVENTS = new Set(["SUBSCRIPTION_EXTENDED"]);
const PASSIVE_EVENTS = new Set(["CANCELLATION", "BILLING_ISSUE", "PRODUCT_CHANGE"]);

// Consumable Scan Packs: store product id -> credit source + fixed grant size.
const SCAN_PACKS: Record<string, { source: string; scans: number }> = {
  scan_pack_10: { source: "pack_10", scans: 10 },
  scan_pack_25: { source: "pack_25", scans: 25 },
};

const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function entitlementIdsToTier(entitlementIds: string[]): string | null {
  if (entitlementIds.includes("business_access")) return "business";
  if (entitlementIds.includes("pro_access")) return "pro";
  if (entitlementIds.includes("personal_access")) return "personal";
  return null;
}

function extractEntitlementIds(event: any): string[] {
  if (Array.isArray(event.entitlement_ids)) return event.entitlement_ids;
  if (event.entitlements && typeof event.entitlements === "object") {
    return Object.keys(event.entitlements);
  }
  if (event.subscriber?.entitlements && typeof event.subscriber.entitlements === "object") {
    return Object.keys(event.subscriber.entitlements);
  }
  return [];
}

function extractExpirationISO(event: any): string | null {
  if (event.expiration_at_ms != null) {
    const n = Number(event.expiration_at_ms);
    if (!isNaN(n)) return new Date(n).toISOString();
  }
  if (typeof event.expiration_at === "string") {
    const d = new Date(event.expiration_at);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

async function fallbackEventId(event: any): Promise<string> {
  const seed = `${event.app_user_id ?? ""}|${event.event_timestamp_ms ?? ""}|${event.type ?? ""}`;
  const data = new TextEncoder().encode(seed);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Normalize UUID-like input into canonical lowercase 8-4-4-4-12 form for the
// user_id uuid lookup. We intentionally do not constrain UUID version because
// Postgres uuid does not. This accepts common valid inputs we may encounter
// indirectly (uppercase, brace-wrapped, hyphenless) while still rejecting
// RevenueCat anonymous IDs and other non-UUID strings before they hit Postgres.
function normalizeUuidCandidate(s: string): string | null {
  const trimmed = s.trim();

  // Accept optional surrounding braces.
  const unwrapped =
    trimmed.startsWith("{") && trimmed.endsWith("}")
      ? trimmed.slice(1, -1)
      : trimmed;

  // Remove hyphens, then validate exactly 32 hex chars.
  const compact = unwrapped.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) return null;

  const lower = compact.toLowerCase();
  return [
    lower.slice(0, 8),
    lower.slice(8, 12),
    lower.slice(12, 16),
    lower.slice(16, 20),
    lower.slice(20, 32),
  ].join("-");
}

type ProcessResult =
  | { status: "processed"; note?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

type WebhookProfile = {
  user_id: string;
  trial_expires_at: string | null;
  subscription_tier: string | null;
  subscription_expires_at: string | null;
  revenuecat_customer_id: string | null;
};

const PROFILE_COLUMNS = "user_id, trial_expires_at, subscription_tier, subscription_expires_at, revenuecat_customer_id";

// Grants bridge (Revision 7, Stage 2B.6): outcome of reconciling the grant model for one event.
type GrantStep =
  | { status: "applied"; note: string }
  | { status: "not_applicable"; note: string }
  | { status: "failed"; error: string };

type VerifiedOwner =
  | { kind: "none" }
  | { kind: "one"; userId: string }
  | { kind: "error"; reason: string };

// Durable processed/succeeded distinction (Revision 7, Stage 2B.6). When the legacy step of an
// event completed but its grant step failed, the event row is stored as failed (so RevenueCat
// redelivers) with this marker in its error column. A redelivery that finds the marker must NOT
// run the legacy profile writer again, because by then the payload may be stale: it restores the
// recorded legacy outcome and retries only the grant step.
type LegacyDone =
  | { status: "processed"; note?: string }
  | { status: "skipped"; reason: string };

const LEGACY_DONE_PREFIX = "legacy-done ";

function legacyDoneMarker(legacy: LegacyDone, grantsError: string): string {
  return LEGACY_DONE_PREFIX + JSON.stringify({
    status: legacy.status,
    note: legacy.status === "skipped" ? legacy.reason : legacy.note ?? null,
    grants: grantsError,
  });
}

function parseLegacyDone(stored: unknown): LegacyDone | null {
  if (typeof stored !== "string" || stored.startsWith(LEGACY_DONE_PREFIX) === false) return null;
  try {
    const parsed: unknown = JSON.parse(stored.slice(LEGACY_DONE_PREFIX.length));
    if (typeof parsed !== "object" || parsed === null) return null;
    const fields: { status?: unknown; note?: unknown } = parsed;
    const note = typeof fields.note === "string" ? fields.note : null;
    if (fields.status === "processed") return note === null ? { status: "processed" } : { status: "processed", note };
    if (fields.status === "skipped") return { status: "skipped", reason: note ?? "" };
    return null;
  } catch (_e) {
    return null;
  }
}

type ProfileMatch =
  | { kind: "none" }
  | { kind: "one"; profile: WebhookProfile }
  | { kind: "ambiguous"; reason: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("OK", { status: 200, headers: corsHeaders });

  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? "";
  if (!secret) {
    console.error("[WEBHOOK] REVENUECAT_WEBHOOK_SECRET not set");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }

  let authHeader = "";
  for (const [k, v] of req.headers.entries()) {
    if (k.toLowerCase() === "authorization") { authHeader = v; break; }
  }
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  if (!provided || !constantTimeEqual(provided, secret)) {
    console.warn("[WEBHOOK] Auth failed");
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  let rawBody = "";
  try { rawBody = await req.text(); }
  catch (e) {
    console.error("[WEBHOOK] Failed to read body:", e);
    return new Response("Bad request", { status: 400, headers: corsHeaders });
  }

  // Process synchronously so transient DB errors return 5xx and RevenueCat
  // retries. Background processing silently dropped failures.
  try {
    await processWebhook(rawBody);
  } catch (e) {
    console.error("[WEBHOOK] processWebhook failed, returning 500 for retry:", e);
    return new Response("Processing failed", { status: 500, headers: corsHeaders });
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});

async function processWebhook(rawBody: string): Promise<void> {
  let body: any;
  try { body = JSON.parse(rawBody); }
  catch (e) { console.error("[WEBHOOK] Invalid JSON:", e); return; }

  const event = body.event;
  if (!event) { console.warn("[WEBHOOK] Missing event"); return; }

  const env = Deno.env;
  const supabase = createClient(
    env.get("SUPABASE_URL") ?? "",
    env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const rcApiKey = env.get("REVENUECAT_REST_API_KEY") ?? "";

  const eventId: string = event.id ?? await fallbackEventId(event);
  const eventType: string = event.type ?? "UNKNOWN";
  const appUserId: string = event.app_user_id ?? event.original_app_user_id ?? "";

  const { error: auditErr } = await supabase
    .from("webhook_events")
    .insert({
      source: "revenuecat",
      event_id: eventId,
      event_type: eventType,
      app_user_id: appUserId || null,
      payload: body,
      status: "received",
    });

  let legacyDone: LegacyDone | null = null;
  if (auditErr) {
    if (auditErr.code === "23505") {
      // Event id already seen. Only ack if the prior attempt actually resolved; a
      // 'received' (in-flight/crashed) or 'failed' row must RE-PROCESS so RevenueCat's
      // retry can complete the grant. Re-processing is idempotent (scan_credits
      // .transaction_id UNIQUE; tier writes are same-value updates).
      const { data: prior } = await supabase
        .from("webhook_events").select("status, error")
        .eq("source", "revenuecat").eq("event_id", eventId).maybeSingle();
      if (prior?.status === "processed" || prior?.status === "skipped") {
        console.log(`[WEBHOOK] Duplicate ${eventId} already ${prior.status}`);
        return;
      }
      // Legacy step already completed on an earlier delivery; only the grant step is owed.
      if (prior?.status === "failed") legacyDone = parseLegacyDone(prior.error);
      console.log(`[WEBHOOK] Duplicate ${eventId} (prior=${prior?.status ?? "unknown"}) — re-processing`);
    } else {
      console.error("[WEBHOOK] Audit insert failed:", auditErr);
    }
  }

  const eventTs = Number(event.event_timestamp_ms ?? 0);
  if (eventTs > 0 && Date.now() - eventTs > MAX_EVENT_AGE_MS) {
    await markEvent(supabase, eventId, "skipped", "Event older than 7 days");
    return;
  }

  console.log(`[WEBHOOK] Processing ${eventType} for ${appUserId || "(no app_user_id)"}`);

  const result: ProcessResult = legacyDone === null
    ? await handleEvent(supabase, event, eventType, appUserId)
    : legacyDone;
  if (legacyDone !== null) console.log(`[WEBHOOK] ${eventId}: legacy step already ${legacyDone.status}; retrying the grant step only`);

  // Grants bridge (Revision 7, Stage 2B.6). The event is only a trigger: the grant model is
  // reconciled from RevenueCat's CURRENT state for the verified owner, never from the event
  // payload. The legacy handler above is unchanged and stays authoritative. The event is
  // recorded as processed/skipped only after the grant write has committed; a failed grant
  // write stores it as failed WITH the completed legacy outcome and returns 5xx, so RevenueCat
  // redelivers and the redelivery retries the grant step without repeating the legacy write.
  let grantsNote: string | null = null;
  if (result.status !== "failed") {
    const grants = await reconcileGrantsForEvent(supabase, rcApiKey, event, eventType, appUserId, eventId);
    if (grants.status === "failed") {
      console.error(`[WEBHOOK] grants reconcile failed for ${eventId}: ${grants.error}`);
      await markEvent(supabase, eventId, "failed", legacyDoneMarker(result, grants.error));
      throw new Error(`grants reconcile failed: ${grants.error}`);
    }
    grantsNote = grants.note;
    console.log(`[WEBHOOK] grants for ${eventId}: ${grants.note}`);
  }

  await markEvent(
    supabase,
    eventId,
    result.status,
    result.status === "failed"
      ? result.error
      : withGrantsNote((result as any).reason ?? (result as any).note ?? null, grantsNote)
  );

  if (result.status === "failed") {
    throw new Error(`handleEvent failed: ${result.error}`);
  }
}

async function markEvent(
  supabase: SupabaseClient,
  eventId: string,
  status: "processed" | "skipped" | "failed",
  error: string | null
): Promise<void> {
  let q = supabase
    .from("webhook_events")
    .update({ status, error, processed_at: new Date().toISOString() })
    .eq("source", "revenuecat")
    .eq("event_id", eventId);
  // Never walk a resolved event back to 'failed' (concurrent-duplicate race).
  if (status === "failed") q = q.neq("status", "processed").neq("status", "skipped");
  const { error: updateErr } = await q;
  if (updateErr) console.error(`[WEBHOOK] markEvent failed for ${eventId}:`, updateErr);
}

function withGrantsNote(legacy: string | null, grants: string | null): string | null {
  if (grants === null) return legacy;
  return legacy === null ? `grants: ${grants}` : `${legacy} | grants: ${grants}`;
}

// Grant-model ownership: the owner of a RevenueCat customer is the ONE profile whose user_id is
// itself among the identities RevenueCat reports for that customer (the app logs in to RevenueCat
// with the Supabase user id). profiles.revenuecat_customer_id is deliberately not consulted here:
// it is not proof of ownership. More than one match is an ownership conflict, not a guess.
async function resolveVerifiedOwner(
  supabase: SupabaseClient,
  identities: unknown[],
): Promise<VerifiedOwner> {
  const uuids: string[] = [];
  for (const identity of identities) {
    const normalized = typeof identity === "string" ? normalizeUuidCandidate(identity) : null;
    if (normalized !== null && uuids.includes(normalized) === false) uuids.push(normalized);
  }
  if (uuids.length === 0) return { kind: "none" };

  const { data, error } = await supabase.from("profiles").select("user_id").in("user_id", uuids);
  if (error) return { kind: "error", reason: `owner lookup failed: ${error.message}` };
  const rows: Array<{ user_id: string }> = Array.isArray(data) ? data : [];
  if (rows.length > 1) return { kind: "error", reason: `${rows.length} profiles match this customer's identities` };
  if (rows.length === 1) return { kind: "one", userId: rows[0].user_id };
  return { kind: "none" };
}

// Whether any profile still references one of these RevenueCat ids through the legacy
// revenuecat_customer_id column. It only tells "unknown customer" apart from "known customer whose
// ownership cannot be verified"; it never selects who receives a grant. null = lookup failed.
async function hasLegacyLink(
  supabase: SupabaseClient,
  identities: unknown[],
): Promise<boolean | null> {
  const ids: string[] = [];
  for (const identity of identities) {
    if (typeof identity === "string" && identity.length > 0 && ids.includes(identity) === false) ids.push(identity);
  }
  if (ids.length === 0) return false;
  const { data, error } = await supabase.from("profiles").select("user_id").in("revenuecat_customer_id", ids).limit(1);
  if (error) return null;
  return Array.isArray(data) && data.length > 0;
}

async function reconcileGrantsForEvent(
  supabase: SupabaseClient,
  rcApiKey: string,
  event: Record<string, unknown>,
  eventType: string,
  appUserId: string,
  eventId: string,
): Promise<GrantStep> {
  const unverified = "customer is referenced by a profile but RevenueCat's identities do not verify its owner; no grant written";
  try {
    if (rcApiKey.length === 0) return { status: "failed", error: "REVENUECAT_REST_API_KEY not set" };

    const deps: GrantReconcileDeps = {
      rpc: (fn: string, args: Record<string, unknown>) => supabase.rpc(fn, args),
      fetchSubscriber: (id: string) => fetchRcSubscriber(fetch, rcApiKey, id),
    };
    const actor = "revenuecat-webhook";

    if (eventType === "TRANSFER") {
      const from: unknown[] = Array.isArray(event.transferred_from) ? event.transferred_from : [];
      const to: unknown[] = Array.isArray(event.transferred_to) ? event.transferred_to : [];
      const fromOwner = await resolveVerifiedOwner(supabase, from);
      if (fromOwner.kind === "error") return { status: "failed", error: `TRANSFER losing side: ${fromOwner.reason}` };
      const toOwner = await resolveVerifiedOwner(supabase, to);
      if (toOwner.kind === "error") return { status: "failed", error: `TRANSFER gaining side: ${toOwner.reason}` };

      if (fromOwner.kind === "none" && toOwner.kind === "none") {
        const linked = await hasLegacyLink(supabase, [...from, ...to]);
        if (linked === null) return { status: "failed", error: "TRANSFER legacy link lookup failed" };
        if (linked) return { status: "failed", error: `TRANSFER: ${unverified}` };
        return { status: "not_applicable", note: "TRANSFER with no mapped customer" };
      }
      // One side only: completing it would mean revoking or granting on half a transfer.
      if (fromOwner.kind === "none" || toOwner.kind === "none") {
        return { status: "failed", error: "TRANSFER maps to a verified user on one side only; nothing written, retry" };
      }
      if (fromOwner.userId === toOwner.userId) {
        const same = await reconcileRcGrants(deps, { userId: toOwner.userId, rcAppUserId: toOwner.userId, actor });
        if (same.result.status === "failed") return { status: "failed", error: describeGrantReconcile(same.result) };
        return { status: "applied", note: `TRANSFER within one user, ${describeGrantReconcile(same.result)}` };
      }
      const moved = await reconcileRcTransfer(deps, {
        fromUserId: fromOwner.userId,
        toUserId: toOwner.userId,
        eventRef: eventId,
        actor,
      });
      if (moved.status === "failed") return { status: "failed", error: `TRANSFER ${describeGrantReconcile(moved)}` };
      return { status: "applied", note: `TRANSFER ${describeGrantReconcile(moved)}` };
    }

    const aliases: unknown[] = Array.isArray(event.aliases) ? event.aliases : [];
    const identities: unknown[] = [appUserId, event.original_app_user_id, ...aliases];
    const owner = await resolveVerifiedOwner(supabase, identities);
    if (owner.kind === "error") return { status: "failed", error: owner.reason };
    if (owner.kind === "none") {
      const linked = await hasLegacyLink(supabase, identities);
      if (linked === null) return { status: "failed", error: "legacy link lookup failed" };
      if (linked) return { status: "failed", error: unverified };
      return { status: "not_applicable", note: "no mapped customer" };
    }

    const single = await reconcileRcGrants(deps, { userId: owner.userId, rcAppUserId: owner.userId, actor });
    if (single.result.status === "failed") return { status: "failed", error: describeGrantReconcile(single.result) };
    return { status: "applied", note: describeGrantReconcile(single.result) };
  } catch (e) {
    return { status: "failed", error: `unexpected: ${e instanceof Error ? e.message : "exception"}` };
  }
}

async function findProfile(
  supabase: SupabaseClient,
  candidates: string[]
): Promise<ProfileMatch> {
  const seen = new Set<string>();
  const ids = candidates.filter((c): c is string => typeof c === "string" && c.length > 0 && !seen.has(c) && (seen.add(c), true));
  if (ids.length === 0) return { kind: "none" };

  const { data: byRc, error: rcErr } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .in("revenuecat_customer_id", ids);
  if (rcErr) {
    return { kind: "ambiguous", reason: `findProfile rc lookup failed: ${rcErr.message}` };
  }
  if (byRc && byRc.length > 1) {
    return { kind: "ambiguous", reason: `Multiple profiles matched revenuecat_customer_id candidates: ${ids.join(", ")}` };
  }
  if (byRc && byRc.length === 1) {
    return { kind: "one", profile: byRc[0] as any };
  }

  // user_id is a uuid column — only query with candidates that can be
  // normalized into canonical UUID form first. Non-UUID aliases
  // (RCAnonymousID, etc.) are still searched via the revenuecat_customer_id
  // lookup above.
  const normalizedUuidIds = Array.from(
    new Set(
      ids
        .map(normalizeUuidCandidate)
        .filter((v): v is string => v !== null)
    )
  );
  const filteredOut = ids.length - normalizedUuidIds.length;
  if (filteredOut > 0) {
    console.log(`[WEBHOOK] findProfile: filtered ${filteredOut} non-UUID candidate(s) from user_id lookup`);
  }
  if (normalizedUuidIds.length > 0) {
    const { data: byUser, error: userErr } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .in("user_id", normalizedUuidIds);
    if (userErr) {
      return { kind: "ambiguous", reason: `findProfile user lookup failed: ${userErr.message}` };
    }
    if (byUser && byUser.length > 1) {
      return { kind: "ambiguous", reason: `Multiple profiles matched user_id candidates: ${normalizedUuidIds.join(", ")}` };
    }
    if (byUser && byUser.length === 1) {
      return { kind: "one", profile: byUser[0] as any };
    }
  }

  return { kind: "none" };
}

async function handleEvent(
  supabase: SupabaseClient,
  event: any,
  eventType: string,
  appUserId: string
): Promise<ProcessResult> {
  if (eventType === "TRANSFER") {
    const from: string[] = Array.isArray(event.transferred_from) ? event.transferred_from : [];
    const to: string[] = Array.isArray(event.transferred_to) ? event.transferred_to : [];
    if (to.length === 0) return { status: "skipped", reason: "TRANSFER with no transferred_to" };
    if (from.length === 0) return { status: "skipped", reason: "TRANSFER with no transferred_from" };

    const destinationId = to[0];

    const { data: fromProfiles, error: fromErr } = await supabase
      .from("profiles")
      .select("user_id, revenuecat_customer_id")
      .in("revenuecat_customer_id", from);
    if (fromErr) return { status: "failed", error: `TRANSFER from-lookup failed: ${fromErr.message}` };

    if (!fromProfiles || fromProfiles.length === 0) {
      return { status: "skipped", reason: "TRANSFER but no profile matches transferred_from" };
    }

    if (fromProfiles.length > 1) {
      return { status: "failed", error: `TRANSFER matched ${fromProfiles.length} profiles — manual review required` };
    }

    const sourceProfile = fromProfiles[0];

    const { data: destProfiles, error: destErr } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("revenuecat_customer_id", destinationId);
    if (destErr) return { status: "failed", error: `TRANSFER dest-lookup failed: ${destErr.message}` };

    if (destProfiles && destProfiles.length > 0) {
      const conflicts = destProfiles.filter(p => p.user_id !== sourceProfile.user_id);
      if (conflicts.length > 0) {
        return { status: "skipped", reason: `TRANSFER destination ${destinationId} already mapped to another profile` };
      }
    }

    const { error: updErr } = await supabase
      .from("profiles")
      .update({ revenuecat_customer_id: destinationId })
      .eq("user_id", sourceProfile.user_id);
    if (updErr) return { status: "failed", error: `TRANSFER repoint failed: ${updErr.message}` };

    return { status: "processed", note: `TRANSFER repointed profile ${sourceProfile.user_id} → ${destinationId}` };
  }

  if (PASSIVE_EVENTS.has(eventType)) {
    return { status: "processed", note: `Passive event ${eventType}` };
  }

  const aliases: string[] = Array.isArray(event.aliases) ? event.aliases : [];
  const candidates = [appUserId, event.original_app_user_id, ...aliases].filter(Boolean);

  const profileMatch = await findProfile(supabase, candidates);

  // Consumable Scan Pack purchase (durable server-side grant; NEW-1). Handled BEFORE the
  // generic none->skipped so a missing profile is a retryable delivery failure, not a
  // silent drop of a paid purchase.
  const pack = eventType === "NON_RENEWING_PURCHASE"
    ? SCAN_PACKS[(event as any).product_id as string]
    : undefined;
  if (pack) {
    if (profileMatch.kind === "ambiguous") return { status: "failed", error: profileMatch.reason };
    if (profileMatch.kind === "none") {
      return { status: "failed", error: `pack purchase, no profile yet for: ${candidates.join(", ")}` };
    }
    const txId = typeof (event as any).transaction_id === "string" ? (event as any).transaction_id : null;
    if (!txId) return { status: "skipped", reason: "pack purchase missing transaction_id" };
    const { data: grantData, error: grantErr } = await supabase.rpc("grant_scan_pack_credits_admin", {
      p_user_id: profileMatch.profile.user_id,
      p_source: pack.source,
      p_transaction_id: txId,
      p_scans_granted: pack.scans,
    });
    if (grantErr) return { status: "failed", error: `pack grant transient: ${grantErr.message}` };
    const gr = (grantData ?? {}) as { error?: string; idempotent?: boolean };
    if (gr.error) return { status: "skipped", reason: `pack grant permanent: ${gr.error}` };
    return { status: "processed", note: `Granted ${pack.scans} scans (${gr.idempotent ? "idempotent" : "new"})` };
  }

  if (profileMatch.kind === "ambiguous") {
    return { status: "failed", error: profileMatch.reason };
  }
  if (profileMatch.kind === "none") {
    return { status: "skipped", reason: `No profile for: ${candidates.join(", ")}` };
  }

  const profileUserId = profileMatch.profile.user_id;
  const matchedProfile = profileMatch.profile;

  if (UPGRADE_EVENTS.has(eventType)) {
    const tier = entitlementIdsToTier(extractEntitlementIds(event));
    if (!tier) return { status: "skipped", reason: `${eventType} but no recognized entitlement` };

    const expiresAt = extractExpirationISO(event);

    const { error } = await supabase
      .from("profiles")
      .update({
        subscription_tier: tier,
        subscription_expires_at: expiresAt,
        revenuecat_customer_id: appUserId || candidates[0],
      })
      .eq("user_id", profileUserId);

    if (error) return { status: "failed", error: `Upgrade write failed: ${error.message}` };
    return { status: "processed", note: `Upgraded to ${tier}` };
  }

  if (EXTEND_EVENTS.has(eventType)) {
    const expiresAt = extractExpirationISO(event);
    if (!expiresAt) return { status: "skipped", reason: "SUBSCRIPTION_EXTENDED with no new expiration" };

    const { error } = await supabase
      .from("profiles")
      .update({ subscription_expires_at: expiresAt })
      .eq("user_id", profileUserId);

    if (error) return { status: "failed", error: `Extend write failed: ${error.message}` };
    return { status: "processed", note: `Extended expiration to ${expiresAt}` };
  }

  if (DOWNGRADE_EVENTS.has(eventType)) {
    // Same rule as sync-subscription-from-rc: an EXPIRATION from RC is proof
    // that RC's own entitlement lapsed, but it never downgrades a locally
    // granted entitlement that is still valid (_shared/entitlementDecision.ts).
    const decision = decideEntitlement(
      {
        subscription_tier: matchedProfile.subscription_tier ?? null,
        subscription_expires_at: matchedProfile.subscription_expires_at ?? null,
        revenuecat_customer_id: matchedProfile.revenuecat_customer_id ?? null,
        trial_expires_at: matchedProfile.trial_expires_at ?? null,
      },
      { tier: null, expiresAt: null, expiredEntitlement: true },
    );
    if (decision.action !== "downgrade") {
      const reason = decision.action === "untouched"
        ? (decision.reason === "trial" ? "User still in trial" : `Local grant still valid (${decision.reason})`)
        : "EXPIRATION with an active RC tier is contradictory; not writing";
      return { status: "skipped", reason };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ subscription_tier: "free", subscription_expires_at: null })
      .eq("user_id", profileUserId);

    if (error) return { status: "failed", error: `Downgrade write failed: ${error.message}` };
    return { status: "processed", note: `Downgraded to free (${decision.reason})` };
  }

  return { status: "skipped", reason: `No handler for event type ${eventType}` };
}
