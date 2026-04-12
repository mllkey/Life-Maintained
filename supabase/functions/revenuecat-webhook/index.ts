import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const UPGRADE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
  "UNCANCELLATION",
]);
const DOWNGRADE_EVENTS = new Set(["EXPIRATION"]);
const EXTEND_EVENTS = new Set(["SUBSCRIPTION_EXTENDED"]);
const PASSIVE_EVENTS = new Set(["CANCELLATION", "BILLING_ISSUE", "PRODUCT_CHANGE"]);

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

type ProfileMatch =
  | { kind: "none" }
  | { kind: "one"; profile: { user_id: string; trial_expires_at: string | null } }
  | { kind: "ambiguous"; reason: string };

serve(async (req) => {
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

  const work = processWebhook(rawBody).catch((e) =>
    console.error("[WEBHOOK] Top-level processWebhook error:", e)
  );

  // Prefer waitUntil for background processing. If unavailable in this runtime,
  // await synchronously rather than risk dropping events on shutdown.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});

async function processWebhook(rawBody: string): Promise<void> {
  let body: any;
  try { body = JSON.parse(rawBody); }
  catch (e) { console.error("[WEBHOOK] Invalid JSON:", e); return; }

  const event = body.event;
  if (!event) { console.warn("[WEBHOOK] Missing event"); return; }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

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

  if (auditErr) {
    if (auditErr.code === "23505") {
      console.log(`[WEBHOOK] Duplicate ${eventId} (${eventType})`);
      return;
    }
    console.error("[WEBHOOK] Audit insert failed:", auditErr);
  }

  const eventTs = Number(event.event_timestamp_ms ?? 0);
  if (eventTs > 0 && Date.now() - eventTs > MAX_EVENT_AGE_MS) {
    await markEvent(supabase, eventId, "skipped", "Event older than 7 days");
    return;
  }

  console.log(`[WEBHOOK] Processing ${eventType} for ${appUserId || "(no app_user_id)"}`);

  const result = await handleEvent(supabase, event, eventType, appUserId);

  await markEvent(
    supabase,
    eventId,
    result.status,
    result.status === "failed"
      ? result.error
      : (result as any).reason ?? (result as any).note ?? null
  );
}

async function markEvent(
  supabase: SupabaseClient,
  eventId: string,
  status: "processed" | "skipped" | "failed",
  error: string | null
): Promise<void> {
  const { error: updateErr } = await supabase
    .from("webhook_events")
    .update({ status, error, processed_at: new Date().toISOString() })
    .eq("source", "revenuecat")
    .eq("event_id", eventId);
  if (updateErr) console.error(`[WEBHOOK] markEvent failed for ${eventId}:`, updateErr);
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
    .select("user_id, trial_expires_at")
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
      .select("user_id, trial_expires_at")
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
  if (profileMatch.kind === "ambiguous") {
    return { status: "failed", error: profileMatch.reason };
  }
  if (profileMatch.kind === "none") {
    return { status: "skipped", reason: `No profile for: ${candidates.join(", ")}` };
  }

  const profileUserId = profileMatch.profile.user_id;
  const trialExpiry = profileMatch.profile.trial_expires_at;

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
    const stillInTrial = trialExpiry && new Date(trialExpiry) > new Date();
    if (stillInTrial) return { status: "skipped", reason: "User still in trial" };

    const { error } = await supabase
      .from("profiles")
      .update({ subscription_tier: "free", subscription_expires_at: null })
      .eq("user_id", profileUserId);

    if (error) return { status: "failed", error: `Downgrade write failed: ${error.message}` };
    return { status: "processed", note: "Downgraded to free" };
  }

  return { status: "skipped", reason: `No handler for event type ${eventType}` };
}
