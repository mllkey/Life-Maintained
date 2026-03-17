import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    console.error("[transcribe-audio] OPENAI_API_KEY is not set");
    return json({ error: "OPENAI_API_KEY secret is not configured" }, 500);
  }

  // --- Authenticate JWT ---
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  console.log("[AUTH] Authorization header present:", !!authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.error("[AUTH] Missing or invalid Authorization header");
    return json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const jwt = authHeader.replace("Bearer ", "").trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  console.log("[AUTH] getUser result:", user?.id, "error:", authError?.message);

  if (authError || !user) {
    console.error("[AUTH] Auth failed:", authError?.message);
    return json({ error: "Unauthorized" }, 401);
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

    console.log("[transcribe-audio] Calling OpenAI Whisper API...");
    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

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
