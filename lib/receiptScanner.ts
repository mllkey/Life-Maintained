import { supabase } from "./supabase";

export interface ReceiptScanResult {
  date: string | null;
  cost: number | null;
  provider: string | null;
  serviceType: string | null;
  rawText: string;
  error?: string;
}

export async function scanReceipt(base64Image: string): Promise<ReceiptScanResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error("You must be logged in to scan receipts.");
    }

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    const response = await fetch(supabaseUrl + "/functions/v1/scan-receipt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + supabaseAnonKey,
        "apikey": supabaseAnonKey || "",
      },
      body: JSON.stringify({ image: base64Image }),
    });

    const data = await response.json();
    console.log("RAW RESPONSE:", JSON.stringify(data));

    if (data.error) {
      console.warn("Scan returned error:", data.error);
    }

    const result = {
      date: data.date || null,
      cost: data.cost != null ? Number(data.cost) : null,
      provider: data.provider || null,
      serviceType: data.serviceType || null,
      rawText: data.rawText || "",
      error: data.error || undefined,
    };
    console.log("RETURNING:", JSON.stringify(result));
    return result;
  } catch (err) {
    console.error("Receipt scan failed:", err);
    return {
      date: null,
      cost: null,
      provider: null,
      serviceType: null,
      rawText: "",
      error: err instanceof Error ? err.message : "Could not scan receipt",
    };
  }
}
