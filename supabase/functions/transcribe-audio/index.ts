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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  // --- Authenticate, resolve tier, per-minute abuse rate-limit ---
  // Order: auth FIRST (never read the audio body before authenticating), then
  // the per-minute abuse limiter. The daily cap is consumed later, AFTER the
  // body is validated, so a malformed request can never burn a daily slot.
  let resolvedUserId = "";
  let voiceDailyCap: number | null = null;
  try {
    const { userId } = await requireUser(req);
    resolvedUserId = userId;

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

    // Trial is treated as Pro/Business equivalence: no daily cap.
    if (trialActive || (subActive && (tier === "pro" || tier === "business"))) {
      voiceDailyCap = null;
    } else if (subActive && tier === "personal") {
      voiceDailyCap = 30;
    } else {
      voiceDailyCap = 5;
    }

    // Per-minute abuse rate-limit (all tiers). Fires before the daily cap so
    // rejected attempts never consume daily quota. Throws RateLimitError -> 429.
    await enforceAiRateLimit(adminClient, userId, "transcribe-audio");
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
    console.error("[transcribe-audio] auth/tier/rate error:", err);
    return json({ error: "Internal server error" }, 500);
  }

  // --- Parse + validate body BEFORE consuming the daily quota ---
  // A malformed or empty body is a user error and must never burn a daily slot.
  let audioBase64: string;
  let mimeType: string;
  try {
    const body = await req.json();
    audioBase64 = body.audio;
    mimeType = body.mimeType ?? "audio/m4a";
    if (!audioBase64) throw new Error("No audio provided");
  } catch (err) {
    console.error("[transcribe-audio] Bad request body:", err);
    return json({ error: "Invalid request body - expected { audio: base64string, mimeType: string }" }, 400);
  }

  console.log("[transcribe-audio] audio base64 length:", audioBase64.length, "mimeType:", mimeType);

  // --- Daily voice cap (Free/Personal only), per LOCAL CALENDAR DAY ---
  // Consume happens after body validation and before the paid Whisper call.
  // On a hard provider/function failure we refund the slot so a timeout or 5xx
  // never costs the user one of their daily logs.
  let voiceRemainingToday: number | null = null;
  let voiceEventId: string | null = null;
  if (voiceDailyCap !== null) {
    const tzHeader = req.headers.get("x-client-tz");
    const clientTz = (tzHeader && tzHeader.length > 0 && tzHeader.length <= 64) ? tzHeader : "UTC";
    const { data: capData, error: capErr } = await adminClient.rpc("consume_voice_daily", {
      p_user_id: resolvedUserId,
      p_max_calls: voiceDailyCap,
      p_tz: clientTz,
    });
    if (capErr) {
      console.error("[transcribe-audio] consume_voice_daily RPC error:", capErr.message);
      return json({ error: "Could not verify your voice quota. Please try again." }, 500);
    }
    const cap = capData as { allowed?: boolean; remaining?: number; event_id?: string } | null;
    if (!cap || cap.allowed !== true) {
      return json({ error: "voice_cap_reached", voice_remaining_today: 0 }, 200);
    }
    voiceRemainingToday = cap.remaining ?? null;
    voiceEventId = cap.event_id ?? null;
  }

  // Best-effort refund of a consumed daily slot on hard failure only.
  const refundVoiceSlot = async () => {
    if (voiceDailyCap === null || !voiceEventId) return;
    try {
      await adminClient.rpc("refund_voice_daily", {
        p_user_id: resolvedUserId,
        p_event_id: voiceEventId,
      });
    } catch (refundErr) {
      console.error("[transcribe-audio] refund_voice_daily failed:", refundErr);
    }
  };

  // --- Convert base64 to binary + call Whisper ---
  try {
    const binaryStr = atob(audioBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

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
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: formData,
        signal: aiController.signal,
      });
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      console.log(`[transcribe-audio] AI call completed in ${elapsedMs}ms, status=${whisperRes.status}`);
    } catch (fetchErr) {
      clearTimeout(aiTimeoutId);
      const elapsedMs = Date.now() - aiStartedAt;
      await refundVoiceSlot();
      if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
        console.error(`[transcribe-audio] AI call timed out after ${elapsedMs}ms (limit ${TIMEOUT_MS}ms)`);
        return json({ error: "Transcription timed out. Please try again." }, 504);
      }
      console.error(`[transcribe-audio] AI call threw after ${elapsedMs}ms:`, fetchErr);
      return json({ error: "Internal server error" }, 500);
    }

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      await refundVoiceSlot();
      console.error(`[transcribe-audio] Whisper API error ${whisperRes.status}:`, errText);
      return json({ error: `Whisper API returned ${whisperRes.status}: ${errText}` }, 502);
    }

    const whisperData = await whisperRes.json();
    console.log("[transcribe-audio] Transcription success, text length:", whisperData.text?.length);

    return json({ text: whisperData.text ?? "", voice_remaining_today: voiceRemainingToday });
  } catch (err) {
    await refundVoiceSlot();
    console.error("[transcribe-audio] Unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
