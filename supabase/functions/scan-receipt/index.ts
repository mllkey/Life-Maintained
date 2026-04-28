import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/json.ts";
import { requireUser, AuthError } from "../_shared/auth.ts";
import { enforceAiRateLimit, RateLimitError } from "../_shared/rateLimit.ts";

interface ReceiptData {
  date: string | null;
  cost: number | null;
  provider: string | null;
  serviceType: string | null;
  mileage: number | null;
  task: string | null;
  rawText: string;
  error?: string;
}

function detectMediaType(base64: string): string {
  const prefix = base64.substring(0, 16);
  const decoded = atob(prefix);
  const bytes = decoded.split("").map((c) => c.charCodeAt(0));
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  return "image/jpeg";
}

function stripDataUrlPrefix(base64: string): string {
  const match = base64.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : base64;
}

function isUuid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("scan-receipt: missing Supabase env vars");
      return jsonResponse({ error: "Server configuration error" }, 500);
    }
    if (!ANTHROPIC_API_KEY) {
      console.error("scan-receipt: ANTHROPIC_API_KEY missing");
      return jsonResponse({ error: "ANTHROPIC_API_KEY secret is not configured" }, 500);
    }

    // Auth (Group 1 helper — real signature verification)
    const { userId, jwt } = await requireUser(req);

    // Parse + validate body
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

    const { request_id, image, asset_type, asset_id, source } = body;

    if (!isUuid(request_id)) {
      return jsonResponse({ error: "Missing or invalid request_id (uuid required)" }, 400);
    }
    if (typeof image !== "string" || !image) {
      return jsonResponse({ error: "Missing image" }, 400);
    }
    if (asset_type !== "vehicle" && asset_type !== "property" && asset_type !== "health") {
      return jsonResponse({ error: "Invalid asset_type" }, 400);
    }
    if (!isUuid(asset_id)) {
      return jsonResponse({ error: "Missing or invalid asset_id (uuid required)" }, 400);
    }
    if (source !== "camera" && source !== "photo_library") {
      return jsonResponse({ error: "Invalid source" }, 400);
    }

    // Per-user JWT-bound supabase client (auth.uid() works inside RPCs)
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    // Admin client for rate limit only (rate_limit RPC is service-role)
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Rate limit
    await enforceAiRateLimit(adminClient, userId, "scan-receipt");

    // Reserve a scan slot
    const { data: reserveData, error: reserveErr } = await userClient.rpc("reserve_receipt_scan", {
      p_request_id: request_id,
      p_user_id: userId,
      p_asset_type: asset_type,
      p_asset_id: asset_id,
      p_source: source,
    });

    if (reserveErr) {
      console.error("[scan-receipt] reserve RPC error:", reserveErr.message);
      return jsonResponse({ error: "Failed to reserve scan", detail: reserveErr.message }, 500);
    }

    const reserve = (reserveData ?? {}) as Record<string, unknown>;
    if (typeof reserve.error === "string") {
      const code = reserve.error;
      const scansUsed = typeof reserve.scans_used === "number" ? reserve.scans_used : undefined;
      const scansLimit = typeof reserve.scans_limit === "number" ? reserve.scans_limit : undefined;
      if (code === "quota_exceeded") {
        return jsonResponse({
          error: `You've used all ${scansLimit ?? 0} scans this month. Upgrade your plan or buy a Scan Pack.`,
          scans_used: scansUsed,
          scans_limit: scansLimit,
          request_id,
        }, 429);
      }
      if (code === "subscription_required") {
        return jsonResponse({ error: "Receipt scanning requires a paid subscription.", request_id }, 403);
      }
      if (code === "scan_in_progress") {
        return jsonResponse({ error: "Another scan is already in progress.", request_id }, 409);
      }
      if (code === "asset_not_found") {
        return jsonResponse({ error: "Asset not found or not owned by user.", request_id }, 403);
      }
      if (code === "profile_not_found") {
        return jsonResponse({ error: "Profile not found.", request_id }, 403);
      }
      return jsonResponse({ error: code, request_id }, 400);
    }

    const scansUsed = typeof reserve.scans_used === "number" ? reserve.scans_used : 0;
    const scansLimit = typeof reserve.scans_limit === "number" ? reserve.scans_limit : 0;
    const idempotent = reserve.idempotent === true;

    // Idempotent reservation (already in flight or completed).
    if (idempotent) {
      return jsonResponse({
        date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null, rawText: "",
        error: "Scan already in progress for this request_id.",
        request_id,
        scans_used: scansUsed,
        scans_limit: scansLimit,
      }, 200);
    }

    // Mark processing
    const { data: markData, error: markErr } = await userClient.rpc("mark_receipt_scan_processing", {
      p_request_id: request_id,
      p_user_id: userId,
    });
    if (markErr) {
      console.error("[scan-receipt] mark RPC error:", markErr.message);
      await userClient.rpc("fail_receipt_scan", {
        p_request_id: request_id,
        p_user_id: userId,
        p_error_message: `mark_processing failed: ${markErr.message}`,
      });
      return jsonResponse({ error: "Failed to start scan", detail: markErr.message, request_id }, 500);
    }
    const mark = (markData ?? {}) as Record<string, unknown>;
    if (typeof mark.error === "string") {
      return jsonResponse({ error: "Scan reservation no longer valid.", detail: mark.error, request_id }, 409);
    }

    const failScan = async (message: string): Promise<void> => {
      try {
        await userClient.rpc("fail_receipt_scan", {
          p_request_id: request_id,
          p_user_id: userId,
          p_error_message: message,
        });
      } catch (e) {
        console.error("[scan-receipt] fail RPC threw:", e);
      }
    };

    // AI call
    const base64 = stripDataUrlPrefix(image);
    const mediaType = detectMediaType(base64);
    const prompt = `You are analyzing a service receipt or invoice image. Extract the following fields exactly as they appear:

1. date — The service or transaction date. Format as YYYY-MM-DD. Return null if not found.
2. cost — The total amount charged as a number (no currency symbol). Use the final total/amount due. Return null if not found.
3. provider — The business or service provider name (e.g. "Jiffy Lube", "AutoNation", "Dr. Smith's Clinic"). Return null if not found.
4. serviceType — A short description of the service performed (e.g. "Oil Change", "Tire Rotation", "Brake Inspection"). Return null if not found.
5. mileage — The vehicle mileage/odometer reading if shown on the receipt as a number. Return null if not found.

Respond ONLY with a valid JSON object in this exact format, no extra text:
{
  "date": "YYYY-MM-DD or null",
  "cost": number or null,
  "provider": "string or null",
  "serviceType": "string or null",
  "mileage": number or null,
  "rawText": "a brief summary of what you can read on the receipt"
}`;

    const requestBody = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    };

    const TIMEOUT_MS = 60_000;
    const aiController = new AbortController();
    const aiTimeoutId = setTimeout(() => aiController.abort(), TIMEOUT_MS);
    let anthropicRes: Response;
    try {
      anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: aiController.signal,
      });
      clearTimeout(aiTimeoutId);
      console.log(`[scan-receipt] AI status=${anthropicRes.status}`);
    } catch (fetchErr) {
      clearTimeout(aiTimeoutId);
      const isAbort = fetchErr instanceof Error && fetchErr.name === "AbortError";
      const msg = isAbort ? "Scan timed out. Please try again." : "Internal server error";
      await failScan(isAbort ? "AI timeout" : `AI fetch error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
      return jsonResponse({
        error: msg, date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null, rawText: "",
        request_id, scans_used: scansUsed, scans_limit: scansLimit,
      }, isAbort ? 504 : 500);
    }

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("[scan-receipt] anthropic error", anthropicRes.status, errText.slice(0, 200));
      await failScan(`Anthropic ${anthropicRes.status}: ${errText.slice(0, 200)}`);
      return jsonResponse({
        error: `Anthropic API returned ${anthropicRes.status}`,
        date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null, rawText: "",
        request_id, scans_used: scansUsed, scans_limit: scansLimit,
      }, 502);
    }

    const anthropicData = await anthropicRes.json();
    const rawContent: string = anthropicData.content?.[0]?.text ?? "";

    let parsed: ReceiptData;
    let parseFailed = false;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      const obj = JSON.parse(jsonMatch[0]);
      const serviceType = obj.serviceType && obj.serviceType !== "null" ? String(obj.serviceType) : null;
      parsed = {
        date: obj.date && obj.date !== "null" ? String(obj.date) : null,
        cost: obj.cost != null && obj.cost !== "null" ? Number(obj.cost) : null,
        provider: obj.provider && obj.provider !== "null" ? String(obj.provider) : null,
        serviceType,
        mileage: obj.mileage != null && obj.mileage !== "null" ? Number(obj.mileage) : null,
        task: serviceType,
        rawText: typeof obj.rawText === "string" ? obj.rawText : rawContent.slice(0, 300),
      };
    } catch (parseErr) {
      console.error("[scan-receipt] parse failed:", parseErr);
      parseFailed = true;
      parsed = {
        date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null,
        rawText: rawContent.slice(0, 300),
        error: "Could not parse receipt fields",
      };
    }

    // PASS-B-006: parse failure must refund the slot, not consume it.
    if (parseFailed) {
      await failScan("Parse failure: AI response not valid JSON");
      return jsonResponse({
        ...parsed,
        request_id,
        scans_used: scansUsed,
        scans_limit: scansLimit,
      }, 200);
    }

    // Complete the scan (success path)
    const normalizedOutput = {
      date: parsed.date,
      cost: parsed.cost,
      provider: parsed.provider,
      serviceType: parsed.serviceType,
      mileage: parsed.mileage,
      task: parsed.task,
      rawText: parsed.rawText,
    };

    const { data: completeData, error: completeErr } = await userClient.rpc("complete_receipt_scan", {
      p_request_id: request_id,
      p_user_id: userId,
      p_normalized_output: normalizedOutput,
      p_raw_ocr_response: anthropicData,
      p_field_confidence: null,
      p_duplicate_hash: null,
      p_image_path: null,
    });

    if (completeErr) {
      console.error("[scan-receipt] complete RPC error:", completeErr.message);
      await failScan(`complete_receipt_scan failed: ${completeErr.message}`);
      return jsonResponse({
        error: "Could not save scan result. Please try again.",
        date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null, rawText: "",
        request_id,
        scans_used: scansUsed,
        scans_limit: scansLimit,
      }, 500);
    }

    const complete = (completeData ?? {}) as Record<string, unknown>;
    if (typeof complete.error === "string") {
      console.error("[scan-receipt] complete returned error:", complete.error);
      await failScan(`complete_receipt_scan returned error: ${complete.error}`);
      return jsonResponse({
        error: "Could not complete scan result. Please try again.",
        detail: complete.error,
        date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null, rawText: "",
        request_id,
        scans_used: scansUsed,
        scans_limit: scansLimit,
      }, 409);
    }

    return jsonResponse({
      ...parsed,
      request_id,
      scans_used: scansUsed + 1,
      scans_limit: scansLimit,
    }, 200);

  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ error: err.message }, err.status);
    }
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    console.error("scan-receipt: unexpected top-level error:", err instanceof Error ? err.message : String(err));
    return jsonResponse(
      { error: "Internal server error", date: null, cost: null, provider: null, serviceType: null, mileage: null, task: null, rawText: "" },
      500,
    );
  }
});
