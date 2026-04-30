import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RC_DELETE_TIMEOUT_MS = 8000;
const GENERIC_ERROR_MESSAGE = "Failed to delete account. Please try again.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type RcDeleteOutcome =
  | { kind: "success"; status: number }
  | { kind: "not_found"; status: number }
  | { kind: "skipped"; reason: string }
  | { kind: "failure"; status: number | null; body: string };

async function attemptRcDelete(
  rcApiKey: string,
  appUserId: string,
): Promise<RcDeleteOutcome> {
  if (!appUserId) return { kind: "skipped", reason: "empty app_user_id" };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), RC_DELETE_TIMEOUT_MS);

  try {
    const encoded = encodeURIComponent(appUserId);
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encoded}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${rcApiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    if (res.ok) return { kind: "success", status: res.status };
    if (res.status === 404) return { kind: "not_found", status: 404 };
    const body = await res.text().catch(() => "");
    return { kind: "failure", status: res.status, body: body.slice(0, 1000) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "failure", status: null, body: msg.slice(0, 1000) };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const jwt = authHeader.replace("Bearer ", "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const rcApiKey = Deno.env.get("REVENUECAT_REST_API_KEY") ?? "";

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  const userId = user.id;

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Step 1: prepare — fetch RC customer ID before profiles cascades away.
    const { data: prepData, error: prepErr } = await adminClient.rpc(
      "prepare_user_account_deletion",
      { p_user_id: userId },
    );
    if (prepErr) {
      console.error("[delete-account] prepare_user_account_deletion failed:", prepErr);
      return json({ error: GENERIC_ERROR_MESSAGE }, 500);
    }
    const prepResult = (prepData ?? {}) as { revenuecat_customer_id: string | null };
    const rcCustomerId = prepResult.revenuecat_customer_id ?? null;

    // Step 2: hard-delete the auth user. Cascades 32+ user-owned tables atomically.
    // Runs BEFORE Storage purge so a still-valid JWT cannot create new objects
    // between purge and auth delete.
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error("[delete-account] auth.admin.deleteUser failed:", deleteAuthError);
      return json({ error: GENERIC_ERROR_MESSAGE }, 500);
    }

    // Step 3: purge Storage objects under {userId}/ prefix. Best-effort —
    // failure here doesn't undo auth delete; log to failed_storage_deletions
    // for nightly sweep retry.
    let storageDeleted: Record<string, number> | null = null;
    const { data: purgeData, error: purgeErr } = await adminClient.rpc(
      "purge_user_storage_objects",
      { p_user_id: userId },
    );
    if (purgeErr) {
      console.error("[delete-account] purge_user_storage_objects failed:", purgeErr);
      const { error: logErr } = await adminClient
        .from("failed_storage_deletions")
        .insert({
          user_id: userId,
          failure_kind: "rpc_failure",
          response_body: (purgeErr.message ?? "").slice(0, 1000),
        });
      if (logErr) console.error("[delete-account] failed_storage_deletions insert error:", logErr);
    } else {
      storageDeleted = (purgeData ?? null) as Record<string, number> | null;
    }

    // Step 4: best-effort RevenueCat REST DELETE for app_user_id (= userId)
    // and, if distinct, for the stored revenuecat_customer_id.
    const rcTargets: string[] = [userId];
    if (rcCustomerId && rcCustomerId !== userId) rcTargets.push(rcCustomerId);

    if (!rcApiKey) {
      const rows = rcTargets.map((id) => ({
        user_id: userId,
        rc_app_user_id: id,
        failure_kind: "missing_rest_api_key",
        status_code: null,
        response_body: null,
      }));
      const { error: logErr } = await adminClient
        .from("failed_rc_deletions")
        .insert(rows);
      if (logErr) console.error("[delete-account] failed_rc_deletions insert error:", logErr);
    } else {
      for (const target of rcTargets) {
        const outcome = await attemptRcDelete(rcApiKey, target);
        if (outcome.kind === "failure") {
          const { error: logErr } = await adminClient
            .from("failed_rc_deletions")
            .insert({
              user_id: userId,
              rc_app_user_id: target,
              failure_kind: "rest_failure",
              status_code: outcome.status,
              response_body: outcome.body,
            });
          if (logErr) console.error("[delete-account] failed_rc_deletions insert error:", logErr);
        }
      }
    }

    return json({ success: true, storage_deleted: storageDeleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[delete-account] Unexpected error:", msg);
    return json({ error: GENERIC_ERROR_MESSAGE }, 500);
  }
});
