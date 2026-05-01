import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/json.ts";
import { requireUser, AuthError } from "../_shared/auth.ts";
import { enforceAiRateLimit, RateLimitError } from "../_shared/rateLimit.ts";
import { requirePaidTier, PremiumGateError } from "../_shared/tierGate.ts";

const json = jsonResponse;

serve(async (req: Request) => {
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

  // --- Authenticate, premium-gate, rate-limit ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  try {
    const { userId } = await requireUser(req);
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    await requirePaidTier(adminClient, userId);
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
    if (err instanceof PremiumGateError) {
      return json({ error: err.message }, err.status);
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
    formData.append("model", "whisper-1");
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

    return json({ text: whisperData.text ?? "" });
  } catch (err) {
    console.error("[transcribe-audio] Unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
