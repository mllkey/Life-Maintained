import { createClient } from "npm:@supabase/supabase-js@2.98.0";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/json.ts";
import { requireUser, AuthError } from "../_shared/auth.ts";
import { enforceAiRateLimit, RateLimitError } from "../_shared/rateLimit.ts";

const json = jsonResponse;

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    console.error("[transcribe-audio] OPENAI_API_KEY is not set");
    return json({ error: "OPENAI_API_KEY secret is not configured" }, 500);
  }

  // --- Authenticate, abuse rate-limit, daily voice cap ---
  // Order matters: abuse rate-limit fires BEFORE daily cap, so attempts
  // rejected by the abuse limiter do not consume the user's daily quota.
  // Daily voice cap: Free 5/day, Personal 30/day. Pro/Business get NO daily
  // cap; abuse protection is the only limit they hit.
  // Daily cap response is HTTP 200 with a structured error code so the
  // client can distinguish it from the abuse-limit 429.
  // The fn_name "transcribe-audio:daily" is namespaced separately from the
  // per-minute "transcribe-audio" so the two windows do not collide.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let resolvedUserId = "";
  let voiceDailyCap: number | null = null;
  let voiceRemainingToday: number | null = null;
  try {
    const { userId } = await requireUser(req);
    resolvedUserId = userId;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve current effective tier for this user.
    const { data: profileRow, error: profileErr } = await adminClient
      .from("profiles")
      .select("subscription_tier, trial_expires_at, subscription_expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileErr || !profileRow) {
      console.error("[transcribe-audio] profile lookup failed:", profileErr?.message ?? "no row");
      return json({ error: "Could not verify your subscription. Please try again." }, 500);
    }
    const now = Date.now();
    const tier = (profileRow.subscription_tier ?? "").toString();
    const trialMs = profileRow.trial_expires_at ? new Date(profileRow.trial_expires_at as string).getTime() : 0;
    const subMs = profileRow.subscription_expires_at ? new Date(profileRow.subscription_expires_at as string).getTime() : 0;
    const trialActive = tier === "trial" && trialMs > now;
    const subActive = ["personal", "pro", "business"].includes(tier) && subMs > now;

    // Trial is treated as Pro/Business equivalence — no daily cap.
    if (trialActive || (subActive && (tier === "pro" || tier === "business"))) {
      voiceDailyCap = null;
    } else if (subActive && tier === "personal") {
      voiceDailyCap = 30;
    } else {
      voiceDailyCap = 5;
    }

    // 1. Per-minute abuse rate-limit (all tiers). Fires FIRST so rejected
    //    attempts do not consume daily voice quota. On cap, throws
    //    RateLimitError -> handled by existing 429 branch below.
    await enforceAiRateLimit(adminClient, userId, "transcribe-audio");

    // 2. Daily voice cap (Free/Personal only).
    if (voiceDailyCap !== null) {
      const { data: dailyOk, error: dailyErr } = await adminClient.rpc("check_rate_limit", {
        p_user_id: userId,
        p_fn_name: "transcribe-audio:daily",
        p_max_calls: voiceDailyCap,
        p_window_seconds: 86400,
      });
      if (dailyErr) {
        console.error("[transcribe-audio] daily check_rate_limit RPC error:", dailyErr.message);
        return json({ error: "Could not verify your voice quota. Please try again." }, 500);
      }
      if (dailyOk === false) {
        // Daily cap hit — short-circuit with HTTP 200 structured payload.
        return json({ error: "voice_cap_reached", voice_remaining_today: 0 }, 200);
      }

      // Compute remaining-today after this attempt was logged.
      const sinceIso = new Date(now - 86400 * 1000).toISOString();
      const { count: dailyCount } = await adminClient
        .from("rate_limit_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("fn_name", "transcribe-audio:daily")
        .gte("occurred_at", sinceIso);
      voiceRemainingToday = Math.max(0, voiceDailyCap - (dailyCount ?? 0));
    } else {
      voiceRemainingToday = null;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return json({ error: err.message }, err.status);
    }
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    console.error("[transcribe-audio] auth/gate/rate error:", err);
    return json({ error: "Internal server error" }, 500);
  }

  // --- Parse request body ---
  let audioBase64: string;
  let mimeType: string;
  try {
    const body = await req.json();
    audioBase64 = body.audio;
    mimeType = body.mimeType ?? "audio/m4a";
    if (!audioBase64) throw new Error("No audio provided");
  } catch (err) {
    console.error("[transcribe-audio] Bad request body:", err);
    return json({ error: "Invalid request body — expected { audio: base64string, mimeType: string }" }, 400);
  }

  console.log("[transcribe-audio] audio base64 length:", audioBase64.length, "mimeType:", mimeType);

  // --- Convert base64 to binary ---
  try {
    const binaryStr = atob(audioBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Determine file extension from mime type
    const ext = mimeType === "audio/mp4" || mimeType === "audio/m4a" ? "m4a"
      : mimeType === "audio/wav" ? "wav"
      : mimeType === "audio/mpeg" || mimeType === "audio/mp3" ? "mp3"
      : "m4a";

    const audioBlob = new Blob([bytes], { type: mimeType });
    const formData = new FormData();
    formData.append("file", audioBlob, `recording.${ext}`);
    const transcribeModel = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ?? "gpt-4o-mini-transcribe";
    formData.append("model", transcribeModel);
    formData.append("language", "en");

    const TIMEOUT_MS = 30_000;
    const aiController = new AbortController();
    const aiTimeoutId = setTimeout(() => aiController.abort(), TIMEOUT_MS);
    const aiStartedAt = Date.now();
    let whisperRes: Response;
    console.log("[transcribe-audio] Calling OpenAI Whisper API...");
    try {
      whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
        signal: aiController.signal,
      });
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      console.log(`[transcribe-audio] AI call completed in ${elapsedMs}ms, status=${whisperRes.status}`);
    } catch (fetchErr) {
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        console.error(`[transcribe-audio] AI call timed out after ${elapsedMs}ms (limit ${TIMEOUT_MS}ms)`);
        return json({ error: "Transcription timed out. Please try again." }, 504);
      }
      console.error(`[transcribe-audio] AI call threw after ${elapsedMs}ms:`, fetchErr);
      return json({ error: "Internal server error" }, 500);
    }

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error(`[transcribe-audio] Whisper API error ${whisperRes.status}:`, errText);
      return json({ error: `Whisper API returned ${whisperRes.status}: ${errText}` }, 502);
    }

    const whisperData = await whisperRes.json();
    console.log("[transcribe-audio] Transcription success, text length:", whisperData.text?.length);

    return json({ text: whisperData.text ?? "", voice_remaining_today: voiceRemainingToday });
  } catch (err) {
    console.error("[transcribe-audio] Unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
